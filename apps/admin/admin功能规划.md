# Admin 端功能规划

> **文件定位**：本文件是四川博览集团数字人项目 **Admin 管理后台端**的 SDD 规范开发指示，与 `server功能规划.md`、`web功能规划.md` 构成三端相互关联的闭环规划。Server 是数据与接口底座，Admin 是管理界面层（不独立建表、不独立提供接口，全部复用/调用 Server 端 `/api/v1/admin/*` + `/api/v1/ops/*` + `/api/v1/auth/*`）。
>
> **技术栈**：对齐 `apps/web`（React 18 + Vite 5 + Tailwind 3 + TS 5.6），新建 `apps/admin/`，端口 5174。
> **开发方式**：原型阶段使用 Mock 数据层（`src/mock/data.ts` + `src/mock/api.ts`），构建后端后切换为真实 fetch。
> **设计原则**：菜单/按钮/API 三层权限判断；所有写操作记操作前后值与 Trace ID；后台管理接口不允许匿名访问。

---

## 一、模块清单与边界

> 章节组织与第五章菜单树一致：认证前置 → 9 大一级菜单。废弃旧菜单"实时对话/视频创作/视频克隆/资产库/运行监控"。

| 一级菜单 | 子模块 | 边界说明 | 调用接口前缀 |
|---------|--------|---------|------------|
| **认证** | 登录、Token 刷新、路由守卫 | 仅 `/api/v1/auth/*` | `/api/v1/auth` |
| **首页** | 概览、待办 | 聚合展示，跨表统计 | `/api/v1/admin/report` |
| **展会运营** | 展会、展商、展品、地图路线（点位+路线+应急播报）、活动排期 | 含地图点位编辑；激活展会联动知识切换 | `/api/v1/admin/event/*` |
| **数字人中心** | 数字人形象、动作素材（**Gif 核心**）、声音配置、场景绑定、待机内容 | Gif 原始存储+分组标签；声音试听复用 OpenTalking `/tts/preview` | `/api/v1/admin/assets` `/api/v1/admin/scene-assets` |
| **知识中心** | 文档资料、问答知识（强控QA）、官方话术、发布审核（发布包+未命中池+展会切换） | 含发布审核工作流与版本回滚 | `/api/v1/admin/knowledge/*` |
| **交互管理** | 实时测试、欢迎配置、讲解流程、导购策略 | 实时测试内嵌 web 预览联调 OpenTalking `/sessions`；其余为场景策略配置 | `/api/v1/runtime/chat` `/sessions` |
| **线索运营** | 线索列表/详情/导出、反馈管理 | 联系方式按 RBAC 解密（`lead:view_sensitive`） | `/api/v1/admin/lead` `/api/v1/admin/feedback` |
| **数据分析** | 交互量、热点、命中、线索转化、资源用量、报表导出 | 聚合查询 + ECharts 图表展示 | `/api/v1/admin/report/*` |
| **系统管理** | 用户、角色、权限点、审计日志（操作审计+全链路Trace+数据保护）、运维监控（服务+终端+告警+降级）、全局配置（网关白名单+终端分组） | 仅 sys_admin 可见；含手动故障切换 | `/api/v1/admin/rbac` `/api/v1/admin/audit` `/api/v1/ops` `/api/v1/admin/gateway` |

**三端关系**：Admin 端管理的数据（资产/知识/活动/线索/终端/降级）由 Web 端在运行时消费；Admin 端的配置（Gif 场景绑定、强控QA发布、应急播报、降级策略、迎宾/讲解/导购策略）直接决定 Web 端交互行为；Admin 端全部数据读写经 Server 端接口完成。

---

## 二、数据表设计

