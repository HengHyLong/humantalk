# 四川博览集团数字人项目

## Admin 后端 API 开放清单

> 本清单根据当前 `apps/admin` 与旧 Studio 实际代码整理。项目名称统一为“**四川博览集团数字人项目**”，不使用 OpenTalking Admin 作为产品名称。

## 1. 当前接入状态

### 1.1 已有 OpenTalking 服务，后端继续保留

以下接口已经被旧 Studio 或 Admin 实时测试页面真实调用，不属于新增 Admin CRUD，但需要保证接口兼容、错误信息稳定：

| 模块 | 方法 | 接口 | 用途 |
| --- | --- | --- | --- |
| 服务状态 | GET | `/health` | 服务、模型、TTS、STT 配置状态；包括 `tts_enabled_providers`、`tts_default_provider`、`stt_enabled_providers` 等字段 |
| 驱动模型 | GET | `/models` | 返回 `models`、`statuses`、`default_model` |
| 数字人 | GET | `/avatars` | 查询数字人形象列表 |
| 数字人 | GET | `/avatars/:id/preview` | 图片/GIF 预览 |
| 数字人 | GET | `/avatars/:id/preview-video` | 旧 Studio 视频预览 |
| 数字人 | POST | `/avatars/custom` | 新增图片形象或 GIF 形象 |
| 数字人 | DELETE | `/avatars/:id` | 删除自定义形象 |
| 数字人 | POST | `/avatars/:id/prewarm` | 预热数字人模型 |
| 音色 | GET | `/voices` | 系统音色、Edge 音色、复刻音色目录 |
| 音色 | POST | `/voices/clone` | 上传并创建复刻音色 |
| 音色 | DELETE | `/voices/:id` | 删除复刻音色 |
| TTS | POST | `/tts/preview` | 音色试听，返回音频 Blob |
| TTS | POST | `/tts/preview-duo-dialog` | 双人对话试听 |
| 场景 | GET/POST/DELETE | `/scene-assets/backgrounds` | 背景资产 |
| 场景 | GET/POST/PATCH/DELETE | `/scene-assets/compositions` | 场景组合 |
| 运行配置 | GET | `/runtime-config` | 当前运行时配置 |
| 运行配置 | POST | `/runtime-config/apply` | 应用运行时配置 |

`POST /avatars/custom` 应支持以下 multipart 字段：

- 普通形象：`name`、`image`、`model`、`person_mode`、`remove_background`。
- GIF 形象：`name`、`model=gif`、`person_mode`、`waiting_gif`、`speaking_gif`。
- GIF 的两张动图分别表示“等待聆听”和“张嘴讲话”，后端应保存两份资源并在预览/会话中按状态切换。

### 1.2 当前知识库、记忆库已有接口

知识库和记忆库仍复用旧 Studio 接口，不建议为了 Admin 再复制一套同义接口：

| 模块 | 方法 | 接口 | 用途 |
| --- | --- | --- | --- |
| 文档资料 | GET/POST | `/agent/knowledge-documents` | 文档列表、上传 Word/PDF/Markdown/TXT 等文件 |
| 文档资料 | DELETE/GET | `/agent/knowledge-documents/:id`、`/agent/knowledge-documents/:id/file` | 删除、下载/查看原文件 |
| 知识库 | GET/POST | `/agent/knowledge-bases` | 知识库列表、新建知识库 |
| 知识库 | PATCH/DELETE | `/agent/knowledge-bases/:id` | 修改名称、删除知识库 |
| 知识库文档 | GET | `/agent/knowledge-bases/:id/documents` | 查看知识库文档 |
| 知识库文档 | POST/DELETE | `/agent/knowledge-bases/:id/documents/import`、`/agent/knowledge-bases/:baseId/documents/:documentId` | 导入、移除文档 |
| 知识库文档 | POST | `/agent/knowledge-bases/:baseId/documents/:documentId/reindex` | 重新解析/向量化 |
| 记忆库 | GET/POST | `/memory/libraries`、`/memory/libraries/:id/import` | 记忆库列表、导入对话记忆 |
| 记忆条目 | GET/DELETE | `/memory/libraries/:id/items`、`/memory/libraries/:libraryId/items/:itemId` | 查询、删除记忆条目 |
| 微信导入 | POST | `/memory/wechat-import` | 上传微信聊天记录 |
| 微信导入 | POST | `/memory/wechat-import/:jobId/speaker`、`/memory/wechat-import/:jobId/commit` | 选择说话人、提交导入 |
| 形象知识库 | GET/PUT | `/agent/avatars/:avatarId/knowledge-bases` | 查询、保存形象关联知识库 |
| 会话知识库 | PUT | `/sessions/:sessionId/knowledge-bases` | 会话中临时切换知识库 |

