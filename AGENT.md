# 陈文凯项目开发 Agent 指南

本文件是四川博览集团数字人项目的编程开发约束，面向负责 OpenTalking 会话、实时媒体和运行时后端的陈文凯。开始任务前先阅读本文件，再根据改动范围阅读源码、测试和文档。这里记录的是当前仓库真实代码的协作规则，不替代源码、测试或接口实现。

## 1. 负责范围

陈文凯的主要职责是 OpenTalking 运行时后端：

- `sessions` 会话创建、状态、生命周期和并发控制；
- SSE 会话事件、Redis/内存事件总线和事件时序；
- WebRTC 信令、音频/视频 track、媒体队列和音画同步；
- 文本、语音、音频直驱三条输入链路；
- LLM → TTS → talking-head backend → WebRTC 的实时流水线；
- API/Worker 分离模式与 `apps/unified` 单进程模式的兼容；
- 健康检查、模型可用性、队列状态、错误码和运行时降级；
- 与 Web、Admin 实时测试页面之间的 OpenTalking 接口兼容。

以下内容不应在没有明确任务时顺手承担：

- Admin 的展会、展商、展品、线索、报表、RBAC 等业务 CRUD；
- RAG、知识库发布、强控 QA 和导航检索的业务实现；
- LLM、STT、TTS 或 OmniRT 服务本身的托管、多卡调度和模型权重生命周期；
- TURN 服务、生产认证、账号体系和权限平台。

如果任务同时涉及上述领域，先明确边界：OpenTalking 负责运行时编排和接口兼容，业务数据由对应的 Server/业务服务负责，重模型推理由配置的 backend 或 OmniRT 负责。

## 2. 开始任务的阅读顺序

先在仓库根目录确认状态：

```bash
git status --short
rg --files
```

每次任务至少阅读：

1. `README.md`：四川博览集团项目当前业务范围、启动方式、当前缺口和团队分工。
2. `apps/web所需补充接口.md`：Web 当前依赖的展会配置、导航和会话接口。
3. `apps/admin所需补充接口.md`：Admin 需要的 OpenTalking 兼容接口和后端开放清单。
4. `apps/admin功能规划.md`：Admin 与 Server/Web 的业务闭环和运行时联调要求。
5. 与任务直接相关的源码和测试；不要只依据规划文档判断接口是否已经存在。

运行时后端任务优先阅读：

```text
apps/api/main.py
apps/api/routes/sessions.py
apps/api/routes/events.py
apps/api/routes/health.py
apps/api/routes/models.py
apps/api/services/session_service.py
apps/api/schemas/session.py
apps/unified/main.py
opentalking/runtime/task_consumer.py
opentalking/runtime/server.py
opentalking/pipeline/session/runner.py
opentalking/pipeline/speak/synthesis_runner.py
opentalking/providers/rtc/aiortc/adapter.py
opentalking/core/session_store.py
opentalking/core/redis_keys.py
opentalking/core/config.py
opentalking/core/model_config.py
opentalking/providers/synthesis/backends.py
opentalking/providers/synthesis/availability.py
```

接口或前端联调任务再阅读：

```text
apps/web/src/lib/api.ts
apps/web/src/lib/sse.ts
apps/web/src/lib/webrtc.ts
apps/web/src/App.tsx
apps/admin/src/admin/api.ts
apps/admin/src/admin/openTalkingClient.ts
```

## 3. 当前项目的真实边界

项目是四川博览集团展会数字人平台，包含 Admin 管理后台和 Web 数字人端，但底层实时能力来自 OpenTalking。

实际运行链路是：

```text
浏览器
  ├─ HTTP：创建会话、发送文本/文件、查询状态
  ├─ SSE：接收会话队列、字幕、播报和错误事件
  ├─ WebSocket：流式 PCM 语音输入
  └─ WebRTC：接收音频和视频 track
        ↓
apps/api
  ├─ Redis session hash：会话状态和配置
  ├─ Redis task queue：把 init/speak/interrupt/close 交给 Worker
  └─ Redis pub/sub：把 Worker 事件转给 SSE
        ↓
opentalking.runtime
  └─ SessionRunner 或 FlashTalkRunner
        ↓
LLM → TTS → 本地 adapter / direct WebSocket / OmniRT → WebRTC
```

