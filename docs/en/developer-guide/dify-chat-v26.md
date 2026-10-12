# v2.6 digital human answer routing

## Frontend access password

The digital human UI requires server-side password verification before initialization. The initial password is `10528`. Administrators can change it (5–128 characters) under System → Model management → Frontend access password with `system:llm:write` permission. Only an Argon2 hash is stored in the admin database's `frontend_access` table; neither passwords nor hashes are returned. Changing it immediately invalidates previous browser sessions. The UI checks on startup, window focus and every minute.

Verification uses an HttpOnly, SameSite=Lax browser-session cookie without a fixed token timeout, Max-Age or Expires. Refreshing or reopening pages within the browser session keeps access; normal browser exit clears it. Browser session-restore features may restore session cookies; websites cannot reliably observe process exit, so disable session restoration or configure cookie clearing on exit for that case. Old 12-hour cookies are rejected after upgrading, requiring verification once. HTTP, SSE and WebSocket digital human endpoints are protected. Existing administrator authentication and permissions remain available for administration and debugging. Public exhibit survey links and `/healthz` remain accessible. Use `/healthz` for deployment probes. API clients must first call `POST /frontend-access/login` and retain the cookie. `GET /frontend-access/status` checks access; `POST /frontend-access/logout` clears browser access. `GET/PUT /api/v1/admin/frontend-access` reads metadata or changes the password with administrator permissions.

## Complete-sentence streaming speech

The Dify configuration panel selects complete-sentence streaming or complete-answer speech as the rollback mode. Changes apply to the next turn. `OPENTALKING_DIFY_CHAT_SPEECH_MODE` accepts `sentences` or `complete`; the code defaults to `complete`, and deployments can explicitly enable `sentences`.

Streaming applies only to Dify answers and capable direct-speech renderers. Database answers remain direct; Vidu and unsupported renderers automatically use complete answers. Requests may set `speech_mode=complete` for one turn, but cannot enable streaming when the global switch is off.

Incrementally filtered complete sentences enter one direct speech task without the OpenTalking LLM. Only a verified `message_end` commits an unpunctuated tail. Transport limits are 16000 characters, 256 segments and a ten-minute TTL; the TTS queue holds four segments. New turns and session closure cancel old generation and speech; each segment checks the active turn.

The existing HTTP endpoint still returns the final answer. Session SSE adds `qa.delta` (cumulative committed text), `qa.completed` (generation end and timing), `qa.replace` (correction) and `qa.error` (incomplete answer), carrying `turn_id`. Generated text is retained separately; visible chat and captions advance with speech segments. Neither HTTP completion nor generation completion reveals the full answer before playback. Playback completion fills the final answer, including recovery after temporary SSE disconnection, without restarting speech. Only `speech.ended`, not `qa.completed`, marks playback completion.

`message_replace` cancels pending speech, then speaks the verified replacement with a correction notice. Played audio cannot be retracted. Stream or TTS failures are reported and never automatically replay the partial answer. Responses add `speech_mode`; hit logs record `firstDeltaMs`, `firstSentenceMs` and `generationMs`. Initial tuning preserves natural sentence endings instead of timeout-based mid-sentence cuts; compare real WebRTC first-audio and first-animation times before tuning further.

The frontend submits text, transcribed speech and entity selections to `POST /exhibitions/{exhibition_id}/qa/query`. The backend searches available exhibitors, exhibits and routes within the selected exhibition. Existing public APIs expose draft records, so v2.6 preserves that availability without changing record status. Offline, inactive and deleted records are excluded.

- A unique exact keyword hit speaks stored copy or a description directly. Location questions use the booth or address; route questions use stored speech or directions. The response has `match_type=database` and makes no Dify call.
- Missing matches, fuzzy matches, ambiguous names and missing requested content use a Dify chat application with the current database context. Ordinary answers return `match_type=dify`; ambiguous matches return `clarification`.
- Both paths send `direct=true` to the avatar speech pipeline, bypassing OpenTalking's conversational LLM. Dify failures produce a fixed service message.

Configure the application Base URL, API key, timeout and candidate limit in the admin model management page and test connectivity. The key stays in the server environment file and is never returned to the frontend. Maintain entity keywords, aliases, descriptions and speech copy in exhibition management.

