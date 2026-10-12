# 语音生成模型

语音生成模型通常以 TTS provider 的形式接入。它们将 LLM 输出转为音频，再驱动
talking-head backend。本文只做选型和入口导航；权重、启动、验证和排错放在各模型页面。

## Provider 选项

| Provider | 类型 | 适用场景 | 入口 |
|----------|------|----------|------|
| `edge` | 托管 / 在线 | 首次运行、CPU 评估、无需 API key | `.env` provider 配置 |
| `dashscope` | 托管 API | 中文实时 TTS、声音复刻、百炼体系 | `.env` provider 配置 |
| `cosyvoice` | 自托管服务 | 已有 CosyVoice WebSocket / HTTP 服务 | 服务提供方文档 |
| `elevenlabs` | 托管 API | 多语言托管音色 | `.env` provider 配置 |
| `local_cosyvoice` | 本地部署 | 本地中文 TTS、内置音色和复刻音色 | [CosyVoice](tts/cosyvoice.md) |
| `indextts` | 本地部署 / OmniRT | 可控配音、情绪控制和复刻音色 | [IndexTTS](tts/indextts.md) |
| `local_qwen3_tts` | 本地部署 | 本地 Qwen3-TTS Base 复刻音色 | [Qwen3-TTS](tts/qwen3-tts.md) |

## Edge TTS 连接配置

字幕已显示但没有语音和口型时，先检查服务端 TTS 日志是否生成了音频。Edge 合成连接返回 `403` 时，字幕仍可能正常，因为问答文本与语音合成是两个阶段。

若已验证可用的 HTTP 代理能完成语音合成，可在项目根目录 `.env` 设置 `OPENTALKING_TTS_EDGE_PROXY=http://127.0.0.1:7890`，然后重启 API。也支持 YAML 的 `tts.edge_proxy`，进程环境变量优先。留空保持直连；此项只用于 Edge 语音连接，不改变 Dify、STT 或数字人模型连接，也不改变音色。代理地址应使用实际可用的本地或受信代理。

## 本地模型入口

- [CosyVoice 本地部署](tts/cosyvoice.md)
- [IndexTTS 本地部署](tts/indextts.md)
- [Qwen3-TTS 本地部署](tts/qwen3-tts.md)

每个本地模型页面都包含适用场景、权重准备、启动命令、验证命令和常见错误。