当前代码中，`apps/api/main.py` 注册的路由包括健康、模型、头像、声音、会话、事件、知识、记忆、场景、运行配置、视频和导出等。当前并没有完整实现规划文档中的 `/api/v1/admin/*` 业务路由。

Admin 目前是原型优先：`apps/admin/src/admin/api.ts` 的 `FetchAdminApiClient` 只真正覆盖了登录、首页、GIF 列表和 GIF 删除，其余大部分方法仍继承 Mock 客户端。`VITE_ADMIN_API_MODE=real` 不代表所有页面已经接入真实后端。不要把 `apps/admin所需补充接口.md` 或 `apps/admin功能规划.md` 中的目标接口误认为现有接口。

Web 已经实际调用：

- `/sessions` 及其会话子接口；
- `/sessions/{id}/events` SSE；
- `/sessions/{id}/webrtc/offer`；
- `/sessions/webrtc/ice-config`；
- `/sessions/{id}/transcribe`、`speak_audio`、`speak_flashtalk_audio`；
- `/exhibitions/{id}/digital-human-config`；
- `/exhibitions/{id}/navigation/query`。

其中展会配置和导航接口在当前 API 路由中尚未形成完整业务实现。若要补充，必须明确是运行时兼容接口还是展会业务服务接口，不要把业务查询逻辑硬塞进通用会话流水线。

## 4. 两种部署模式必须同时考虑

### 4.1 Unified 单进程开发模式

入口是 `apps/unified/main.py`，通常通过以下命令启动：

```bash
bash scripts/start_unified.sh --mock
```

Unified 模式的特点：

- API、Worker、任务消费者和 `SessionRunner` 在同一进程；
- 使用 `InMemoryRedis`，不依赖外部 Redis；
- `app.state.session_runners` 保存当前进程中的 runner；
- API 在某些模型上会直接等待同进程 runner ready；
- `apps/unified` 强制 Uvicorn 使用一个 worker；不能使用 `--workers > 1`；
- 不要把只存在于 `app.state` 或 Python 全局变量的数据当成跨进程状态。

### 4.2 API + Worker + Redis 分离模式

API 入口是 `apps/api/main.py`，Worker 入口是 `opentalking/runtime/main.py` / `opentalking/runtime/server.py`。两者通过 Redis 协作：

- API 将会话 hash 写入 Redis；
- API 将 JSON 任务写入 `opentalking:task_queue`；
- Worker 使用 `BRPOP` 消费任务并维护本进程的 `runners`；
- Worker 将事件发布到 `opentalking:events:{session_id}`；
- API 的 `GET /sessions/{session_id}/events` 订阅该频道并输出 SSE；
- WebRTC Offer 在分离模式由 API 转发到 Worker 的 `/webrtc/{session_id}/offer`；
- 需要共享文件系统的录制、离线导出和模型资产必须确认 API/Worker 两端路径一致。

分离模式的最小环境变量通常包括：

```text
OPENTALKING_REDIS_URL=redis://localhost:6379/0
OPENTALKING_WORKER_URL=http://127.0.0.1:9001
OPENTALKING_AVATARS_DIR=./examples/avatars
OPENTALKING_TORCH_DEVICE=cpu|cuda|cuda:0
```

修改任务、会话状态、音频临时数据或录制流程时，必须分别验证 Unified 和分离模式，至少保证任务 JSON 可序列化、Redis 读写可用、Worker 不依赖 API 进程内存。

## 5. 会话生命周期与任务协议

### 5.1 创建会话

`POST /sessions` 在 `apps/api/routes/sessions.py` 中负责：

1. 解析 `persona_id` 默认值，或校验 `avatar_id`、`model`；
2. 校验 Avatar bundle；
3. 通过 `connected_model_ids()` 判断所选模型是否在当前部署可用；
4. 规范化 TTS/STT provider、voice、model 和 agent/knowledge 参数；
5. 将会话配置写入 Redis session hash；
6. 通过 `session_service.create_session()` 推送 `cmd=init`；
7. 根据模型和部署模式返回 `created`、`initializing` 或 `queued`。

当前响应中的 `status` 是创建响应状态，不等于 Redis `state`。FlashTalk 排队主要通过 `session.queued` 事件表达，不能简单把所有 `queued` 都写成永久会话状态。

