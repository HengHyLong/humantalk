# 四川博览集团数字人：后端配合任务清单

## 一、必须新增的接口

### [ ] 1. 获取会展数字人配置

接口：

```http
GET /exhibitions/{exhibition_id}/digital-human-config
```

前端初始化时调用，用于获取当前会展的语音意图关键词配置。

建议返回：

```json
{
  "exhibition_id": "exhibition-1",
  "keywords": {
    "navigation": ["导航", "怎么走", "在哪里", "洗手间", "展位在哪"],
    "exhibition_content": ["展品", "展商", "展会", "介绍", "活动"]
  },
  "supports_deferred_speak": false
}
```

要求：

- [ ] 支持按会展 ID 返回配置。
- [ ] 如果终端没有传入会展 ID，支持 `current` 作为当前绑定会展。
- [ ] 关键词数组允许为空，但必须返回合法 JSON。
- [ ] 配置不存在时返回明确的 404 或业务错误信息。

### [ ] 2. 查询导航结果

接口：

```http
POST /exhibitions/{exhibition_id}/navigation/query
```

请求：

```json
{
  "text": "从入口怎么去智能制造展区",
  "session_id": "sess_xxx"
}
```

建议返回：

```json
{
  "title": "前往智能制造展区",
  "spoken_text": "从一号入口进入后沿中央通道直行，经过服务台后右转进入智能制造展区。",
  "subtitle_text": "从一号入口前往智能制造展区",
  "image_url": "https://example.com/navigation/a1-route.png",
  "route": {
    "from": "一号入口",
    "to": "智能制造展区",
    "directions": [
      "从一号入口进入",
      "沿中央通道直行",
      "右转进入智能制造展区"
    ],
    "estimated_minutes": 4
  }
}
```

要求：

- [ ] 根据会展 ID 和用户问题匹配路线、场馆、展区、展位等信息。
- [ ] 返回可供数字人播报的 `spoken_text`。
- [ ] 返回可供聊天框展示的路线文字和可选图片。
- [ ] 没有匹配路线时返回明确的兜底文字，不要返回空响应。
- [ ] `image_url` 必须能被前端浏览器直接访问。
- [ ] 图片不存在或加载失败时，文字路线仍然可用。

## 二、现有接口确认

以下接口前端已经在使用，后端只需确认线上可用，不需要重复开发：

- [ ] `POST /sessions`
- [ ] `POST /sessions/{session_id}/start`
- [ ] `GET /sessions/{session_id}/events`
- [ ] `POST /sessions/{session_id}/transcribe`
- [ ] `POST /sessions/{session_id}/speak`
- [ ] `POST /sessions/{session_id}/interrupt`

用途：

```text
录音 → transcribe → 前端判断意图
     → 导航：navigation/query → speak(spoken_text)
     → 展品问答：speak(用户原始问题)
```

## 三、可选的流式语音优化

接口：

```http
WS /sessions/{session_id}/speak_audio_stream
```

前端已预留以下元数据：

```json
{
  "type": "meta",
  "defer_speak": true
}
```

如果后端支持 `defer_speak=true`：

- [ ] 只完成语音识别并返回文本。
- [ ] 不要在识别完成后自动调用 `speak`。
- [ ] 返回格式与 `/transcribe` 一致：`session_id`、`status`、`text`。
- [ ] 未传 `defer_speak` 时保持现有自动播报行为，兼容旧客户端。

如果暂时不支持该字段，前端会继续使用 `/transcribe`，功能可用但实时性略低。

## 四、会展数据准备

- [ ] 创建或确认会展主数据。
- [ ] 配置入口、出口、展馆、楼层、展区、展位和服务设施。
- [ ] 配置点位之间的路线和方向描述。
- [ ] 为路线配置导航图片或楼层地图图片。
- [ ] 为展品、展商、展会活动配置可检索内容。
- [ ] 为导航意图配置关键词。
- [ ] 为展品/展会问答配置关键词。
- [ ] 确认会展 ID 与数字人终端的绑定关系。

## 五、联调验收标准

- [ ] `GET /exhibitions/{id}/digital-human-config` 能返回关键词配置。
- [ ] 用户说“怎么去某个展区”时进入导航分支。
- [ ] 导航分支返回路线文字、数字人口播和导航图片。
- [ ] 用户说“这个展品是什么”时进入展品/展会问答分支。
- [ ] 长期监听下连续说三句话无需重复点击。
- [ ] 数字人播报时用户说话可以抢断并重新识别。
- [ ] 数字人的回声不会被识别为新的用户问题。
- [ ] 识别超时、空文本、接口错误时，监听状态可以恢复。
- [ ] 会话过期或麦克风权限失效时，前端释放录音资源。
- [ ] 图片加载失败时，导航文字和语音仍正常展示。

## 六、前端对应代码

- `apps/web/src/lib/api.ts`
- `apps/web/src/lib/exhibitionVoiceConfig.ts`
- `apps/web/src/App.tsx`
- `apps/web/src/components/ChatInput.tsx`
- `apps/web/src/components/DigitalHumanDisplay.tsx`
