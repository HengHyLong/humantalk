from pathlib import Path


APP_SOURCE = Path("apps/web/src/App.tsx")


def test_company_product_followup_releases_non_answers_to_normal_routing() -> None:
    source = APP_SOURCE.read_text(encoding="utf-8")
    block = source.split('if (pendingExhibition.stage === "exhibitor_products")', 1)[1].split(
        "const pendingShopping = pendingShoppingRegistrationRef.current;",
        1,
    )[0]

    assert "classifyProductInterestDecision(" in block
    assert "hasDifferentEntity" in block
    assert "Any non-answer is treated as a new conversation turn" in block
    assert "The user may ask a new question instead of choosing a listed product" in block
    assert block.count("pendingExhibitionFollowupRef.current = null;") >= 4