文档接口的解析状态建议至少返回：`pending`、`parsing`、`parsed`、`failed`；向量化状态建议返回：`pending`、`indexing`、`indexed`、`failed`，并提供失败原因字段。

## 2. Admin 统一协议

### 2.1 基础路径与认证

Admin 新接口统一使用 `/api/v1` 前缀：

```text
http://<host>/api/v1/...
```

请求头：

```http
Authorization: Bearer <token>
Content-Type: application/json
```

文件上传使用 `multipart/form-data`。所有写入接口需要记录当前用户、时间和 `trace_id`。

### 2.2 列表返回格式

所有 Admin 列表接口统一支持：

```text
page       当前页，从 1 开始
page_size  每页数量，默认 9，最大由后端限制
keyword    关键字
status     状态筛选
sort_by    排序字段
sort_order asc / desc
```

统一返回：

```json
{
  "items": [],
  "total": 0,
  "page": 1,
  "page_size": 9
}
```

错误统一返回：

```json
{
  "code": "RESOURCE_CONFLICT",
  "detail": "该展商仍有关联展品，请先处理关联数据",
  "trace_id": "..."
}
```

日期时间使用 ISO 8601；日期字段使用 `YYYY-MM-DD`；状态变更接口返回变更后的完整对象。

## 3. P0：登录、权限与首页

### 3.1 登录与 Token

| 方法 | 接口 | 请求 | 返回/说明 |
| --- | --- | --- | --- |
| POST | `/api/v1/auth/login` | `{ username, password }` | `{ token, expires_at, user }` |
| GET | `/api/v1/auth/me` | Bearer Token | 当前 `AdminUser`、角色、菜单权限、按钮权限 |
| POST | `/api/v1/auth/refresh` | Bearer/refresh token | 新 Token 与过期时间 |
| POST | `/api/v1/auth/logout` | Bearer Token | 使当前 Token 失效 |
| GET | `/api/v1/auth/permissions` | Bearer Token | 权限码、菜单配置、角色说明 |

需要支持现有角色：`sys_admin`、`content_ops`、`data_viewer`、`security_audit`、`readonly`。权限至少覆盖菜单级、按钮级、接口级三层。

### 3.2 首页与审计

| 方法 | 接口 | 用途 |
| --- | --- | --- |
| GET | `/api/v1/admin/report` | 今日交互量、在线终端、待审知识、新增线索、告警、待办 |
| GET | `/api/v1/admin/alerts` | 告警列表、确认、关闭 |
| GET | `/api/v1/admin/audit-logs` | 登录、配置、发布、删除、生命周期变更记录 |
| GET | `/api/v1/admin/trace-records` | 按资源、操作人、时间查询变更前后数据 |

## 4. P0：数字人中心 Admin 数据接口

OpenTalking 的 `/avatars`、`/voices`、`/models`、`/health` 负责运行时能力；Admin 以下接口负责管理数据、编辑、状态和运营元数据。

### 4.1 形象管理

如后端不新增 Admin 形象表，也可以继续以 `/avatars` 为主数据源，但需要确保列表返回可编辑和绑定所需字段：

```text
id, name, model_type, width, height, person_mode,
is_custom, preview_url, waiting_gif_url, speaking_gif_url,
created_at, updated_at, status
```

建议提供：

| 方法 | 接口 | 用途 |
| --- | --- | --- |
| GET | `/api/v1/admin/assets/avatars` | 分页、搜索、按模型类型筛选形象 |
| GET | `/api/v1/admin/assets/avatars/:id` | 形象详情 |
| PATCH | `/api/v1/admin/assets/avatars/:id` | 修改名称、标签、描述、状态、绑定元数据 |
| DELETE | `/api/v1/admin/assets/avatars/:id` | 删除自定义形象；系统形象禁止删除 |

### 4.2 GIF 与场景资产

