# v2.6 数字人问答分流

前端将文字、语音识别结果和实体卡片选择提交到 `POST /exhibitions/{exhibition_id}/qa/query`。后端按当前展会筛选可用的展商、展品和路线，统一决定回答来源。保留已有公开接口对草稿资料的可用规则，不改变资料状态；下线、停用和删除的资料不参与匹配。

- 明确、唯一的关键词命中：直接使用数据库播报文案或介绍。位置问题读取展位、地址；路线问题读取配置的播报文案或路线说明。返回 `match_type=database`，不调用 Dify。
- 未命中、模糊匹配、重名或缺少所需内容：调用 Dify 应用，并传递查询结果供智能体参考。普通问答返回 `match_type=dify`，重名返回 `clarification`。
- 两种回答都通过 `direct=true` 交给数字人 TTS 和口型驱动，不经过 OpenTalking 内置对话模型。Dify 不可用时播报固定服务提示。

后台“系统管理 → 模型管理”配置应用 Base URL、API Key、超时和候选数量，并测试连接。API Key 只保存在服务端环境文件，不回传给前端。展商、展品和路线的关键词、别名、介绍和播报文案继续在展会管理维护。

环境变量为 `OPENTALKING_DIFY_CHAT_BASE_URL`、`OPENTALKING_DIFY_CHAT_API_KEY`、`OPENTALKING_DIFY_CHAT_TIMEOUT_SEC`、`OPENTALKING_DIFY_CHAT_TOP_K`。应用凭据与旧版 Dify 数据集检索凭据独立。

Dify 使用对话应用或 Chatflow；配置可选输入 `exhibition_id`、`locale`、`retrieval_status`、`retrieval_context`。最后一个变量是 JSON，包含当前数据库事实。提示词应优先使用当前事实，缺少资料时说明或追问。答案节点输出最终回答文本，推理过程应分离。

同一会话保存 Dify conversation ID 和最近实体选择。数据库直接回答保留原 conversation ID；后续 Dify 请求继续该对话并接收当前事实。新提问、打断或关闭会话会撤销旧任务，过期回答不能重新进入播报队列。
