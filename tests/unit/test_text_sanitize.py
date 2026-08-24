from __future__ import annotations

from opentalking.pipeline.speak.text_sanitize import sanitize_tts_text, strip_markdown


def test_strip_markdown_removes_formatting_links_and_urls() -> None:
    value = (
        "## **会议服务**\n"
        "- 通过 [CCFLink 小程序](https://example.com/path) 查看日程。\n"
        "- 信息来源：https://example.com/source"
    )

    assert strip_markdown(value) == "会议服务 通过 CCFLink 小程序 查看日程。"


def test_sanitize_tts_text_keeps_plain_chinese_content() -> None:
    value = "**CNCC2026** 提供签到、日程查询和现场咨询服务。"

    assert sanitize_tts_text(value) == "CNCC2026 提供签到、日程查询和现场咨询服务。"