| 方法 | 接口 | 请求/用途 |
| --- | --- | --- |
| GET | `/api/v1/admin/assets/gifs` | 分页查询 GIF，支持场景、标签、状态筛选 |
| POST | `/api/v1/admin/assets/gifs` | multipart 上传 GIF，保存名称、场景标签、分组标签、宽高、帧数、时长、文件大小 |
| GET | `/api/v1/admin/assets/gifs/:id` | GIF 详情及预览地址 |
| PATCH | `/api/v1/admin/assets/gifs/:id` | 修改名称、标签、分组、状态、描述 |
| DELETE | `/api/v1/admin/assets/gifs/:id` | 删除 GIF；被场景绑定时返回冲突提示 |
| GET | `/api/v1/admin/assets/scene-bindings` | 查询场景与主资产、排序资产 |
| PUT | `/api/v1/admin/assets/scene-bindings/:scene` | 保存场景资产绑定、主资产和顺序 |
| GET | `/api/v1/admin/assets/idle-contents` | 待机宣传内容、标语轮播、活动主题 |
| POST | `/api/v1/admin/assets/idle-contents` | 新增待机内容 |
| PATCH | `/api/v1/admin/assets/idle-contents/:id` | 修改待机内容 |
| DELETE | `/api/v1/admin/assets/idle-contents/:id` | 删除待机内容 |

### 4.3 声音配置

`/health` 是运行时能力发现接口，`/voices` 是实际音色目录；Admin 声音配置还需要保存可运营的分组和启用状态：

| 方法 | 接口 | 用途 |
| --- | --- | --- |
| GET | `/api/v1/admin/assets/voice-configs` | 按 TTS 服务/模型类别分页查询音色 |
| POST | `/api/v1/admin/assets/voice-configs` | 新增一条声音配置 |
| GET | `/api/v1/admin/assets/voice-configs/:id` | 声音配置详情 |
| PATCH | `/api/v1/admin/assets/voice-configs/:id` | 修改服务商、模型、voice_id、名称、试听文本、状态 |
| DELETE | `/api/v1/admin/assets/voice-configs/:id` | 删除可删除的配置 |
| POST | `/api/v1/admin/assets/voice-configs/:id/preview` | 按配置试听；返回音频或明确的“后端未配置”错误 |

声音配置至少应包含：

```text
id, provider, target_model, voice_id, name, display_label,
preview_text, source, status, supports_preview, created_at, updated_at
```

后端应从 `/health` 的 `tts_enabled_providers`、`tts_default_provider`、`tts_providers` 提供运行时可用服务；Edge 的系统音色也要在 `/voices` 或 Admin 音色目录中返回。无法正常试听的音色不能伪造成功，应返回稳定错误码，例如 `TTS_PROVIDER_NOT_CONFIGURED`。

## 5. P0：知识中心 Admin 接口

### 5.1 文档资料

现有 `/agent/knowledge-documents` 可以继续承担文件存储、解析和向量化；若统一纳入 Admin 权限，建议提供兼容代理：

| 方法 | 接口 | 用途 |
| --- | --- | --- |
| GET | `/api/v1/admin/knowledge/documents` | 分页、按展会/类型/解析状态筛选 |
| POST | `/api/v1/admin/knowledge/documents` | multipart 上传文档 |
| GET | `/api/v1/admin/knowledge/documents/:id` | 文档详情、解析进度、失败原因 |
| GET | `/api/v1/admin/knowledge/documents/:id/file` | 下载/预览原文件 |
| PATCH | `/api/v1/admin/knowledge/documents/:id` | 修改标题、类型、展会归属 |
| DELETE | `/api/v1/admin/knowledge/documents/:id` | 删除文档；已被发布包引用时返回冲突或走明确级联策略 |
| POST | `/api/v1/admin/knowledge/documents/:id/reindex` | 重新解析/向量化 |

### 5.2 知识库、强控 QA、话术

| 方法 | 接口 | 用途 |
| --- | --- | --- |
| GET | `/api/v1/admin/knowledge/bases` | 知识库分页及展会筛选；底层可代理 `/agent/knowledge-bases` |
| GET | `/api/v1/admin/knowledge/bases/:id` | 知识库详情、文档数、发布状态 |
| POST | `/api/v1/admin/knowledge/qa` | 新增强控 QA |
| GET | `/api/v1/admin/knowledge/qa` | QA 分页、关键词、分类、审核状态筛选 |
| GET | `/api/v1/admin/knowledge/qa/:id` | QA 详情和版本历史 |
| PATCH | `/api/v1/admin/knowledge/qa/:id` | 编辑问题、关键词、答案、分类 |
| DELETE | `/api/v1/admin/knowledge/qa/:id` | 归档或删除 QA |
| POST | `/api/v1/admin/knowledge/qa/:id/transition` | `draft/pending_review/published/archived` 状态流转 |
| GET | `/api/v1/admin/knowledge/qa/:id/versions` | 查询历史版本 |
| POST | `/api/v1/admin/knowledge/qa/:id/rollback` | 回滚到指定版本，并记录原因 |
| GET | `/api/v1/admin/knowledge/scripts` | 迎宾、讲解、导购、应急话术模板 |
| POST | `/api/v1/admin/knowledge/scripts` | 新增话术模板 |
| PATCH | `/api/v1/admin/knowledge/scripts/:id` | 编辑话术模板 |
| DELETE | `/api/v1/admin/knowledge/scripts/:id` | 删除话术模板 |

