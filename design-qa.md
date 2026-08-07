# Design QA — 数字人会展实体卡片

## Reference and implementation

- Reference: `/var/folders/dp/1psy8w3x5ggf1j3db1z8tfkc0000gn/T/codex-clipboard-1c96b61d-fa1f-4bcd-b435-17fd456057fa.png`
- Implementation capture: `/tmp/opentalking-entity-card-portrait.png`
- Viewport: 716 × 1080 CSS px, DPR 1
- State: selected `真实数据展会 2026`, mock WebRTC session connected, typed entity keyword matched, assistant reply and entity card visible.

## Comparison history

1. First pass used a vertically stacked card in the short desktop chat viewport. Auto-scroll correctly reached the bottom, but the card title and summary could leave the visible area.
2. The card was moved onto the digital-human reply, changed to a horizontal layout on desktop, and kept vertical on narrow screens to match the supplied portrait reference.
3. Final portrait verification shows the digital human above the conversation area and a blue translucent detail card below the reply, with copy followed by the real entity image.

## Final checks

- Layout: passed — card remains inside the chat flow and adapts between desktop and portrait layouts.
- Typography and spacing: passed — entity type, name, description, metadata, and image have a clear hierarchy.
- Color and contrast: passed — the translucent blue card stays readable over the avatar background.
- Image behavior: passed — real service URLs render; missing entity images use documented related-entity fallbacks; no placeholder artwork is invented.
- Copy: passed — the UI uses the real database name, description, category, booth, and other public fields.
- Interaction: passed — typed keyword matching, entity-card rendering, loaded-image reflow, and automatic bottom scrolling were exercised in the browser.
- Runtime: passed — no browser console warnings or errors were present during the verified flow.
- P3 content note: the current database image for `真实科技有限公司` is a system diagram rather than a product photo. This is source-data quality and can be improved from Admin without a code change.

## Verification

- Web TypeScript check: passed
- Web production build: passed
- API tests: 10 passed
- Git diff whitespace check: passed

Final result: passed
