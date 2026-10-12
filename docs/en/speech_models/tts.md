# Speech Generation Models

Speech generation models are usually integrated as TTS providers. They convert LLM
output into audio that drives the talking-head backend. This page is only for model
selection and navigation; weight preparation, startup, verification, and troubleshooting
live in the model pages.

## Provider Options

| Provider | Type | Best for | Entry |
|----------|------|----------|-------|
| `edge` | Hosted / online | First run, CPU evaluation, no API key | `.env` provider config |
| `dashscope` | Hosted API | Chinese realtime TTS, voice cloning, DashScope deployments | `.env` provider config |
| `cosyvoice` | Self-hosted service | Existing CosyVoice WebSocket / HTTP service | Service-specific docs |
| `elevenlabs` | Hosted API | Hosted multilingual voices | `.env` provider config |
| `local_cosyvoice` | Local deployment | Local Chinese TTS, built-in voices, and cloned voices | [CosyVoice](tts/cosyvoice.md) |
| `indextts` | Local deployment / OmniRT | Controllable dubbing, emotion control, and voice cloning | [IndexTTS](tts/indextts.md) |
| `local_qwen3_tts` | Local deployment | Local Qwen3-TTS Base voice cloning | [Qwen3-TTS](tts/qwen3-tts.md) |

## Edge TTS Connection

If subtitles appear without speech or mouth animation, check whether the server generated TTS audio. An Edge synthesis `403` can leave subtitles working because question answering and speech synthesis are separate stages.

If synthesis succeeds through a verified HTTP proxy, set `OPENTALKING_TTS_EDGE_PROXY=http://127.0.0.1:7890` in the repository root `.env` and restart the API. YAML `tts.edge_proxy` is also supported; process environment variables take priority. Leave it empty for direct connections. This proxy applies only to Edge speech and does not change Dify, STT, talking-head connections, or the selected voice. Use the address of an available local or trusted proxy.

## Local Model Entries

- [CosyVoice Local Deployment](tts/cosyvoice.md)
- [IndexTTS Local Deployment](tts/indextts.md)
- [Qwen3-TTS Local Deployment](tts/qwen3-tts.md)

Each local model page contains use cases, weight preparation, startup commands,
verification commands, and common errors.