### 5.2 当前代码中的会话状态

代码和测试中实际出现的状态包括：

```text
created → worker_ready → ready ↔ speaking → closing → closed
                                      └──────→ error
```

`start` 是兼容性钩子，会把会话标记为 `ready`；Worker 初始化完成后会写 `worker_ready`。终态 `closed` 和 `error` 的 session hash 由 `opentalking/core/session_store.py` 设置 TTL，非终态会尽量保持持久。新增状态前先检查前端轮询、SSE 处理和现有测试。

### 5.3 当前任务命令

任务定义分散在 `apps/api/services/session_service.py`、`opentalking/runtime/task_consumer.py`，当前主要命令是：

| 命令 | 作用 |
| --- | --- |
| `init` | 创建 runner、加载 Avatar/模型并执行 `prepare()` |
| `speak` | 文本进入 chat/speak 流水线 |
| `speak_flashtalk_audio` | 已解码 PCM 直接驱动 talking-head，绕过 STT/LLM/TTS |
| `interrupt` | 取消当前生成、清理媒体队列并回到 ready |
| `update_agent_knowledge_bases` | 更新运行中 runner 的知识库选择 |
| `update_fasterliveportrait_config` | 更新运行中 FLP 参数 |
| `flashtalk_offline_bundle` | 离线音视频导出任务 |
| `close` | 关闭 runner 并从 Worker runner 表移除 |

任何新增命令都必须同时修改 API/service、Worker handler、Unified 路径和对应测试。任务只传 JSON 可序列化的值；大段 PCM 不要直接塞进任务 JSON，当前实现使用带 TTL 的 Redis 临时 key。

## 6. 输入接口契约

### 文本

`POST /sessions/{session_id}/speak` 接收 `text` 和可选的 `voice`、`tts_provider`、`tts_model`。服务端会先发送一次 `interrupt`，再把 `speak` 任务入队，因此新输入会抢断上一条播报。不要在新增入口中绕过这一语义。

### HTTP 语音

- `POST /sessions/{id}/transcribe`：上传音频，只做 STT，返回 `{session_id, text}`，不触发播报；
- `POST /sessions/{id}/speak_audio`：上传音频 → 转 16kHz 单声道 WAV → STT → 文本 speak；
- `POST /sessions/{id}/speak_flashtalk_audio`：上传音频 → 解码为 16kHz mono PCM → Redis 临时 key → Worker 直接驱动视频。

当前上传上限是 15 MB，空文件直接报错；临时上传文件在请求结束时清理。变更上传格式或大小时，同时更新前端、测试和接口文档。

### 流式 STT WebSocket

当前实现以 `apps/api/routes/sessions.py` 为准：

1. 首帧必须是 JSON 文本，且 `type` 为 `meta`；可带 `voice`、`tts_provider`、`tts_model`、`stt_provider`；
2. 后续二进制帧是 16kHz、单声道、s16le PCM；
3. 文本控制帧使用 `{ "type": "end" }` 标识输入结束；
4. 服务端完成 STT 后将文本入队 speak，并返回 `{session_id, status, text}`；
5. STT 超时、空文本或 provider 错误会返回错误并关闭连接。

规划文档或旧文档中出现的 `config`、`eos`、`transcript/llm/tts/frame/status` 协议不能直接覆盖当前实现。修改此 WebSocket 协议前先同步 `apps/web` 调用代码和测试，避免只改后端。

## 7. SSE 事件约束

SSE 路由是 `apps/api/routes/events.py`，事件生产主要在 `opentalking/runtime/bus.py` 和两个 runner 中。消息由 Redis pub/sub JSON 转成：

```text
event: <event_name>
data: <json>

```

当前 Web 端重点消费：

| 事件 | 作用 |
| --- | --- |
| `session.queued` | FlashTalk/FlashHead 的等待、占用、队列满或超时；`position=0` 表示可继续建 WebRTC |
| `session.expiring` | 即将达到最大会话时长 |
| `session.expired` | Worker 强制结束会话 |
| `speech.started` | 一轮播报开始 |
| `speech.media_started` | 首个有效媒体已进入 WebRTC 队列，前端可显示字幕 |
| `subtitle.chunk` | 分句或完整文本字幕 |
| `speech.ended` | 播报结束；chat 场景可能携带完整回复文本 |
| `error` | 可展示的错误码和错误信息 |
| `ping` | API SSE 生成器每 30 秒发送的保活消息 |