> **Admin 端不独立建表**，全部复用 Server 端 `server功能规划.md` 第二章定义的数据表：
> - 权限审计域：`t_accounts` `t_roles` `t_permissions` `t_role_permissions` `t_user_roles` `t_operation_audit` `t_trace_audit` `t_data_protection_config`
> - 知识服务域：`t_knowledge_documents` `t_knowledge_chunks` `t_knowledge_qa` `t_knowledge_qa_versions` `t_publish_packages` `t_publish_package_items` `t_knowledge_hits` `t_miss_pool`
> - 数字资产域：`t_digital_assets` `t_scene_assets`
> - 活动运营域：`t_exhibitions` `t_exhibitors` `t_exhibits` `t_points` `t_schedules` `t_routes` `t_route_points` `t_emergency_broadcasts`
> - 线索与终端域：`t_leads` `t_terminals` `t_terminal_heartbeats`
> - 反馈与统计域：`t_feedbacks`
> - 网关治理域：`t_gateway_whitelist` `t_degradation_configs` `t_alert_events`
>
> Admin 端是这些表的**管理界面层**，页面字段与表字段一一对应（见第四章）。

---

## 三、接口设计

> **Admin 端不独立提供接口**，全部调用 Server 端 `server功能规划.md` 第三章定义的接口：
> - 认证：`POST /api/v1/auth/login` `POST /api/v1/auth/refresh` `POST /api/v1/auth/logout` `GET /api/v1/auth/me`
> - RBAC：`/api/v1/admin/rbac/user|role|permission`
> - 知识：`/api/v1/admin/knowledge/*`
> - 资产：`/api/v1/admin/assets/*` `/api/v1/admin/scene-assets`
> - 活动：`/api/v1/admin/event/*`
> - 线索反馈：`/api/v1/admin/lead/*` `/api/v1/admin/feedback/*`
> - 报表：`/api/v1/admin/report/*`
> - 审计：`/api/v1/admin/audit/*`
> - 运维：`/api/v1/ops/*` `/api/v1/admin/ops/*` `/api/v1/admin/gateway/*`
>
> 原型阶段 `src/mock/api.ts` 中的 `api.*` 方法即这些接口的 Mock 实现，方法名与页面调用一一对应。

---

## 四、功能模块字段与交互设计

> 章节组织与第五章菜单树一一对齐：4.1 登录守卫 → 4.2 首页 → 4.3 展会运营 → 4.4 数字人中心 → 4.5 知识中心 → 4.6 交互管理 → 4.7 线索运营 → 4.8 数据分析 → 4.9 系统管理。

### 4.1 模块：登录与权限路由守卫

**登录页字段**
| 字段 | 类型 | 校验 | 说明 |
|------|------|------|------|
| username | text | required | 用户名 |
| password | password | required | 密码 |

**交互流程**
1. 用户输入账号密码 → `POST /api/v1/auth/login` → 获取 JWT + 用户权限点列表
2. JWT 存 localStorage，注入 axios 请求头
3. 路由守卫：未登录跳登录页；已登录但无目标路由权限 → 跳 403 页
4. 侧边菜单按 `permission` tree（type=menu）过滤渲染，按钮按 type=button 过滤
5. Token 过期 → 自动 `POST /api/v1/auth/refresh` → 失败跳登录页

**权限点三层设计示例**（以"知识中心→发布审核"为例）
```
菜单层：knowledge:publish（路径 /knowledge/package，菜单可见）
  按钮层：knowledge:rollback（发布包回滚按钮可见）
  API层：POST /api/v1/admin/knowledge/package/{id}/publish（接口鉴权）
  API层：POST /api/v1/admin/knowledge/package/{id}/rollback（接口鉴权）
```

### 4.2 模块：首页

**概览卡片字段**
| 卡片 | 数据来源 | 展示 |
|------|---------|------|
| 今日交互量 | `t_trace_audit` 今日 count | 数字+环比 |
| 在线终端 | `t_terminals` status=online count | 数字/总数 |
| 待审知识 | `t_knowledge_qa` status=pending_review count | 数字，点击跳"发布审核" |
| 新增线索 | `t_leads` 今日 count | 数字+环比 |
| 告警数 | `t_alert_events` status=active count | 数字，按severity分色 |

**待办列表字段**：类型（待审QA/待审发布包/待确认告警/未处理反馈）、标题、提交人、提交时间、操作按钮（去处理 → 跳对应菜单子项）。

### 4.3 模块：展会运营

**展会管理页字段** `/event/exhibition`：展会名、场馆、开始日期、结束日期、描述、状态、是否当前生效、操作（编辑/激活）。**交互**：激活为当前展会后联动知识中心"展会知识切换"。

