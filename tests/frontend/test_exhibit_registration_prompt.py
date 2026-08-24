from pathlib import Path


APP_SOURCE = Path("apps/web/src/App.tsx")


def test_all_resolved_exhibit_introductions_use_one_registration_flow() -> None:
    source = APP_SOURCE.read_text(encoding="utf-8")

    assert "const introduceExhibitAndOfferRegistration = async" in source
    assert "await introduceExhibitAndOfferRegistration(selectedProduct, text);" in source
    assert "await introduceExhibitAndOfferRegistration(pendingContent.entity, text);" in source
    assert "await introduceExhibitAndOfferRegistration(competingEntity, text);" in source
    assert "await introduceExhibitAndOfferRegistration(matchedExhibit, text);" in source


def test_registration_query_uses_canonical_exhibit_name_and_link_validation() -> None:
    source = APP_SOURCE.read_text(encoding="utf-8")
    helper = source.split("const introduceExhibitAndOfferRegistration = async", 1)[1].split("if (databaseShortcut", 1)[0]

    assert "text: exhibit.name" in helper
    assert "linkedEntityIds.has(exhibit.id)" in helper
    assert "exhibitId: exhibit.id" in helper
    assert "relatedEntities: [exhibit]" in helper
    assert "shopping.survey_path?.trim()" in helper
    assert "!shopping.strategy_id ? exhibit.survey_path?.trim() : undefined" in helper
    assert "registrationPath" in helper
    assert "当前展品暂未配置登记二维码。" in helper
    assert "登记服务暂时不可用，请稍后再试。" in helper


def test_existing_exhibit_survey_path_skips_strategy_registration_api() -> None:
    source = APP_SOURCE.read_text(encoding="utf-8")

    assert "pendingShopping.registrationPath" in source
    assert 'strategy_id: pendingShopping.strategyId || "exhibit-survey"' in source
    assert "path: pendingShopping.registrationPath" in source


def test_exhibit_match_takes_priority_over_an_overlapping_exhibitor_match() -> None:
    source = APP_SOURCE.read_text(encoding="utf-8")

    exhibit_branch = source.index('const matchedExhibit = relatedEntities.find((entity) => entity.kind === "exhibit");')
    exhibitor_branch = source.index('const matchedExhibitor = relatedEntities.find((entity) => entity.kind === "exhibitor");')

    assert exhibit_branch < exhibitor_branch
    assert 'if (matchedExhibit && match.intent !== "navigation")' in source
