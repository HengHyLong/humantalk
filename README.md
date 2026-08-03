# 四川博览集团数字人项目

四川博览集团数字人项目是一个面向展会场景的实时数字人服务平台。项目以 OpenTalking 实时数字人运行时为基础，围绕四川博览集团展会业务建设管理后台、Web 数字人交互端、知识库与 RAG 能力，以及数字人语音、会话和媒体流服务。

项目当前以两个业务端为主线：

- **管理后台 Admin**：负责展会、展商、展品、场地、路线、数字人资产、知识库和交互策略的配置与运营。
- **Web 数字人端 Web**：面向观众提供语音交互、展会问答、展馆导航、数字人播报和后续导购/线索服务。

底层 API 负责会话、SSE 事件、WebRTC、语音识别、语音合成、数字人驱动和知识库基础能力。展会业务接口仍在按 Admin/Web 模块逐步补充和联调中。

## 项目结构

```text
opentalking-main/
├── apps/
│   ├── api/       # FastAPI 后端与 OpenTalking 运行时接口
│   ├── admin/     # 管理后台 Admin，React + TypeScript
│   ├── web/       # Web 数字人交互端，React + TypeScript
│   ├── unified/   # 统一启动入口
│   └── cli/       # 命令行工具
├── opentalking/   # 会话、模型、语音、媒体和运行时核心代码
├── configs/       # 项目和模型配置
├── examples/      # 示例资源和示例配置
├── scripts/       # 启动、停止、模型和部署脚本
├── docs/          # 通用技术文档
└── tests/         # 项目级测试
```

## 当前业务功能

### 1. Admin 管理后台

当前菜单和页面按照以下功能模块组织：

| 功能模块 | 当前内容 | 当前状态 |
| --- | --- | --- |
| 首页 | 展会概览、运行状态、待办和告警展示 | 部分完成，部分数据仍为 Mock |
| 展会运营 | 展会列表、展商管理、展品管理、活动排期、场地管理、点位管理、路线规划、应急播报 | 页面和基础 Mock CRUD 已有，真实业务接口待补充 |
| 数字人中心 | 数字人形象、声音配置、场景绑定、待机内容 | 基础资产和运行时接口已有，运营数据接入待完善 |
| 知识中心 | 文档资料、知识库、记忆库，以及知识问答、话术和发布相关页面能力 | 基础文档和知识库接口已有，发布审核和生产链路待完善 |
| 交互管理 | 实时测试、欢迎配置、讲解流程、导购策略 | 实时测试基础能力已有，后三项页面暂未启用 |
| 线索运营 | 线索列表、详情、授权、脱敏、反馈和导出 | 当前未启用，接口和页面待开发 |
| 数据分析 | 交互记录、知识命中、未命中、终端和运营报表 | 当前未启用，接口和页面待开发 |
| 系统管理 | 用户、角色、菜单权限、按钮权限、审计和运维 | 当前未启用，认证、RBAC 和审计接口待开发 |

### 2. Web 数字人交互端

Web 端面向展会观众，当前主要能力包括：

- 数字人展示、会话创建、会话启动和会话关闭。
- SSE 实时事件接收、字幕展示、音频播放和 WebRTC 媒体流。
- 文本问答、语音输入、流式 STT、TTS 播报和播报中断。
- VAD 语音活动检测、连续监听基础逻辑和语音识别失败回退。
- 展会配置读取、关键词归一化、导航意图和普通问答意图的前端分流。
- 导航结果展示基础结构，包括播报文本、字幕、路线和图片字段。

目前 Web 端的展会配置和导航查询调用已经写入前端，但对应的生产后端接口尚未在当前 API 路由中形成完整实现，需要继续联调。

## 已具备的底层能力

当前 OpenTalking API 已具备或基本具备以下运行时能力：

- 会话创建、启动、说话、转写、音频说话和会话中断。
- SSE 会话事件流和 WebRTC Offer/ICE 配置。
- 数字人形象、头像资源、自定义头像和预热能力。
- 音色列表、音色克隆、音色删除和 TTS 试听。
- 场景背景、场景组合和数字人场景资产。
- 知识文档、知识库、文档导入、文档重建索引和会话知识库绑定。
- 模型状态、健康检查、运行状态和队列状态。
- 视频创建、视频克隆、记忆和角色等 OpenTalking 基础能力。