**展商管理页字段** `/event/exhibitor`：展商名、LOGO、简介、联系电话、网址、行业分类、所属展会、操作（编辑/查看展品/删除）。

**展品管理页字段** `/event/exhibit`：展品名、主图、简介、价格区间、标签、所属展商、操作（编辑/删除）。

**地图路线页字段** `/event/route`：合并点位+路线+应急播报三子能力。
- 点位字段：点位编码、点位名、类型（booth/forum/facility/entrance/service）、楼层、X坐标、Y坐标、关联展商/展品。**交互**：左侧地图画布点击放置点位，右侧字段编辑。
- 路线字段：路线名、类型（tour/navigation/emergency）、描述、点位列表（拖拽排序）、每点指引话术。**交互**：左侧地图显示路线，右侧点位列表编辑。
- 应急播报字段：播报标题、内容、优先级（low/normal/high/urgent）、目标终端、生效时间、状态、操作（编辑/激活/结束）。**交互**：激活后立即下发到目标终端，web端弹窗展示。

**活动排期页字段** `/event/schedule`：活动名、举办地点、开始时间、结束时间、演讲人、简介、状态、操作（编辑/取消）。**交互**：日历视图按天展示排期，支持拖拽调整时间。

### 4.4 模块：数字人中心

**数字人形象页字段** `/asset/avatar`：形象名、预览图、OpenTalking avatar_id 绑定、状态、操作（编辑/绑定/删除）。**交互**：从 OpenTalking `/avatars` 拉取可用形象列表，选择绑定到本系统资产。

**动作素材页字段** `/asset/gif`（**核心：Gif 动图管理**）
| 字段 | 类型 | 说明 |
|------|------|------|
| 缩略图 | image | 资产缩略图（取Gif第一帧） |
| 名称 | text | 资产名 |
| 场景 | tag | welcome/explain/qa/navigation/shopping/idle/emergency |
| 标签 | tag[] | 分组标签（话术:欢迎,情绪:微笑,场景:迎宾） |
| 尺寸 | text | 宽×高 |
| 帧数 | text | Gif 帧数 |
| 时长 | text | Gif 时长（ms） |
| 状态 | tag | active/inactive |
| 操作 | button | 编辑/删除/预览 |

**Gif 上传表单字段**
| 字段 | 类型 | 校验 | 说明 |
|------|------|------|------|
| 文件 | file | required, .gif, ≤20MB | 原始Gif文件，服务端不转码 |
| 名称 | text | required, ≤128字 | 资产名 |
| 场景 | select | required | 关联数字人场景 |
| 标签 | tag-input | optional | 话术/情绪/场景分组标签 |
| 描述 | textarea | optional, ≤512字 | 资产描述 |

**Gif 交互流程**
1. 运营点击"上传Gif" → 弹窗表单 → 选择文件 → 自动解析元数据（尺寸/帧数/时长）显示预览
2. 提交 → `POST /api/v1/admin/assets`（multipart）→ 服务端原始存储 + 生成缩略图 → 返回 asset_id
3. 列表页支持按场景/标签筛选
4. 点击"预览" → 弹窗播放 Gif 原始动画
5. 点击"编辑" → 修改 meta（名称/标签/场景/状态）
6. 点击"删除" → 二次确认 → `DELETE /api/v1/admin/assets/{id}`（含文件删除）

**声音配置页字段** `/asset/voice`：TTS provider（dashscope/bailian/...）、音色ID、音色名、预览文本、试听播放、状态、操作（编辑/试听/删除）。**交互**：试听调用 OpenTalking `/tts/preview`。

**场景绑定页字段** `/asset/scene`：场景下拉、终端筛选（可选）、已绑定资产列表（拖拽排序）、主资产标记（is_primary）、操作（添加资产/解绑/设主）。**交互**：选择场景 → 显示该场景已绑定资产列表 → 从资产库选择添加 → 设置主资产。

**待机内容页字段** `/asset/idle`：待机类型（宣传片/标语轮播/活动主题）、内容资产引用、轮播间隔、活动主题配置（关联排期）、状态、操作（编辑/启用/禁用）。

### 4.5 模块：知识中心