### 5.3 发布包和未命中池

| 方法 | 接口 | 用途 |
| --- | --- | --- |
| GET | `/api/v1/admin/knowledge/packages` | 发布包列表 |
| POST | `/api/v1/admin/knowledge/packages` | 创建发布包，关联知识库/文档/QA版本 |
| GET | `/api/v1/admin/knowledge/packages/:id` | 发布包详情和内容快照 |
| POST | `/api/v1/admin/knowledge/packages/:id/submit` | 提交审核 |
| POST | `/api/v1/admin/knowledge/packages/:id/publish` | 审核通过并发布 |
| POST | `/api/v1/admin/knowledge/packages/:id/rollback` | 回滚已发布版本 |
| GET | `/api/v1/admin/knowledge/miss-pool` | 未命中问题分页查询 |
| POST | `/api/v1/admin/knowledge/miss-pool/:id/resolve` | 忽略、补充、转 QA、标记已处理 |

## 6. P0：展会运营接口

展会是业务根节点。展商、展品、排期、场地、点位、路线和应急播报均通过展会上下文关联；前端列表需要支持分页、搜索、详情、新增、编辑、删除。

### 6.1 展会管理

| 方法 | 接口 | 用途 |
| --- | --- | --- |
| GET | `/api/v1/admin/event/exhibitions` | 展会列表 |
| POST | `/api/v1/admin/event/exhibitions` | 新增展会 |
| GET | `/api/v1/admin/event/exhibitions/:id` | 展会详情 |
| GET | `/api/v1/admin/event/exhibitions/:id/overview` | 统计、配置状态、快捷入口 |
| PATCH | `/api/v1/admin/event/exhibitions/:id` | 修改名称、编码、展期、主办/承办/协办、描述等基础信息 |
| DELETE | `/api/v1/admin/event/exhibitions/:id` | 删除展会及关联运营数据 |
| POST | `/api/v1/admin/event/exhibitions/:id/lifecycle` | 按顺序推进生命周期 |

生命周期只允许：

```text
筹备就绪 preparing → 布展搭建 setup → 现场运营 operating → 撤场收尾 teardown
```

普通 PATCH 不得直接修改生命周期。删除展会时，后端应事务化级联删除场地、点位、路线、展商、展品、排期、应急播报和本届运行配置，并返回删除汇总；前端只做一次重点确认。

### 6.2 展会运行配置

| 方法 | 接口 | 用途 |
| --- | --- | --- |
| GET | `/api/v1/admin/event/exhibitions/:id/runtime-config` | 查询本届正式运行配置 |
| PUT/PATCH | `/api/v1/admin/event/exhibitions/:id/runtime-config` | 保存数字人形象、驱动模型、语音合成服务/模型、语音识别服务/模型、音色、场景、知识库 |
| POST | `/api/v1/admin/event/exhibitions/:id/runtime-config/validate` | 校验配置是否可启动实时会话 |

运行配置字段至少包括：

```json
{
  "avatar_id": "...",
  "model": "QuickTalk",
  "tts_provider": "edge",
  "tts_model": null,
  "voice_id": "zh-CN-XiaoxiaoNeural",
  "stt_provider": "dashscope",
  "stt_model": "fun-asr",
  "scene_id": "...",
  "knowledge_base_ids": ["..."]
}
```

展会详情跳转实时测试时，应支持 `GET /api/v1/admin/event/exhibitions/:id/runtime-config` 或兼容的 `/exhibitions/:id/digital-human-config`，让前端自动带入上述配置；实时测试中的临时切换不能覆盖正式配置。

### 6.3 场地、点位、路线