这些能力可以作为展会数字人的底层运行时，但还需要通过展会业务数据、知识发布和 Admin 配置接口形成完整的生产链路。

## 需要补充的后端接口

后端接口补充按照当前 Admin/Web 模块倒排，不再直接按照完整项目功能清单拆分任务。

### Admin 接口

- **认证与权限**：
  `/api/v1/auth/login`、`/api/v1/auth/me`、`/api/v1/auth/refresh`、`/api/v1/auth/logout`、`/api/v1/auth/permissions`。
- **首页、告警与审计**：
  `/api/v1/admin/report`、`/api/v1/admin/alerts`、`/api/v1/admin/audit-logs`、`/api/v1/admin/trace-records`。
- **展会主数据**：展会 CRUD、展会生命周期、运行配置和当前展会上下文。
- **空间导览**：场地、楼层、展区、展位、设施、点位、路线、导航图片和路线发布。
- **参展内容**：展商、展品、活动排期、应急播报，以及启用/停用和终端下发。
- **数字人资产**：数字人形象、GIF、音色、场景绑定和待机内容的运营接口，兼容现有头像、音色、TTS 和场景资产接口。
- **知识中心**：文档、知识库、QA、话术、发布包、版本回滚、未命中池和文档重建索引。
- **线索与反馈**：线索列表、详情、授权、脱敏、状态流转、导出、反馈和 `trace_id` 关联。
- **数据、终端与运维**：交互记录、终端状态、指标概览、数据导出、运维和网关接口。

### Web 接口

- **展会数字人配置**：
  `GET /exhibitions/{exhibition_id}/digital-human-config`。
  返回当前展会的数字人配置、导航内容关键词和 `supports_deferred_speak` 等字段。
- **展会导航查询**：
  `POST /exhibitions/{exhibition_id}/navigation/query`。
  根据观众问题匹配展馆、楼层、展区、展位和设施，返回播报文本、字幕、路线、图片和兜底信息。
- **知识问答闭环**：将当前展会知识库、强控 QA、命中/未命中记录和 RAG 结果绑定到 Web 会话。
- **运行时联调**：统一会话错误码、超时、断线重连、播报中抢断、`defer_speak` 和异常恢复行为。

详细接口需求见：

- [Admin 所需补充接口](apps/admin所需补充接口.md)
- [Web 所需补充接口](apps/web所需补充接口.md)
- [Admin 功能规划](apps/admin功能规划.md)

## 当前未完成模块

### P0 优先级

- Admin 欢迎配置。
- Admin 讲解流程。
- Admin 系统管理，包括用户、角色、权限、审计和运维。
- Admin `FetchAdminApiClient` 真实接口接入，目前除登录、首页、GIF 列表/删除外，其他页面仍存在 Mock 数据映射。
- Web 导航后端服务，包括展会配置接口、导航查询接口和路线数据。
- Web 连续监听、回声抑制、播报中抢断、权限恢复和真实设备验收。
- 展会基础数据生产链路，包括入口、展馆、楼层、展区、展位、设施、路线、导航图片、展商展品和终端绑定。

### P1 优先级

- Admin 导购策略。
- Admin 线索运营。
- Admin 数据分析。
- Web 导购、线索登记、资料二维码和转化记录。

## 技术栈

| 层级 | 技术 |
| --- | --- |
| Admin/Web | React 18、TypeScript、Vite、Tailwind CSS |
| API | Python 3.10+、FastAPI、Uvicorn、Pydantic |
| 实时通信 | SSE、WebSocket、WebRTC、aiortc |
| 语音能力 | STT、TTS、音色配置、流式音频播放 |
| 模型与知识 | OpenTalking Runtime、LLM、RAG、知识库、记忆库 |
| 基础设施 | Redis、FFmpeg、GPU/CPU 模型运行环境 |

## 开发环境

建议使用以下环境：

- Python 3.10 或更高版本。
- Node.js 和 npm。
- Redis，默认地址为 `redis://localhost:6379/0`。
- FFmpeg。
- 如果使用真实数字人模型、STT 或本地 TTS，需要准备对应的 GPU、模型权重和运行环境。

## 快速启动

### 1. 安装后端依赖

在项目根目录执行：