**文档资料页字段** `/knowledge/document`
| 字段 | 类型 | 校验 | 说明 |
|------|------|------|------|
| 标题 | text | required, ≤256字 | 文档标题 |
| 文件 | file | required, ≤50MB | txt/md/csv/word/pdf/excel |
| 文档类型 | select | required | 展商资料/展品资料/论坛议程/官方口径/服务设施 |
| 所属展会 | select | optional | 关联展会 |

**文档列表字段**：标题、文件名、类型、展会、解析状态（pending/parsing/parsed/failed 进度条）、向量化状态、切片数、上传人、上传时间、操作（查看切片/重新解析/向量化/删除）。**向量化交互**：触发任务 → SSE 推送进度（`GET /api/v1/admin/knowledge/task/{task_id}/events`）。

**问答知识页字段** `/knowledge/qa`（强控QA CRUD）
| 字段 | 类型 | 说明 |
|------|------|------|
| 问题 | text | 问题文本 |
| 关键词 | tag-input | 问题匹配关键词 |
| 答案 | richtext | 官方口径答案 |
| 分类 | select | 展会/展商/展品/论坛/服务 |
| 所属展会 | select | 关联展会 |
| 状态 | tag | draft/pending_review/published/archived |
| 版本 | text | 当前版本号 |
| 创建人 | text | 创建人 |
| 审核人 | text | 审核人 |
| 发布时间 | datetime | published_at |

**强控QA交互流程**
1. 新建QA → 填写问题/答案/分类 → status=draft → 写操作审计
2. 编辑QA → 修改内容 → 生成新版本记录 → 当前 version+1
3. 提交审核 → status=pending_review → 首页待办显示
4. 审核人通过 → status=published + published_at → 写操作审计
5. 审核人驳回 → status=draft + 驳回原因
6. 查看版本历史 → 显示所有版本 + 变更人/时间/原因
7. 回滚 → 选择历史版本 → 恢复内容 + 生成新版本

**官方话术页字段** `/knowledge/script`：话术模板名、场景标签（welcome/explain/shopping/emergency）、话术内容（richtext）、关联展会、变量占位符（{exhibition_name}/{booth_code}）、状态、操作（编辑/删除/预览）。**交互**：话术模板供"交互管理"各场景引用，运行时变量占位符自动替换。

**发布审核页字段** `/knowledge/package`（合并发布包+未命中池）
- 发布包列表：包名、展会、状态（draft/pending_review/published/rolled_back）、版本、QA数、文档数、创建人、审核人、发布时间、操作（查看/发布/回滚）。
- 未命中池子页：未命中问题、询问次数、首次询问时间、末次询问时间、状态（pending/supplemented/converted_qa/ignored）、操作（补齐/转化为强控QA/忽略）。

**发布包交互流程**
1. 新建发布包 → 输入名称 → 选择已published的QA + 已parsed的文档 → 创建（status=draft）
2. 提交审核 → status=pending_review
3. 审核通过 → status=published → 激活该包内所有QA/文档为当前生效知识
4. 回滚（需 knowledge:rollback 权限）→ 选择上一发布包 → 激活 → 当前包 status=rolled_back
5. 展会知识切换 → 选择展会 → 激活该展会下所有published知识

### 4.6 模块：交互管理

**实时测试页字段** `/interact/test`：内嵌 web 预览窗（iframe 或独立组件）、场景选择、输入文本框、发送按钮、对话历史、SSE 事件流展示（transcript/llm/tts/frame/status）、WebRTC 状态指示。**交互**：调用 `/api/v1/runtime/chat` + OpenTalking `/sessions` 联调，所见即 web 端体验。

**欢迎配置页字段** `/interact/welcome`：迎宾触发条件（终端启动/用户靠近/唤醒词）、迎宾话术模板引用（关联官方话术）、展会亮点列表、签到流程指引、入场须知、分流策略（按时段/展馆）、状态、操作（编辑/启用/禁用）。

**讲解流程页字段** `/interact/explain`：讲解意图路由规则（关键词→场景）、关联知识分类（展商/展品/论坛/服务）、打断策略（允许/禁止/触敏词拦截）、关联话术模板、状态、操作（编辑/启用/禁用）。

**导购策略页字段** `/interact/shopping`：导购推荐规则（标签匹配权重）、对比表模板（默认对比维度）、意向阈值（触发线索登记的意向分数）、关联展品分类、状态、操作（编辑/启用/禁用）。