Environment variables: `OPENTALKING_DIFY_CHAT_BASE_URL`, `OPENTALKING_DIFY_CHAT_API_KEY`, `OPENTALKING_DIFY_CHAT_TIMEOUT_SEC`, `OPENTALKING_DIFY_CHAT_TOP_K`. These application credentials are separate from legacy dataset retrieval credentials.

Use a Dify chat application or Chatflow with optional inputs `exhibition_id`, `locale`, `retrieval_status` and `retrieval_context`. The last input contains JSON database facts. Prioritize current facts and clarify missing information. Output only the final answer and separate model reasoning.

Each session stores its Dify conversation ID and recent entity choices. Direct database turns preserve the conversation ID. Subsequent Dify requests continue that conversation with fresh facts. New questions, interruption and session closure cancel obsolete tasks and prevent stale speech from entering the queue.

## Matching and navigation checks

Codes require complete boundaries: `S-01`, `S01` and `S_01` are equivalent, while `S010` is different. Numeric codes require a standalone input or identifier context; `02` never matches `CNCC2026`. Negated names are excluded. A longer name only suppresses a shorter alias at the same text span; separately mentioned objects remain candidates.

Direct database speech requires an exact match, a supported introduction/location/list/validated-route intent, sufficient facts, and no ambiguity or truncation. Prices, founding dates, comparisons, pros/cons, compound questions, schedules, fuzzy names, missing fields and English translations go to Dify. Complete lists can be spoken directly; partial lists carry a total and truncation flag.

The exhibition workspace provides terminal point and intent keyword settings plus a read-only configuration audit. Operators must set `terminalPointId` according to the physical installation. Requests can supply `origin_point_id`; an origin explicitly named in the question takes priority. Missing or unknown origins, missing routes, conflicting endpoints, multiple destinations and cross-exhibition requests receive fixed clarification prompts. Routes are never reversed or stitched together.

Follow-ups prioritize explicit current names/codes or corrections, then valid ordinals, then a pronoun referring to one unique candidate. Cards and cached candidates share display order; routes store separate route IDs. Registration returns a `registration` action only for a unique exhibit with a real survey URL; the frontend generates its QR code without a second speech request.

Responses add `routing_reason` and `registration`. Dify context adds `current_exhibition`, `intent`, `routing_reason`, `truncated`, `origin_id` and `destination_id`. Hit logs record fields, keywords, decision reason, entity/route IDs and endpoints.

`POST /api/v1/admin/event/exhibitions/{id}/runtime-config/validate` returns `issues` for route conflicts, missing terminal points, unlinked points, duplicated match terms and image markup. Route writes reject structural and recognized endpoint conflicts. Speech removes image markup while preserving original data and images. Uncertain business facts require operator verification.

The production Dify system prompt is maintained in `configs/prompts/dify_exhibition_v26.txt`; publish it in the Dify LLM node after backing up the workflow. Existing optional inputs remain compatible. The legacy avatar role prompt is not used by this Q&A chain. Unverified knowledge documents cannot override current database facts.

The first complete sentence enters TTS immediately without waiting for generation completion. The first PCM window enters the lip-sync model without waiting for the entire sentence audio. Events `speech.synthesis_started` and `speech.lip_sync_started` identify the first requests of a turn and can be compared against `qa.completed` and received WebRTC audio timing.

The exhibitor → product → QR flow stores follow-up state per exhibition and session on the server. A unique database introduction asks about associated available products. Explicit confirmation shows those product cards. Selecting a card or valid ordinal introduces that product; a QR prompt is offered only for a configured survey link, and another confirmation returns the actual QR path. Declines and new questions leave the flow. Ambiguous pronouns and invalid ordinals request selection. The follow_up response identifies the stage and ordered candidates for frontend quick replies.

When no terminal point is configured, a destination-matched route explicitly named as starting at the terminal may identify the origin only after point and route-copy validation and only when the candidate terminal origins agree. Configured and explicitly named origins retain priority. Origin-only replies such as “从终端出发” continue a pending or previously resolved destination. Navigation responses display valid route images rather than destination introduction cards.
