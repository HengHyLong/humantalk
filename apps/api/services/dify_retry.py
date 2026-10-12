"""One cancellable retry owner; retry only before any sentence is committed."""
from __future__ import annotations

import asyncio
import random
import re
import time

from apps.api.services.dify_chat import DifyChatError, spoken_answer


async def chat_with_retries(call, *, is_current, can_retry, reset, max_retries=3, budget_sec=30,
                            attempts=None, backoff_base=.5):
    attempts = attempts if attempts is not None else []
    deadline = time.monotonic() + budget_sec
    for index in range(max_retries + 1):
        if not await is_current():
            raise asyncio.CancelledError()
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            error = DifyChatError("DIFY_CHAT_RETRY_BUDGET_EXCEEDED", retryable=False)
            error.attempts = attempts
            raise error
        reset()
        started = time.monotonic()
        row = {"attempt": index + 1}
        try:
            reply = await asyncio.wait_for(call(remaining), timeout=remaining)
            if not re.search(r"\w", spoken_answer(reply.answer)):
                raise DifyChatError("DIFY_CHAT_EMPTY_ANSWER")
            if not await is_current():
                raise asyncio.CancelledError()
            row.update(status="succeeded", conversation_id=reply.conversation_id,
                       message_id=reply.message_id, task_id=reply.task_id, workflow_run_id=reply.workflow_run_id,
                       first_delta_ms=reply.first_delta_ms, generation_ms=reply.generation_ms)
            return reply
        except asyncio.CancelledError:
            row["status"] = "cancelled"
            raise
        except (DifyChatError, TimeoutError) as exc:
            error = exc if isinstance(exc, DifyChatError) else DifyChatError("DIFY_CHAT_TIMEOUT")
            row.update(status="failed", error_code=error.code, http_status=error.http_status,
                       conversation_id=error.conversation_id, message_id=error.message_id, task_id=error.task_id,
                       workflow_run_id=error.workflow_run_id)
            if not error.retryable or not can_retry() or index == max_retries:
                row["retry_suppressed"] = ("permanent_error" if not error.retryable else
                                           "speech_committed" if not can_retry() else "retry_limit")
                error.attempts = attempts
                raise error
            delay = max(error.retry_after, backoff_base * 2 ** index + random.uniform(0, .1))
            if time.monotonic() + delay >= deadline:
                row["budget_exhausted"] = True
                error.attempts = attempts
                raise error
            row["retry_delay_ms"] = round(delay * 1000)
        finally:
            row["elapsed_ms"] = round((time.monotonic() - started) * 1000)
            attempts.append(row)
        await asyncio.sleep(delay)