### 4.7 模块：线索运营

**线索列表页字段** `/lead`：线索ID、展会、终端、单位名（按 lead:view 权限脱敏，lead:view_sensitive 解密）、联系人（同上）、合作意向摘要、状态（new/contacted/converted/invalid）、创建时间、操作（查看详情/导出/更新状态）。

**线索详情页字段** `/lead/:id`：基础信息+感兴趣展商列表+感兴趣展品列表+资料二维码token+状态流转记录。

**线索导出交互**（需 lead:export 权限）：点击"导出" → 选择展会/状态/时间范围 → `GET /api/v1/admin/lead/export` → 下载 Excel（按权限脱敏）。

**反馈管理子页字段** `/lead/feedback`（需 lead:feedback 权限）：反馈类型、评分、内容、关联trace_id、状态、创建时间、操作（处理/查看trace详情）。**处理交互**：点击"处理" → 弹窗输入处理备注 → 更新状态为 handled。

### 4.8 模块：数据分析

**报表维度字段** `/report/*`
| 报表 | 路由 | 维度 | 指标 | 图表类型 |
|------|------|------|------|---------|
| 交互量统计 | /report/interaction | 终端/场景/时段 | 交互次数、平均时长 | 折线图+柱状图 |
| 热点分析 | /report/hotspot | 问题/展品/展商 | 询问次数排行 | 横向柱状图 |
| 命中分析 | /report/hit | 展会/场景/时段 | 命中率、未命中率、强控QA命中率、RAG命中率 | 饼图+折线图 |
| 线索转化 | /report/lead | 展会/终端/展商 | 线索数量、转化漏斗、展品关注关联 | 漏斗图+桑基图 |
| 资源用量 | /report/resource | 模型/终端/时段 | 调用次数、算力消耗、平均耗时 | 堆叠柱状图 |

**报表交互流程**
1. 选择展会+时间范围+分组维度 → `GET /api/v1/admin/report/operations`
2. 图表展示（ECharts）+ 数据表格联动
3. 点击"导出"（需 report:export 权限）→ `GET /api/v1/admin/report/export?format=excel` → 下载

### 4.9 模块：系统管理

**用户管理页字段** `/system/user`：用户名、显示名、邮箱、手机、状态、角色列表、最后登录时间/IP、操作（编辑/禁用/重置密码）。

**角色管理页字段** `/system/role`：角色编码、角色名、描述、权限点数量、操作（编辑权限点/删除）。

**权限点管理页字段** `/system/permission`：权限树（菜单/按钮/API 三层）、权限编码、名称、类型、路径、API pattern、操作（新增子项/编辑/删除）。**交互**：树形结构展示，支持拖拽排序。

**审计日志页字段** `/system/audit`（合并操作审计+全链路Trace+数据保护配置）
- 操作审计列表：trace_id、操作人、动作、资源类型、资源ID、操作IP、操作时间、操作（查看详情）。
- 操作审计详情：基础信息+操作前值（JSON树形展示）+操作后值（JSON树形展示）+差异高亮。
- 全链路Trace查询（需 audit:trace 权限）：trace_id输入框、查询按钮、结果展示（span树形结构+每个span的详细信息）。**交互**：输入trace_id → `GET /api/v1/admin/audit/trace/{trace_id}` → 展示span树 → 点击span节点展开详情。
- 数据保护配置：数据类型、脱敏规则、加密算法、保留天数、备份开关、更新人、更新时间、操作（编辑）。

**运维监控页字段** `/system/ops`（合并服务/终端/告警/降级）
- 服务健康：服务名（本地应用/数据库/网关/外部算力）、状态（ok/warn/error）、延迟、最后检查时间、操作（查看详情/故障切换）。
- 终端状态：终端ID、名称、位置、状态（online/offline/disabled）、最后心跳时间、应用版本、CPU/内存占用、操作（查看心跳历史/禁用/启用）。
- 告警管理：告警类型、严重级别、告警对象、告警内容、状态、发生时间、确认人、确认时间、操作（确认/查看详情）。
- 降级配置：服务名、降级策略、策略配置（JSON）、启用状态、更新时间、操作（编辑/启用/禁用）。