| 方法 | 接口 | 用途 |
| --- | --- | --- |
| GET/POST | `/api/v1/admin/event/exhibitions/:id/venues` | 当前展会场地列表、新增 |
| GET/PATCH/DELETE | `/api/v1/admin/event/venues/:venueId` | 场地详情、编辑、删除 |
| GET/POST | `/api/v1/admin/event/venues/:venueId/points` | 场地下点位列表、新增 |
| GET/PATCH/DELETE | `/api/v1/admin/event/points/:pointId` | 点位详情、编辑、删除 |
| GET/POST | `/api/v1/admin/event/venues/:venueId/routes` | 场地路线列表、新增 |
| GET/PATCH/DELETE | `/api/v1/admin/event/routes/:routeId` | 路线详情、编辑、删除 |
| POST | `/api/v1/admin/event/routes/:routeId/publish` | 发布路线 |

点位应返回：`id`、`venue_id`、`code`、`name`、`type`、`floor`、`x`、`y`、`exhibitor_id`、`exhibit_id`、`status`。

路线应使用有序 `point_ids`，不能只保存自由文本起点/终点：

```json
{
  "venue_id": "venue-1",
  "name": "主入口到智能制造展区",
  "type": "navigation",
  "point_ids": ["point-entrance", "point-booth-a1"],
  "directions": ["沿中央通道向东直行"],
  "estimated_minutes": 4,
  "status": "draft"
}
```

后端必须校验：场地属于展会、点位属于场地、路线至少两个点位、路线点位不能跨场地。删除场地前，应对点位和路线执行同一事务内的级联删除，或返回明确的关联删除预览。

### 6.4 展商、展品、活动排期

| 方法 | 接口 | 用途 |
| --- | --- | --- |
| GET/POST | `/api/v1/admin/event/exhibitions/:id/exhibitors` | 当前展会展商列表、新增 |
| GET/PATCH/DELETE | `/api/v1/admin/event/exhibitors/:exhibitorId` | 展商详情、编辑、删除 |
| GET/POST | `/api/v1/admin/event/exhibitions/:id/exhibits` | 当前展会展品列表、新增 |
| GET/PATCH/DELETE | `/api/v1/admin/event/exhibits/:exhibitId` | 展品详情、编辑、删除 |
| GET/POST | `/api/v1/admin/event/exhibitions/:id/schedules` | 当前展会活动排期列表、新增 |
| GET/PATCH/DELETE | `/api/v1/admin/event/schedules/:scheduleId` | 排期详情、编辑、删除 |

展商字段至少包括：`name`、`booth_code`、`category`、`contact`、`phone`、`description`、`status`。

展品字段至少包括：`exhibition_id`、`exhibitor_id`、`name`、`category`、`model_no`、`description`、`status`。

必须由后端保证：

- `exhibitor.exhibition_id` 必填。
- `exhibit.exhibition_id` 必须等于 `exhibitor.exhibition_id`。
- 展会筛选器只返回当前展会数据。
- 展商删除前检查展品和点位引用。
- 展品删除前检查点位引用。

### 6.5 应急播报

| 方法 | 接口 | 用途 |
| --- | --- | --- |
| GET/POST | `/api/v1/admin/event/exhibitions/:id/emergency-broadcasts` | 当前展会播报列表、新增 |
| GET/PATCH/DELETE | `/api/v1/admin/event/emergency-broadcasts/:broadcastId` | 播报详情、编辑、删除 |
| POST | `/api/v1/admin/event/emergency-broadcasts/:broadcastId/activate` | 激活播报 |
| POST | `/api/v1/admin/event/emergency-broadcasts/:broadcastId/end` | 结束播报 |

字段：`title`、`content`、`priority`、`target_terminals`、`effective_at`、`status`。激活、结束和删除均需记录操作人和时间。

## 7. P0：实时测试与 OpenTalking 适配

以下接口需要保持旧 Studio 兼容，Admin 实时测试直接复用：

| 方法 | 接口 | 要求 |
| --- | --- | --- |
| POST | `/sessions` | 接收 `avatar_id`、`model`、`tts_provider`、`tts_model`、`tts_voice`、`stt_provider`、知识库/记忆库字段，并返回 `session_id`、`status` |
| POST | `/sessions/:id/start` | 启动会话 |
| GET | `/sessions/:id` | 返回 `queued/initializing/ready/speaking/error/closed` 等状态 |
| GET SSE | `/sessions/:id/events` | 实时事件流、字幕、语音开始/结束、错误、排队事件 |
| DELETE | `/sessions/:id` | 停止并释放会话 |
| POST | `/sessions/:id/speak` | 文本发送 |
| POST | `/sessions/:id/speak_audio` | 语音发送 |
| POST | `/sessions/:id/speak_flashtalk_audio` | FlashTalk 语音发送 |
| POST | `/sessions/:id/transcribe` | 语音转文字 |
| POST | `/sessions/:id/interrupt` | 中断当前回复 |
| GET | `/sessions/webrtc/ice-config` | WebRTC ICE 配置 |
| POST | `/sessions/:id/webrtc/offer` | WebRTC Offer/Answer 协商 |
| GET | `/queue/status` | 队列状态 |