运行时还可能产生 `assistant.message`、`speech.timing` 等诊断/扩展事件。新增事件时：

- 事件名使用稳定的小写点号命名；
- payload 必须是可 JSON 序列化的对象，并携带 `session_id`；
- 说明事件是在任务入队、LLM token、TTS 首块、首个视频帧还是播报结束时产生；
- 不要把 WebRTC 媒体帧本身通过 SSE 发送；
- 若前端依赖新事件，必须同步 `apps/web/src/lib/sse.ts` 和相应测试；
- 保证订阅建立后不会因为慢客户端无限阻塞 Worker。

`speech.media_started` 是音画同步的重要边界。不要在只有 `speech.started` 或只有字幕时就假设浏览器已经收到有效媒体。

## 8. WebRTC 与媒体流水线

### 8.1 信令

- `GET /sessions/webrtc/ice-config` 返回浏览器使用的 ICE servers 和 `iceTransportPolicy`；
- 浏览器在 `apps/web/src/lib/webrtc.ts` 创建 recvonly 的 audio/video transceiver，等待 ICE gathering 完成后发送 Offer；
- `POST /sessions/{id}/webrtc/offer` 在 Unified 模式直接调用 runner，在分离模式转发给 Worker；
- Worker/runner 创建 `WebRTCSession`，挂载视频和音频 track。

ICE/TURN 配置来源是 `OPENTALKING_WEBRTC_ICE_SERVERS`、`OPENTALKING_WEBRTC_STUN_URL(S)`、`OPENTALKING_WEBRTC_TURN_*` 以及服务端专用的 `OPENTALKING_WEBRTC_SERVER_ICE_SERVERS`。有 TURN 时默认策略可能变为 `relay`，不要把浏览器配置和服务端 aiortc 配置混为一套。

### 8.2 Track 与时间轴

`opentalking/providers/rtc/aiortc/adapter.py` 的默认模式是 `buffered`：

- `VideoFrameData` 携带 BGR/RGB `uint8` 帧、尺寸和 `timestamp_ms`；实际送入 aiortc 时按 `bgr24` 创建 `VideoFrame`；
- 音频 track 将 int16 PCM 按固定帧长切分，默认约 20 ms；
- 音频和视频使用共享 wall clock，首个媒体到达时建立播放时间基准；
- `reset_clocks()` 重置播放时间基准，但不回退 RTP/PTS 计数；
- `clear_media_queues()` 丢弃待播放音视频，但不回退 PTS；
- `close()` 放入 sentinel 并关闭 PeerConnection。

打断或新一轮播报开始时应清理旧媒体队列并重置时钟，但不能关闭 WebRTC 连接，也不能直接重置连续的 PTS。修改 track 队列、音频采样率、视频 timestamp 或背压时，必须运行 `tests/unit/test_aiortc_adapter.py` 和渲染管线测试。

### 8.3 Runner 选择

`opentalking/runtime/task_consumer.py::_create_runner()` 根据模型和 backend 选择 runner：

- `FlashTalkRunner`：mock、`omnirt`、`direct_ws`，以及 local 的 `musetalk`/`quicktalk`/`wav2lip` 音频驱动路径；
- `SessionRunner`：其他本地 adapter 路径。

本地音频驱动通过 `LocalAudio2VideoClient` 使用单线程 executor，避免阻塞 asyncio；远端路径通过 `OmniRTAudio2VideoClient` 包装 WebSocket client。重模型不要伪装成 local adapter；新远程推理应优先接入 `opentalking/providers/synthesis/`。

### 8.4 播报和打断

文本 chat 的实际流程是：

```text
create_chat_task
  → LLM 流式 token
  → SentenceSplitter 分句
  → 每句 TTS 流
  → 音频 chunk 队列
  → talking-head 生成视频帧
  → 音频/视频进入 WebRTC
```

`SessionRunner` 和 `FlashTalkRunner` 都使用 `_speak_lock` 保护一轮播报；`FlashTalkRunner` 还会处理 prebuffer、播放背压、空闲帧、首个媒体事件和远端会话重置。

打断必须做到：

