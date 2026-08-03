# Design QA

source visual truth:
- `/var/folders/dp/1psy8w3x5ggf1j3db1z8tfkc0000gn/T/codex-clipboard-d6911aeb-ab73-4b73-a9fc-758fcec2d51b.png` — 714 × 1082 px
- `/var/folders/dp/1psy8w3x5ggf1j3db1z8tfkc0000gn/T/codex-clipboard-45c1067a-e5bb-4ef9-9dd5-bac7d5a4e3ac.png` — 786 × 1152 px
- `/var/folders/dp/1psy8w3x5ggf1j3db1z8tfkc0000gn/T/codex-clipboard-f5ac4ae0-2412-4d72-b460-87a21a0d3179.png` — 762 × 1052 px
- `/var/folders/dp/1psy8w3x5ggf1j3db1z8tfkc0000gn/T/codex-clipboard-60053783-e784-4d3b-a50d-6ac2ba8348f1.png` — 744 × 1030 px

implementation screenshot:
- `/Users/hef/Downloads/四川博览集团数字人/opentalking-main/apps/web/design-qa-implementation-786x1152.png` — 786 × 1152 px
- `/Users/hef/Downloads/四川博览集团数字人/opentalking-main/apps/web/design-qa-implementation-live-786x1152.png` — 786 × 1152 px
- `/Users/hef/Downloads/四川博览集团数字人/opentalking-main/apps/web/design-qa-implementation-updated-762x1052.png` — 762 × 1052 px
- `/Users/hef/Downloads/四川博览集团数字人/opentalking-main/apps/web/design-qa-implementation-fullscreen-762x1052.png` — 762 × 1052 px
- `/Users/hef/Downloads/四川博览集团数字人/opentalking-main/apps/web/design-qa-implementation-clean-fullscreen-762x1052.png` — 762 × 1052 px
- `/Users/hef/Downloads/四川博览集团数字人/opentalking-main/apps/web/design-qa-implementation-full-bleed-662x1446.png` — 662 × 1446 px
- route: `http://localhost:5174/`
- CSS viewport: 662 × 1446 px; density normalization: none
- state: realtime display, live WebRTC session, idle after speech/interrupt; default voice input mode; full-bleed video crop

## Comparison evidence

Full-view comparison confirms the updated shell follows the reference direction: portrait-first full-bleed digital-human video, compact two-language rail, and a fixed translucent body-to-leg chat panel. The 662 × 1446 live capture has no video `contain` bars above or below the avatar, no redundant waveform card above the voice input, and keeps dialog content inside the panel without applying blur to the avatar. The idle-after-speech capture confirms the subtitle area is removed after playback instead of retaining the last response.

Focused regions checked:
- header/brand: compact white mark and bilingual label match the reference's restrained top chrome.
- language rail: right-aligned Chinese/English controls with selected-state affordance are present and interactive; no extra HOME item is rendered.
- chat/input: dialog history, live subtitle, suggestions, and the default voice input / keyboard toggle are contained in a fixed translucent panel anchored over the body-to-leg area.

## Fidelity surfaces

- Fonts and typography: system sans fallback keeps Chinese text legible; hierarchy uses compact uppercase metadata and larger white display text.
- Spacing and layout rhythm: portrait composition, right rail, centered start card, lower-third, and bottom dock remain inside the 786 × 1152 viewport without horizontal overflow.
- Colors and visual tokens: deep exhibition blue, cyan translucent panels, pale blue CTA, and white text follow the reference palette.
- Image quality and asset fidelity: the live `SceneStage`/`VideoBackground` path remains the source of avatar pixels; no screenshot placeholder is used. The live capture shows the remote avatar video at the intended portrait crop.
- Copy and app-specific text: Chinese exhibition/service copy is present; language switch changes the interaction metadata label.
- State behavior: subtitle appears during `speech.started` / subtitle chunks and disappears after `speech.ended` or interrupt; input defaults to voice mode and switches to keyboard mode on demand.
- Loading state: connecting/queued sessions show a spinner, status copy, and animated progress track in the center of the display.
- Fullscreen positioning: `SceneStage` uses the new `fullBleed` mode; caption, suggestion chips, and input dock use viewport-relative body-to-leg anchors.
- Invalid regions: the standalone brand header, watermark, and large bottom footer container were removed from the realtime display; only functional overlays remain.
- Video crop: realtime `SceneStage` now receives `videoFit="cover"`, removing the top/bottom letterbox caused by the remote stream's aspect ratio.
- Input cleanup: the standalone `READY TO ANSWER` waveform panel was removed; voice and keyboard controls share one compact card.
- Chat panel: the realtime dialog is rendered in one fixed translucent panel; the panel uses a tinted background without `backdrop-filter`, so the avatar stays sharp and visible beneath it.