**故障切换交互**（需 ops:failover 权限）：点击"故障切换" → 弹窗选择 service + from + to → 二次确认 → `POST /api/v1/ops/failover` → 写操作审计+告警事件。

**全局配置页字段** `/system/config`：数据保护配置入口、网关白名单管理（能力、提供方、启用状态、限流QPS、超时时间、故障切换目标、操作编辑/删除）、终端分组配置。

---

## 五、菜单结构与权限映射

> 旧菜单"实时对话/视频创作/视频克隆/资产库/运行监控"已废弃，改造为以下 9 大一级菜单。每个菜单项标注：**路由路径 / 权限编码 / 可见角色**。权限点类型 = menu（菜单可见）/ button（按钮可见）/ api（接口调用）。

### 5.1 菜单树

```
 首页                                          [所有角色]
  └路由 /dashboard

 展会运营                                      [content_ops, sys_admin]
  ├─ 展会管理    /event/exhibition        event:exhibition       展会 CRUD + 激活当前展会
  ├─ 展商管理    /event/exhibitor          event:exhibitor       展商 CRUD + LOGO 上传
  ├─ 展品管理    /event/exhibit            event:exhibit         展品 CRUD + 主图 + 标签
  ├─ 地图路线    /event/route              event:route           点位 + 路线规划 + 应急播报
  └ 活动排期    /event/schedule           event:schedule        排期日历 + 演讲人 + 状态

 数字人中心                                    [content_ops, sys_admin]
  ├─ 数字人形象  /asset/avatar             asset:avatar          形象资产 + 绑定 OpenTalking avatar_id
  ├─ 动作素材    /asset/gif                asset:gif             **   动图管理**：上传/标签/预览
  ├─ 声音配置    /asset/voice              asset:voice           TTS provider + 音色 + 预览试听
  ├─ 场景绑定    /asset/scene              asset:scene           场景↔资产绑定 + 主资产 + 排序
  └ 待机内容    /asset/idle               asset:idle            待机宣传片/标语轮播 + 活动主题

知识中心                                      [content_ops, sys_admin]
  ├─ 文档资料    /knowledge/document       knowledge:document    上传解析 + 切片 + 向量化任务
  ├─ 问答知识    /knowledge/qa             knowledge:qa         强控QA CRUD + 版本历史 + 回滚
  ├─ 官方话术    /knowledge/script         knowledge:script     迎宾/讲解/导购话术模板 + 场景标签
  └ 发布审核    /knowledge/package        knowledge:publish    发布包 + 审核工作流 + 展会知识切换
                    [knowledge:rollback]   发布包回滚按钮权限
                    [knowledge:miss]      未命中池入口（合并到此菜单下）

交互管理                                      [content_ops, sys_admin]
  ├─ 实时测试    /interact/test            interact:test        内嵌 web 预览窗 + 实时对话联调
  ├─ 欢迎配置    /interact/welcome         interact:welcome     迎宾触发条件 + 话术 + 分流策略
  ├─ 讲解流程    /interact/explain         interact:explain     讲解意图路由 + 关联知识 + 打断策略
  └ 导购策略    /interact/shopping        interact:shopping    导购推荐规则 + 对比表模板 + 意向阈值

线索运营                                      [content_ops, data_viewer, sys_admin]
  └路由 /lead
  [lead:view]   列表查看（联系方式脱敏）
  [lead:view_sensitive]   详情查看联系方式明文（加密解密）
  [lead:export]           导出 Excel
  [lead:feedback]         反馈管理子页 /lead/feedback

数据分析                                      [data_viewer, sys_admin, security_audit]
  └路由 /report
  ├─ 交互量统计  /report/interaction       report:interaction
  ├─ 热点分析    /report/hotspot           report:hotspot
  ├─ 命中分析    /report/hit               report:hit
  ├─ 线索转化    /report/lead              report:lead
  └ 资源用量    /report/resource          report:resource
  [report:export]   报表导出

系统管理                                      [sys_admin]
  ├─ 用户管理    /system/user              system:user           账号 CRUD + 角色分配
  ├─ 角色管理    /system/role              system:role           角色 CRUD + 权限点分配
  ├─ 权限点管理  /system/permission        system:permission     权限树（菜单/按钮/API 三层）
  ├─ 审计日志    /system/audit             system:audit          操作审计 + 全链路 Trace 钻取
  │                [audit:trace]            Trace 详情查看
  ├─ 运维监控    /system/ops               system:ops            服务健康 + 终端状态 + 告警 + 降级
  │                [ops:failover]           手动故障切换按钮
  └ 全局配置    /system/config            system:config        数据保护 + 网关白名单 + 终端分组
```