1. 设置取消标志并取消当前 speech task；
2. 停止继续读取 LLM/TTS/上游 WebSocket；
3. 清空旧媒体队列、重置播放时钟和渲染事件；
4. 只发布一次合理的 `speech.ended`；
5. 未关闭的会话恢复为 `ready`；
6. 维持 idle 视频和 WebRTC track。

不要为了实现抢断而新建第二个 session，也不要只取消 Python task 而不清理 WebRTC 队列或远端 talking-head 会话。

## 9. 模型、backend 和配置

当前模型 backend 的来源优先级是：

1. 进程环境变量/`.env`；
2. legacy 环境变量；
3. `configs/default.yaml` 或 `OPENTALKING_CONFIG_FILE`/`CONFIG_FILE` 指向的 YAML；
4. `opentalking/core/config.py` 和 `opentalking/core/model_config.py` 的代码默认值。

模型 backend 在 `opentalking/core/model_config.py`、`opentalking/providers/synthesis/backends.py` 解析，支持 `mock`、`local`、`direct_ws`、`omnirt`。当前 `configs/default.yaml` 的关键配置是：

| 模型 | 当前 YAML backend |
| --- | --- |
| `mock` | `mock` |
| `wav2lip` | `local` |
| `musetalk` | `omnirt` |
| `flashtalk` | `omnirt` |
| `fasterliveportrait` | `omnirt` |
| `flashhead` | `direct_ws` |
| `quicktalk` | `omnirt` |

命令行或环境变量可以覆盖 YAML，例如：

```bash
OPENTALKING_QUICKTALK_BACKEND=local
OPENTALKING_WAV2LIP_BACKEND=omnirt
OMNIRT_ENDPOINT=http://127.0.0.1:9000
OMNIRT_API_KEY=<optional-token>
```

OmniRT 默认从 `OMNIRT_ENDPOINT` 派生 `/v1/audio2video/{model}` WebSocket 地址；可用 `OMNIRT_AUDIO2VIDEO_PATH_TEMPLATE` 或 Settings 前缀形式覆盖。`OPENTALKING_FLASHTALK_WS_URL`、`OPENTALKING_FLASHHEAD_WS_URL` 等是 direct/legacy 路径，不能写成所有模型的必填项。

`GET /models` 返回 `models`、`statuses`、`default_model`；`statuses` 的 `reason` 是排障契约，例如 `local_adapter_missing`、`omnirt_unavailable`、`not_configured`。会话创建会拒绝未连接模型，不能静默切换到另一个模型。

修改 backend、模型状态、模型参数时，优先检查：

```text
opentalking/core/model_config.py
opentalking/providers/synthesis/backends.py
opentalking/providers/synthesis/availability.py
opentalking/providers/synthesis/omnirt.py
opentalking/runtime/task_consumer.py
```

## 10. 关键配置和安全规则

常用运行时变量包括：

```text
OPENTALKING_REDIS_URL
OPENTALKING_WORKER_URL
OPENTALKING_AVATARS_DIR
OPENTALKING_TORCH_DEVICE
OPENTALKING_API_HOST / OPENTALKING_API_PORT
OPENTALKING_UNIFIED_HOST / OPENTALKING_UNIFIED_PORT
OPENTALKING_LLM_BASE_URL / OPENTALKING_LLM_API_KEY / OPENTALKING_LLM_MODEL
OPENTALKING_TTS_* / OPENTALKING_STT_*
OMNIRT_ENDPOINT / OMNIRT_API_KEY
OPENTALKING_<MODEL>_BACKEND
OPENTALKING_WEBRTC_*
```

规则：

- 修改配置时说明值来自 `.env`、Settings、legacy env、YAML 还是请求级覆盖；
- 不要把 provider 未配置伪装成成功，也不要未经用户选择静默替换音色或 provider；
- API 应返回可诊断的 4xx/5xx 和稳定错误信息，前端才能正确恢复；
- 不提交 `.env`、真实 API key、内网地址、模型权重、缓存、生成视频、上传头像和个人绝对路径；
- 校验所有用户传入的 `avatar_id`、artifact 名称、文件路径，保持路径在预期根目录内；
- 外部请求、ffmpeg、模型推理和同步 adapter 不得阻塞事件循环；必要时使用 `asyncio.to_thread` 或已有 executor；
- 所有异常路径都要释放临时文件、WebSocket、Redis pubsub、后台 task、executor 和 WebRTC peer；
- 记录 session、model、provider、task/job id 和 timing，但不要打印密钥或完整音频内容。