## Findings

- [P3] The implementation uses a geometric exhibition backdrop rather than the exact architectural background from the supplied reference.
  Location: `src/index.css` display backdrop.
  Impact: shell direction matches, but the background image is not pixel-identical to the photographed screen.
  Fix: provide/upload the final exhibition background asset and select it as the scene background if exact visual parity is required.

## Primary interactions tested

- Language rail: `English` becomes the active selection and changes the metadata label to `REAL-TIME CONVERSATION`.
- Language scope: only `中文` and `English` are rendered.
- Backend proxy: `/health` returns `200 OK` through the configured remote backend target.
- Live session: `开始体验` establishes a live WebRTC session and the display changes to `LIVE`.
- Live question: sending `请介绍一下展馆服务` updates the subtitle, changes the waveform label to `DIGITAL HUMAN IS SPEAKING`, and changes the action to `打断`.
- Subtitle cleanup: after interrupting the active response, the subtitle is removed; the `speech.ended` path uses the same `clearSubtitleState()` cleanup.
- Input mode: default voice panel renders first; `键盘输入` reveals the text box, and `语音输入` returns to the voice panel.
- Loading animation: clicking `开始体验` shows `正在加载数字人` with a spinner and progress track while the WebRTC connection is being established.
- Fullscreen stage: the realtime display has no top/bottom page gap and the remote video stage is rendered in `fullBleed` mode.
- Chat panel: the realtime transcript, current subtitle, suggested questions, and voice/keyboard controls render inside the fixed translucent body-to-leg panel.
- Build checks: `npm run typecheck` and `npm run build` pass.

## Comparison history

- Iteration 1: initial implementation included the existing Studio top bar above the realtime display. Fix: realtime mode now renders as a pure display screen; other workflows retain the original top bar.
- Iteration 2: portrait screenshot re-captured at 786 × 1152 after the fix. No P0/P1/P2 shell mismatch remains; live-stream verification remains blocked by backend availability.
- Iteration 3: configured Vite's `/api` proxy to target `http://ai.oaii.cn:8210`, then re-captured the live and speaking state at 786 × 1152. WebRTC video, subtitle, waveform and interrupt affordance all rendered successfully.
- Iteration 4: reduced the language list to Chinese/English, removed persistent subtitle fallback, added voice-first input with keyboard toggle, and capped subtitle height to three lines. Re-captured at 762 × 1052 and re-tested the live session.
- Iteration 5: removed the realtime shell's reserved top-bar height, enabled full-bleed `SceneStage`, added the connecting loading animation, and moved caption/input anchors into the body-to-leg zone. Re-captured the live fullscreen state at 762 × 1052.
- Iteration 6: removed the extra top brand/watermark region and replaced the large bottom footer block with compact floating functional cards. Re-captured the clean fullscreen live state at 762 × 1052.
- Iteration 7: changed realtime video fitting from `contain` to `cover` and removed the redundant audio-status card. Re-captured at the supplied 662 × 1446 viewport.
- Iteration 8: removed the HOME item from the language rail and consolidated transcript, live subtitle, suggested questions, and input controls into a fixed translucent chat panel. Removed panel blur so the avatar remains sharp; the live 662 × 1446 viewport was verified after the CSS hot update.

final result: passed
