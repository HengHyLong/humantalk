"""Scoped exhibitor → exhibit → survey follow-ups using validated database cards."""
from __future__ import annotations

import re
import unicodedata

from apps.api.services.exhibition_lookup import published


def normalized(text):
    return re.sub(r"[\W_]+", "", unicodedata.normalize("NFKC", text).lower())


YES = {normalized(t) for t in ["要", "需要", "我需要", "是的", "好", "好的", "可以", "嗯", "yes", "yes please", "sure"]}
NO = {normalized(t) for t in ["不", "不用", "不用了", "不要", "不需要", "暂时不用", "暂时不需要", "不了", "不需要二维码", "不要二维码", "不用登记", "不登记", "不想了解", "不需要了解展品", "不想了解展品", "no", "not now", "no thanks"]}
PRODUCT_YES = {normalized(t) for t in ["想了解", "需要了解", "我需要了解", "我想了解", "了解一下", "想看看", "想了解一下", "我想了解一下", "想了解相关展品", "了解展品", "需要了解展品", "需要了解产品", "想了解展品", "想看展品", "看看展品", "想了解产品", "想了解相关产品", "yes show products", "show products"]}
QR_YES = {normalized(t) for t in ["需要二维码", "给我二维码", "展示二维码", "打开二维码", "需要登记", "我要登记", "yes show qr code", "show qr code"]}


def available_cards(store, visible):
    return [c for c in visible if c.get("kind") in {"exhibitor", "exhibit"}
            and (record := store.get_record(c["kind"] + "s", c["id"])) and published(record)]


def resolve_followup(question, selected_id, pending, cards, english):
    """Only exact short decisions consume a prompt; new questions go to lookup."""
    decision = normalized(question)
    by_id = {c["id"]: c for c in cards}
    stage = pending.get("stage") if isinstance(pending, dict) else None
    if selected_id or not stage:
        return {"question": question, "selected_id": selected_id}
    if decision in NO:
        return {"question": question, "selected_id": None, "answer": "Okay. Feel free to ask another question." if english else "好的，您可以继续询问其他内容。", "related": []}
    if stage == "exhibitor_products":
        card = by_id.get(pending.get("entity_id"))
        if card and decision in YES | PRODUCT_YES:
            return {"question": f"What products does {card['name']} have?" if english else f"{card['name']}有哪些展品？", "selected_id": card["id"]}
    elif stage == "registration":
        card = by_id.get(pending.get("entity_id"))
        explicit_qr = bool(re.fullmatch(r"(?:我)?(?:需要|想要|要|请展示|请给我)(?:这个|该)?(?:展品|产品)?的?(?:登记)?二维码", decision))
        if card and (decision in YES | QR_YES or explicit_qr):
            return {"question": "register" if english else "登记二维码", "selected_id": card["id"]}
    elif stage == "product_selection":
        ordered = [by_id.get(eid) for eid in pending.get("product_ids", [])]
        products = [c for c in ordered if c]
        ordinal = re.fullmatch(r"第([一二三四五六七八九十1-9])(?:个|件|款)(?:展品|产品)?", decision)
        index = None
        if ordinal:
            index = int(ordinal[1]) - 1 if ordinal[1].isdigit() else "一二三四五六七八九十".index(ordinal[1])
        english_ordinals = ["firstproduct", "secondproduct", "thirdproduct", "fourthproduct"]
        if decision in english_ordinals:
            index = english_ordinals.index(decision)
        if index is not None and index < len(ordered) and ordered[index]:
            card = ordered[index]
            return {"question": f"Please introduce {card['name']}." if english else f"请介绍{card['name']}。", "selected_id": card["id"]}
        if products and (index is not None or decision in YES | {"它", "这个", "那个"}):
            return {"question": question, "selected_id": None,
                    "answer": "Please choose one of the displayed products by name or number." if english else "请选择当前展示的展品，可以说名称或第几个，也可以点击展品卡片。",
                    "related": products, "flow": pending}
    return {"question": question, "selected_id": selected_id}


def plan_followup(result, answer, related, cards, english):
    if not answer or result.status != "matched" or not result.exact_hit or result.truncated or result.reason != "exact_match" or len(result.items) != 1:
        return answer, related, None
    item = result.items[0]
    if item.get("type") == "exhibitor":
        products = [c for c in cards if c["kind"] == "exhibit" and c.get("parent_id") == item["id"]]
        if "exhibits" in item and result.intent in {"list", "intro"}:
            ids = [p["id"] for p in item["exhibits"]]
            by_id = {p["id"]: p for p in products}
            products = [by_id[eid] for eid in ids if eid in by_id]
            if products:
                prompt = "Which product would you like to learn about? Select a card or say its number." if english else "您想了解哪一款展品？可以点击展品卡片，也可以说第几个。"
                return answer + " " + prompt, products, {"stage": "product_selection", "entity_id": item["id"], "product_ids": ids}
        elif result.intent == "intro" and products:
            prompt = f"Would you like to learn about {item['name']}'s products?" if english else f"您是否需要了解{item['name']}的展品？"
            return answer + " " + prompt, related, {"stage": "exhibitor_products", "entity_id": item["id"]}
    if item.get("type") == "exhibit" and result.intent == "intro" and len(related) == 1 and related[0].get("survey_path"):
        prompt = "Would you like the registration QR code for this product?" if english else "您是否需要这个展品的登记二维码？"
        return answer + " " + prompt, related, {"stage": "registration", "entity_id": item["id"]}
    return answer, related, None