```bash
uv sync --extra dev
source .venv/bin/activate
cp .env.example .env
```

根据实际环境修改 `.env`，至少配置 Redis 和所使用的 LLM、STT、TTS 服务。

### 2. 启动 API

确保 Redis 已启动后，在项目根目录执行：

```bash
uv run opentalking-api
```

API 默认监听 `http://127.0.0.1:8000`。也可以使用：

```bash
uv run uvicorn apps.api.main:create_app --factory --host 0.0.0.0 --port 8000
```

### 3. 启动 Web 数字人端

```bash
cd apps/web
npm install
npm run dev
```

Web 默认访问地址为 <http://localhost:5173>。Vite 会将 `/api` 请求代理到后端 `8000` 端口。需要指定展会时，可以配置：

```bash
export VITE_EXHIBITION_ID=<exhibition-id>
export VITE_BACKEND_PORT=8000
npm run dev
```

### 4. 启动 Admin 管理后台

```bash
cd apps/admin
npm install
VITE_ADMIN_API_MODE=mock npm run dev -- --port 5174
```

当前 Admin 默认可以使用 Mock 数据查看页面和基础交互。需要接入真实 Admin API 时使用：

```bash
VITE_ADMIN_API_MODE=real npm run dev -- --port 5174
```

真实接口接入前，需要确认 `apps/admin/vite.config.ts` 中的 API 代理目标指向实际后端地址，并完成 `FetchAdminApiClient` 中各模块的接口映射。

### 5. 一键启动底层运行时

如果只需要快速验证 OpenTalking 的底层会话、TTS、SSE 和 WebRTC 路径，可以使用 Mock 模式：

```bash
bash scripts/start_unified.sh --mock
```

停止服务：

```bash
bash scripts/quickstart/stop_all.sh
```

## 验证命令

前端 TypeScript 类型检查：

```bash
cd apps/admin && npm run typecheck
cd ../web && npm run typecheck
```

当前 Admin 和 Web 类型检查已通过。前端测试命令为：

```bash
cd apps/admin && npm test
cd ../web && npm test
```

如果测试启动时出现 `tsx` 创建临时 IPC 管道的 `EPERM`，应先检查当前运行环境的沙箱或临时目录权限；该启动限制不能直接判定为业务代码测试失败。

后端测试可以在项目根目录执行：

```bash
uv run pytest
```

## 团队分工

| 小组 | 成员 | 主要职责 | 指导老师 |
| --- | --- | --- | --- |
| 后端小组 | 郭作佳 | Admin 认证、RBAC、展会/线索/报表/系统接口、终端、审计和运维 | 张强 |
| 后端小组 | 陈文凯 | OpenTalking sessions、SSE/WebRTC、媒体流、运行时兼容、健康和队列 | 张强 |
| 后端与模型 | 曹飞扬（RAG） | RAG、知识库、QA、发布、未命中池、意图和导航检索 | 张强、陈瑞鼎 |
| 模型小组 | 吉祥（算法模型） | 大模型、TTS/STT、数字人驱动、实时渲染、延迟和降级 | 陈瑞鼎 |
| 前端小组 | 苏梦龙 | Admin 框架、认证首页、展会运营、交互管理、权限和前后端接入 | 苏长明 |
| 前端小组 | 吴涓 | Web 语音交互、VAD、连续监听、展会配置、意图分流和异常恢复 | 苏长明 |
| 前端小组 | 童治 | Admin 数字资产/知识/线索/报表，以及 Web 导航、卡片和导购展示 | 苏长明 |

## 项目资料

- [Admin 所需补充接口](apps/admin所需补充接口.md)
- [Web 所需补充接口](apps/web所需补充接口.md)
- [Admin 功能规划](apps/admin功能规划.md)

## 说明

本 README 以当前项目代码、Admin/Web 页面、已有 OpenTalking API 和接口补充文档为准。项目功能状态分为：

- **已具备**：代码或运行时接口已经存在，可以进行基础验证。
- **部分完成**：页面或基础能力已经存在，但真实业务接口、数据链路或生产联调尚未完成。
- **待补充**：当前页面未启用，或后端接口、业务数据和完整联调链路尚未形成。

项目最终交付需要以 Admin 配置、后端发布、RAG 检索、Web 交互和现场终端联调全部打通为准。
