# 数字人管理后台

管理后台位于 `/admin/`，与现有数字人 Studio 分离。它覆盖综合工作台、展会运营、业务内容、知识库、数字人资产、AI 配置、终端渠道、线索反馈、运营分析、运维监控和系统安全。

## 本地启动

```bash
.venv/bin/python -m uvicorn apps.api.admin_app:create_admin_app --factory --port 8000
```

先在 `apps/admin` 执行 `npm run build`，然后访问 `http://127.0.0.1:8000/admin/`。开发种子账号为 `admin / Admin@123456`，只允许用于本机开发。

也可以分别启动前后端：后台 API 使用 8000 端口，`apps/admin` 执行 `npm run dev` 后使用 5174 端口，Vite 会代理 `/api` 请求。

## 数据库和迁移

开发环境默认使用 `.opentalking/admin.db`。生产环境通过 `OPENTALKING_ADMIN_DATABASE_URL` 配置 PostgreSQL，并执行：

```bash
.venv/bin/alembic upgrade head
```

SQLAlchemy 模型与 Alembic 迁移覆盖账号角色、审批审计、展会、场馆路线、展商展品、知识文档与切片、发布包、数字人资产、终端渠道、会话消息、线索反馈、能力调用和告警事件。

## 安全配置

生产环境至少配置：

- `OPENTALKING_ENV=production`
- `OPENTALKING_ADMIN_PASSWORD`：初始管理员独立强密码
- `OPENTALKING_ADMIN_SECRET`：后台令牌派生密钥
- `OPENTALKING_DATA_ENCRYPTION_KEY`：Fernet 密钥，用于线索联系方式加密
- `OPENTALKING_TERMINAL_SHARED_KEY`：终端注册与心跳共享密钥

生产环境没有上述管理员密码和数据加密密钥时会拒绝初始化。后台管理接口不允许匿名访问；菜单、按钮和 API 均执行权限判断。发布、状态变更、用户创建与登录会记录操作前后值和 Trace ID。

## 知识资料导入

知识库页面支持 TXT、Markdown、CSV、Word、PDF 和 Excel，单文件最大 50MB。文件保存在本地数据域，解析后生成知识切片、解析统计和任务状态；可通过任务 SSE 地址读取最终进度。当前向量状态初始为 `pending`，后续由检索服务完成向量化和发布审核。

## API 分区

- `/api/v1/auth/*`：登录、刷新、退出和当前账号
- `/api/v1/admin/*`：工作台、资源、知识、用户、角色、审批、审计和 Trace
- `/api/v1/runtime/*`：统一问答、反馈和授权线索
- `/api/v1/terminal/*`：注册、心跳与配置拉取
- `/api/v1/channel/*`：渠道管理
- `/api/v1/gateway/*`：能力请求白名单和治理状态
- `/api/v1/ops/*`：健康、告警和降级配置

所有 HTTP 响应包含 `X-Trace-ID`。现有未版本化 Studio API 保持兼容，不会因后台改造被替换。
