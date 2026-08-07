# Web 会展选择与数字人启动 Design QA

- Source visual truth: `/var/folders/dp/1psy8w3x5ggf1j3db1z8tfkc0000gn/T/codex-clipboard-e52dd61f-9af3-4479-9093-31b2cef434b3.png`
- Implementation screenshot: `/private/tmp/web-exhibition-selection-viewport.png`
- Combined comparison: `/private/tmp/web-exhibition-selection-comparison.png`
- Viewport: 680 × 880 CSS px
- Source pixels: 680 × 880
- Implementation pixels: 680 × 880
- Device scale / normalization: browser capture already matched the source pixel size; no density normalization applied
- State: 会展选择列表展开，尚未选择会展

**Findings**

- Earlier P1 — 原生下拉浮层遮挡页面标题和说明。
  - Evidence: source screenshot shows the operating-system select menu floating over the heading and body copy. The revised capture renders the option list directly below the trigger inside the card.
  - Fix made: replaced the native `<select>` with an accessible controlled combobox/listbox, added bounded scrolling, consistent dark theme tokens, selected state, outside-click close and Escape close.
  - Post-fix evidence: `/private/tmp/web-exhibition-selection-comparison.png`.

- Earlier P1 — 展会确认后可能在绑定模型应用前使用默认 `flashtalk` 自动启动。
  - Evidence: the reported error said only `mock` was available, while the public exhibition record binds `bound_model=mock`.
  - Fix made: added an exhibition-binding readiness gate; confirmation immediately applies the bound avatar/model; automatic start requires exact bound avatar/model equality; session start refuses an unbound or not-yet-ready configuration.
  - Post-fix evidence: with only `mock` connected, selecting `exhibition-real-2026` reached “会话已连接” and produced no browser console error.

- Earlier P2 — Web 实时连接卡片暴露“更换形象”，与展会绑定配置冲突。
  - Fix made: removed the change-avatar callback and button from `DigitalHumanDisplay`; the start metadata now only displays the bound avatar and model.

**Required fidelity surfaces**

- Fonts and typography: existing Chinese sans-serif stack, weights, line heights and cyan eyebrow tracking remain consistent; option names and identifiers now have separate readable hierarchy.
- Spacing and layout rhythm: the list expands in normal flow, stays within the card and viewport, and no longer covers the heading or explanatory copy.
- Colors and visual tokens: preserved the navy, slate and cyan palette; focus, active and selected states use the existing cyan token family.
- Image quality and asset fidelity: this screen contains no raster or custom illustration assets requiring replacement; background and card treatments remain the existing product implementation.
- Copy and content: retained the original exhibition selection copy; added only functional “选择 / 收起 / 已选择” state labels.

**Focused region comparison**

- A separate crop was unnecessary because the full 680 × 880 comparison keeps the heading, trigger, option row, status area and CTA legible at the same scale.

**Primary interactions tested**

- Open and close the exhibition list.
- Select `真实数据展会 2026`.
- Confirm and enter the digital-human experience.
- Automatic session startup reached the connected state while the backend reported only `mock` as connected.
- Checked browser warning/error logs after connection: none.
- Confirmed the rendered flow contains no “更换形象” entry.

**Comparison history**

1. Initial source: native dropdown overlays the hero content and the startup request can race with the exhibition model binding.
2. Revision: in-flow listbox, bound-model readiness gate, and removed avatar-change control.
3. Post-fix capture: no overlapping content, selection remains within the card, and the mock-only session connects successfully.

**Follow-up polish**

- No remaining P0/P1/P2 visual findings. Minor text-density tuning can be handled as a later P3 iteration if more exhibitions are added.

final result: passed