### 5.2 角色定义
| 角色编码 | 角色名 | 可见一级菜单 | 定位 |
|---------|--------|-------------|------|
| sys_admin | 系统管理员 | 全部 | 含运维监控/系统配置/权限点 |
| content_ops | 内容运营 | 首页/展会运营/数字人中心/知识中心/交互管理/线索运营 | 数字资产/知识/活动/线索运营 |
| data_viewer | 数据查看 | 首页/线索运营/数据分析 | 报表与线索只读 |
| security_audit | 安全审计 | 首页/数据分析/系统管理（仅审计日志） | 审计与报表 |
| readonly | 只读 | 全部菜单 | 全部按钮禁用 |

### 5.3 新旧菜单对照
| 旧菜单（web studio 原生） | 新菜单 | 处理 |
|--------------------------|--------|------|
| 实时对话 | 交互管理 → 实时测试 | 改造为内嵌 web 预览联调 |
| 视频创作 | 删除 | 非博览会场景 |
| 视频克隆 | 删除 | 非博览会场景 |
| 资产库 | 数字人中心（拆分为形象/动作素材/声音/场景/待机 5 子项） | 按博览会场景重组 |
| 运行监控（虚假） | ⚙ 系统管理 → 运维监控（真实功能） | 替换为真实健康/告警/降级 |

---

## 六、三端闭环关联（Admin 视角）

> Admin 端负责"管理侧"配置，Server 端提供接口，Web 端消费配置产生交互数据回流到 Admin 报表。

| Admin 管理功能 | 管理的数据表 | 对应 Server 接口 | 对 Web 端的影响 |
|---------------|-------------|-----------------|----------------|
| Gif 资产上传/分组标签 | `t_digital_assets` | `/api/v1/admin/assets` | Web 端按场景拉取 Gif 播放/降级 |
| 场景资产绑定 | `t_scene_assets` | `/api/v1/admin/scene-assets` | Web 端 `/api/v1/runtime/scene-assets` 返回绑定结果 |
| 强控QA发布 | `t_knowledge_qa` `t_publish_packages` | `/api/v1/admin/knowledge/package/{id}/publish` | Web 端问答命中强控QA（拦截LLM） |
| 展会知识切换 | `t_publish_packages` `t_exhibitions` | `/api/v1/admin/knowledge/switch` | Web 端知识检索范围切换 |
| 未命中池补齐 | `t_miss_pool` | `/api/v1/admin/knowledge/miss-pool/{id}/supplement` | Web 端未命中问题回写后的处理闭环 |
| 点位/路线维护 | `t_points` `t_routes` | `/api/v1/admin/event/point` `/route` | Web 端线路导览 scene=navigation 数据源 |
| 排期维护 | `t_schedules` | `/api/v1/admin/event/schedule` | Web 端活动提醒/活动卡片 |
| 应急播报激活 | `t_emergency_broadcasts` | `/api/v1/admin/event/emergency-broadcast/{id}/activate` | Web 端 emergency 状态强制切换 |
| 线索跟进 | `t_leads` | `/api/v1/admin/lead` | Web 端线索登记（`/api/v1/runtime/lead`）回流 |
| 反馈处理 | `t_feedbacks` | `/api/v1/admin/feedback/{id}/handle` | Web 端反馈提交（`/api/v1/runtime/feedback`）回流 |
| 终端禁用/启用 | `t_terminals` | `/api/v1/ops/terminal-status` | Web 端心跳（`/api/v1/terminal/heartbeat`）决定在线状态 |
| 降级策略配置 | `t_degradation_configs` | `/api/v1/admin/ops/degradation` | Web 端渲染模式降级（WebRTC→Gif） |
| 网关白名单 | `t_gateway_whitelist` | `/api/v1/admin/gateway/whitelist` | Web 端能力调用限流/熔断 |
| 数据保护配置 | `t_data_protection_config` | `/api/v1/admin/audit/data-protection` | 线索联系方式脱敏/加密展示 |