## 11. 展会 Web/Admin 联调边界

### Web

`apps/web/src/App.tsx` 当前流程是：

```text
GET /health
  → POST /sessions
  → 对 queued/initializing 轮询 session 或等待 session.queued
  → GET SSE /sessions/{id}/events
  → WebRTC Offer
  → POST /sessions/{id}/start
  → speak / transcribe / speak_audio / interrupt
```

语音识别文本会在前端按展会关键词分为导航或普通展会问答。导航分支调用 `/exhibitions/{id}/navigation/query`，再把 `spoken_text` 送入 `/speak`。导航服务不可用时前端会回退到普通问答；后端不要假设每一条输入都来自 LLM。

### Admin

Admin 实时测试应复用 OpenTalking 的 `/health`、`/models`、`/avatars`、`/voices`、`/sessions`、SSE 和 WebRTC 接口。Admin 的形象、声音、场景配置是管理层数据，不等于 runner 内部状态；如果要支持运行时配置变更，必须定义：

- 新会话生效还是当前 runner 立即生效；
- Unified 和分离模式是否一致；
- Redis 中是否持久化；
- 失败时返回什么 reason/error code；
- 是否需要重新建立 talking-head 或 WebRTC 会话。

不要为规划中的 Admin CRUD 复制一套与现有 `/avatars`、`/voices`、知识库接口同义但行为不同的 OpenTalking 私有接口，除非任务明确要求并给出迁移兼容方案。

## 12. 测试和验证

先运行与改动最接近的测试，再扩大范围。后端基础验证：

```bash
uv run pytest tests/unit/test_in_memory_redis.py tests/unit/test_omnirt_url.py -v
uv run pytest apps/api/tests/test_health.py apps/api/tests/test_models.py -v
uv run pytest apps/api/tests/test_sessions.py apps/api/tests/test_sessions_provider_key_gate.py -v
uv run pytest tests/unit/test_task_consumer.py tests/unit/test_session_runner_media_events.py -v
uv run pytest tests/unit/test_aiortc_adapter.py tests/unit/test_render_pipeline.py tests/unit/test_audio2video_client.py tests/unit/test_audio2video_runner.py -v
```

按改动范围选择额外验证：

| 改动 | 最小验证 |
| --- | --- |
| session schema/route/service | `apps/api/tests/test_sessions.py`、provider key gate |
| Redis session/任务/事件 | `tests/unit/test_in_memory_redis.py`、`tests/unit/test_task_consumer.py` |
| 队列/FlashTalk 生命周期 | `apps/api/tests/test_sessions.py`、`tests/unit/test_task_consumer.py` |
| SSE 事件 | `tests/unit/test_session_runner_media_events.py`，并检查前端 `test_subtitle_media_gating` |
| WebRTC/音画同步 | `tests/unit/test_aiortc_adapter.py`、`tests/unit/test_render_pipeline.py` |
| 本地/远端 audio2video | `tests/unit/test_audio2video_client.py`、`tests/unit/test_audio2video_runner.py`、对应模型测试 |
| 健康/模型发现 | `apps/api/tests/test_health.py`、`apps/api/tests/test_models.py`、`tests/unit/test_omnirt_url.py` |
| API 契约影响 Web | `cd apps/web && npm run typecheck && npm test && npm run build` |
| API 契约影响 Admin | `cd apps/admin && npm run typecheck && npm test && npm run build` |

全量检查：

```bash
uv run pytest
ruff check opentalking apps tests
```

`make test` 当前只执行 `pytest tests -v`，不包含 `apps/api/tests`；涉及 API 时不能只运行 `make test`。`make lint` 也只覆盖预设路径，改动 `providers`、`pipeline`、`runtime`、`models` 时应显式对实际路径执行 Ruff。

真实 LLM、TTS、STT、OmniRT、GPU/NPU、模型权重和 TURN 的验证受本地环境影响。缺依赖、密钥、外部服务或硬件时，报告为环境阻塞并保留原始错误，不要把它误判为代码必然错误。

## 13. 推荐的冒烟流程

### Mock/Unified

适合 API、SSE、WebRTC 信令、前端交互和大多数会话逻辑：