会话创建失败时必须返回可识别错误码，例如：

- `MODEL_NOT_CONFIGURED`
- `TTS_PROVIDER_NOT_CONFIGURED`
- `TTS_VOICE_NOT_FOUND`
- `STT_PROVIDER_NOT_CONFIGURED`
- `AVATAR_NOT_FOUND`
- `KNOWLEDGE_BASE_NOT_FOUND`
- `SESSION_QUEUE_FULL`

不能把后端 TTS 未配置错误伪装成成功，也不能由前端静默改用其他音色；Edge 试听可由用户明确选择 Edge 后正常使用。

另需保留现有展会语音能力：

| 方法 | 接口 | 用途 |
| --- | --- | --- |
| GET | `/exhibitions/:id/digital-human-config` | 查询展会语音/数字人配置 |
| POST | `/exhibitions/:id/navigation/query` | 根据用户问题查询路线和播报内容 |

## 8. P1：运营数据与报表

首页目前部分指标仍是 Mock。正式上线前建议开放：

| 方法 | 接口 | 用途 |
| --- | --- | --- |
| GET | `/api/v1/admin/interaction-records` | 交互记录、会话、终端、展会筛选 |
| GET | `/api/v1/admin/interaction-records/:id` | 对话和事件详情 |
| GET | `/api/v1/admin/terminals` | 终端列表、在线状态、所属展会 |
| GET | `/api/v1/admin/leads` | 新增线索、详情、导出 |
| GET | `/api/v1/admin/metrics/overview` | 交互量、响应耗时、错误率、命中率 |
| GET | `/api/v1/admin/exports` | 导出任务状态与下载地址 |
| POST | `/api/v1/admin/exports` | 创建导出任务 |

## 9. 当前前端真实 API 接入缺口

当前 `FetchAdminApiClient` 只覆盖了：

- 登录 `/api/v1/auth/login`；
- 首页 `/api/v1/admin/report`；
- GIF 列表 `/api/v1/admin/assets?kind=gif`；
- GIF 删除 `/api/v1/admin/assets/:id`。

其余 Admin 的数字人、声音配置、场景、待机内容、知识 QA、话术、发布包、未命中池、展会运营 CRUD，目前仍由 Mock 客户端承载。后端接口开放后，还需要继续补齐 `FetchAdminApiClient` 的方法映射，不能只设置 `VITE_ADMIN_API_MODE=real` 就直接上线。

建议真实客户端按以下顺序接入：

1. 登录、`/auth/me`、权限、首页。
2. 展会、场地、点位、路线、展商、展品、排期、应急播报。
3. 展会运行配置与实时测试自动带入。
4. 声音配置、GIF、场景绑定、待机内容。
5. 知识 QA、话术、发布包、未命中池。
6. 交互记录、终端、线索、报表。

## 10. 后端验收清单

- 所有列表支持分页，默认 `page_size=9`，并支持搜索和状态筛选。
- 所有资源支持列表、详情、新增、编辑、删除；状态流转使用独立接口。
- 所有写操作有认证、角色权限、操作人、时间和 `trace_id`。
- 展会、场地、点位、路线、展商、展品之间的归属关系由后端再次校验。
- 展会删除按一次确认后的级联策略事务执行，并返回删除汇总。
- 场地删除能处理点位、路线关联，不留下孤儿数据。
- 生命周期只能按四个阶段顺序推进，不能通过普通编辑绕过。
- 音色按服务商和模型类别返回；未配置的 TTS/STT 服务返回明确错误码。
- 实时会话支持排队、启动、停止、SSE、WebRTC、字幕和错误状态。
- 文档解析、向量化、QA 审核、发布包状态均可查询进度和失败原因。
- OpenTalking 原有 `/health`、`/models`、`/avatars`、`/voices`、`/sessions` 接口保持旧 Studio 兼容。

