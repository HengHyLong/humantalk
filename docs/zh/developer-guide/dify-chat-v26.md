# v2.6 数字人问答分流

前端将文字、语音识别结果和实体卡片选择提交到 `POST /exhibitions/{exhibition_id}/qa/query`。后端按当前展会筛选可用的展商、展品和路线，统一决定回答来源。保留已有公开接口对草稿资料的可用规则，不改变资料状态；下线、停用和删除的资料不参与匹配。

- 明确、唯一的关键词命中：直接使用数据库播报文案或介绍。位置问题读取展位、地址；路线问题读取配置的播报文案或路线说明。返回 `match_type=database`，不调用 Dify。
- 未命中、模糊匹配、重名或缺少所需内容：调用 Dify 应用，并传递查询结果供智能体参考。普通问答返回 `match_type=dify`，重名返回 `clarification`。
- 两种回答都通过 `direct=true` 交给数字人 TTS 和口型驱动，不经过 OpenTalking 内置对话模型。Dify 不可用时播报固定服务提示。

后台“系统管理 → 模型管理”配置应用 Base URL、API Key、超时和候选数量，并测试连接。API Key 只保存在服务端环境文件，不回传给前端。展商、展品和路线的关键词、别名、介绍和播报文案继续在展会管理维护。

环境变量为 `OPENTALKING_DIFY_CHAT_BASE_URL`、`OPENTALKING_DIFY_CHAT_API_KEY`、`OPENTALKING_DIFY_CHAT_TIMEOUT_SEC`、`OPENTALKING_DIFY_CHAT_TOP_K`。应用凭据与旧版 Dify 数据集检索凭据独立。

Dify 使用对话应用或 Chatflow；配置可选输入 `exhibition_id`、`locale`、`retrieval_status`、`retrieval_context`。最后一个变量是 JSON，包含当前数据库事实。提示词应优先使用当前事实，缺少资料时说明或追问。答案节点输出最终回答文本，推理过程应分离。

同一会话保存 Dify conversation ID 和最近实体选择。数据库直接回答保留原 conversation ID；后续 Dify 请求继续该对话并接收当前事实。新提问、打断或关闭会话会撤销旧任务，过期回答不能重新进入播报队列。

## 匹配、起点和追问规则

编号完整匹配，允许 `S-01`、`S01`、`S_01` 的等价写法，但不命中 `S010`。纯数字仅在独立输入或展位、编号、型号上下文中识别，`02` 不会命中 `CNCC2026`。否定对象不作为候选；长名称只覆盖同一位置的短别名，独立提到的对象全部保留。

数据库直接回答要求：完整命中、意图属于介绍/位置/列表/有效路线、所需事实完整、无歧义或截断。价格、成立时间、比较、优缺点、复合问题、日程、模糊匹配、缺少答案字段和英文翻译交给 Dify。完整列表可直接播报；超过上限向 Dify 标记部分结果及总数。

后台展会工作台的“数据库匹配与导航配置”设置 `terminalPointId`、意图关键词，并检查本届数据。终端位置由运营人员按实际安装位置设置；空配置时询问起点。请求可传 `origin_point_id`，用户明确说出的起点优先。仅使用起终点一致的现有路线，不反转或拼接。未知起点、缺少路线、多个目的地、路线冲突和跨展会请求由固定规则提示，不允许 Dify 编造导航。

追问优先级：新名称/编号或更正、有效序号、唯一对象代词。卡片与缓存顺序一致，路线另存路线 ID。多个候选后的“它”不默认选择。登记请求仅在唯一展品且存在真实调研入口时返回 `registration`，前端生成二维码；无入口时提示咨询工作人员。

响应新增 `routing_reason`、`registration`。Dify JSON 上下文新增 `current_exhibition`、`intent`、`routing_reason`、`truncated`、`origin_id`、`destination_id`。命中记录包含匹配字段/关键词、分流原因、实体/路线 ID、起终点，便于追溯。

## 数据校验与 Dify 提示词

`POST /api/v1/admin/event/exhibitions/{id}/runtime-config/validate` 返回 `issues`：路线结构/名称/播报冲突、缺少终端起点、点位未关联实体、重复关键词和图片标记。新建及修改路线时拦截结构与已识别终点冲突。图片标记仅在播报时清理，原数据及图片保留。不能凭事实确定的路线终点和展品归属不自动改写，应按审计结果核对。

规则模板在 `configs/prompts/dify_exhibition_v26.txt`，需同步到生产 Dify 的 LLM 系统提示词并发布。四个可选输入保持兼容。提示词由 Dify 统一管理，后台原数字人角色提示词不进入此问答链路；知识库“待核验”资料不能覆盖本轮数据库事实。发布前备份工作流。