```bash
bash scripts/start_unified.sh --mock
```

默认 API 是 `http://127.0.0.1:8000`，Web 是 `http://localhost:5173`。可先检查：

```bash
curl -s http://127.0.0.1:8000/health
curl -s http://127.0.0.1:8000/models
curl -s http://127.0.0.1:8000/queue/status
curl -s http://127.0.0.1:8000/avatars
```

Windows 若没有 Bash，请使用 Git Bash/WSL，或分别启动 `uv run opentalking-unified`、前端 `npm run dev`，并按环境变量配置 mock backend。

### API/Worker 分离

需要验证 Redis 总线、跨进程任务、Worker WebRTC 转发时，使用本地 Redis，并分别启动：

```bash
# 终端 1
redis-server

# 终端 2：仓库根目录
uv run opentalking-api

# 终端 3：仓库根目录
uv run opentalking-worker

# 终端 4
cd apps/web
npm run dev
```

分离模式必须确认 API 和 Worker 的 `OPENTALKING_REDIS_URL`、`OPENTALKING_AVATARS_DIR` 一致，API 的 `OPENTALKING_WORKER_URL` 指向 Worker；多 Worker 时还要考虑同一 session 的 runner 所在进程和共享文件路径。

## 14. 编码协作规则

- 保持改动小而准，不顺手重构无关模块，不格式化整仓；
- 先读现有实现和测试，再决定扩展还是修复；
- 新增接口时同时补 schema、错误路径、Unified/分离兼容和测试；
- 新增后台任务时补正常、取消、超时、重复请求、session 已关闭和 Worker 不存在场景；
- 修改事件或状态时同时检查 Web 端实际消费者，而不是只检查规划文档；
- 修改音视频时同时检查首帧、首个音频、字幕显示、打断、WebRTC 断开和 idle 恢复；
- 不用“支持某模型”这种模糊描述，写清 model、backend、权重/资产目录、启动方式和验证端点；
- 使用 `rg` / `rg --files` 定位符号和文件，当前仓库是 flat layout，不要使用不存在的 `src/opentalking/...` 旧路径；
- Python 遵守项目 Ruff 配置（行宽 100，当前 lint 规则以 `pyproject.toml` 为准）；
- 前端保持 React + Vite + TypeScript 现有结构，API 类型集中在 `apps/web/src/lib/api.ts` 或对应 Admin 类型文件；
- 文档命令必须写执行目录，准确区分 mock、local、direct_ws、omnirt 和生产部署；
- 如果代码与 README、规划文档或旧 API 文档不一致，优先验证源码/测试，然后在同一任务中更新受影响文档或在交付说明中列出差异。

## 14.1 本轮实现状态（2026-08-04）

本轮已补齐并验证 `/api/v1/admin` 的数字人资产、交互配置、认证、运行时监控、队列监控、告警和 P1 报表接口；Admin `VITE_ADMIN_API_MODE=real` 已映射到这些接口。GIF 使用真实 multipart 文件存储与预览，报表使用 `report_events.json` 记录的真实事件，不应把无事件状态改成演示统计。

Python 依赖统一使用 Conda 环境 `humantalk`（Python 3.11）；当前环境路径为 `D:\Anaconda3\envs\humantalk`。新增的 `psutil` 已安装到该环境。前端依赖仍分别由 `apps/admin` 和 `apps/web` 的 npm 配置管理。

## 15. 提交前检查清单

```text
[ ] 已确认 git status，只包含本任务相关改动
[ ] 已阅读 README.md 和 apps 下三份项目 Markdown
[ ] 已核对 API/Worker/Unified 三种相关路径
[ ] 已考虑 session 已关闭、重复请求、打断、超时和外部服务失败
[ ] 新任务可以 JSON 序列化，跨进程文件/Redis 方案已确认
[ ] SSE/WebRTC/前端实际契约没有被无意破坏
[ ] 已运行针对性 pytest 和 ruff；前端契约变更已运行 typecheck/build
[ ] 未提交密钥、权重、缓存、媒体和个人路径
[ ] README、API 文档或 apps 规划与代码不一致的地方已说明
```

交付时说明：改了什么、影响哪条运行链路、执行了哪些命令、哪些验证因环境未执行，以及是否需要后端业务组、模型组或前端组继续联调。