---

## 七、实施优先级（Admin 视角）

| 阶段 | 范围 | 关键交付 |
|------|------|---------|
| P0 基座 | 登录 + 布局 + 权限守卫 | 侧边菜单按权限渲染、路由守卫、403页 |
| P1 核心业务 | 数字资产（重点Gif）+ 知识运营 + 综合工作台 | Gif上传/预览/场景绑定、文档解析、强控QA管理 |
| P2 扩展业务 | 活动运营 + 线索反馈 + 运营报表 | 点位地图、排期日历、线索脱敏导出、ECharts图表 |
| P3 运维加固 | 审计 + 运维监控 + 系统配置 | Trace钻取、告警确认、降级配置、用户角色权限点 |

---

## 八、页面与路由清单（与新菜单对齐）

> 路由清单与第五章菜单树一一对应。原型阶段 41 页面已开发，按新菜单重组后页面数与子项数一致，仅菜单分组与命名调整。

| 一级菜单 | 子页面 | 路由 | 权限编码 |
|---------|--------|------|---------|
| 认证 | 登录 | `/login` | — |
| 首页 | 概览 | `/dashboard` | — |
| 首页 | 待办 | `/dashboard/todo` | — |
| 展会运营 | 展会管理 | `/event/exhibition` | `event:exhibition` |
| 展会运营 | 展商管理 | `/event/exhibitor` | `event:exhibitor` |
| 展会运营 | 展品管理 | `/event/exhibit` | `event:exhibit` |
| 展会运营 | 地图路线（点位+路线+应急播报） | `/event/route` | `event:route` |
| 展会运营 | 活动排期 | `/event/schedule` | `event:schedule` |
| 数字人中心 | 数字人形象 | `/asset/avatar` | `asset:avatar` |
| 数字人中心 | 动作素材| `/asset/gif` | `asset:gif` |
| 数字人中心 | 声音配置 | `/asset/voice` | `asset:voice` |
| 数字人中心 | 场景绑定 | `/asset/scene` | `asset:scene` |
| 数字人中心 | 待机内容 | `/asset/idle` | `asset:idle` |
| 知识中心 | 文档资料（含切片子页） | `/knowledge/document` | `knowledge:document` |
| 知识中心 | 问答知识 | `/knowledge/qa` | `knowledge:qa` |
| 知识中心 | 官方话术 | `/knowledge/script` | `knowledge:script` |
| 知识中心 | 发布审核（发布包+未命中池+展会切换） | `/knowledge/package` | `knowledge:publish` + `knowledge:rollback` + `knowledge:miss` |
| 交互管理 | 实时测试 | `/interact/test` | `interact:test` |
| 交互管理 | 欢迎配置 | `/interact/welcome` | `interact:welcome` |
| 交互管理 | 讲解流程 | `/interact/explain` | `interact:explain` |
| 交互管理 | 导购策略 | `/interact/shopping` | `interact:shopping` |
| 线索运营 | 线索列表 | `/lead` | `lead:view` |
| 线索运营 | 线索详情 | `/lead/:id` | `lead:view_sensitive` |
| 线索运营 | 反馈管理 | `/lead/feedback` | `lead:feedback` |
| 数据分析 | 交互量统计 | `/report/interaction` | `report:interaction` |
| 数据分析 | 热点分析 | `/report/hotspot` | `report:hotspot` |
| 数据分析 | 命中分析 | `/report/hit` | `report:hit` |
| 数据分析 | 线索转化 | `/report/lead` | `report:lead` |
| 数据分析 | 资源用量 | `/report/resource` | `report:resource` |
| 系统管理 | 用户管理 | `/system/user` | `system:user` |
| 系统管理 | 角色管理 | `/system/role` | `system:role` |
| 系统管理 | 权限点管理 | `/system/permission` | `system:permission` |

**原型登录**：`admin / Admin@123456`（系统管理员全权限）
**切换真实后端**：替换 `src/mock/api.ts` 各方法为真实 `fetch('/api/v1/*')` 调用，类型与页面层无需改动。
