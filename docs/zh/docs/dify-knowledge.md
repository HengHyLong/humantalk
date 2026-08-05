# Dify 知识库接口预留

本文面向后端部署和 Admin 联调人员。OpenTalking 通过服务端代理接入 Dify 知识库 API，浏览器不直接持有 Dify 知识库 API Key。

## 服务端配置

```dotenv
OPENTALKING_DIFY_API_BASE_URL=https://api.dify.ai/v1
OPENTALKING_DIFY_DATASET_API_KEY=
OPENTALKING_DIFY_TIMEOUT_SEC=30
```

兼容已有部署使用的 `DIFY_API_BASE_URL`、`DIFY_DATASET_API_KEY`。优先读取带 `OPENTALKING_` 前缀的变量。不要把密钥写入 `VITE_*` 变量或前端代码。

## Admin 代理接口

基础前缀：`/api/v1/admin/knowledge/dify`

| 方法 | 本项目接口 | Dify 上游接口 |
| --- | --- | --- |
| GET | `/status` | 仅检查本地配置，不请求 Dify |
| GET / POST | `/datasets` | `/datasets` |
| GET / PATCH / DELETE | `/datasets/{dataset_id}` | `/datasets/{dataset_id}` |
| POST | `/datasets/{dataset_id}/retrieve` | `/datasets/{dataset_id}/retrieve` |
| GET | `/datasets/{dataset_id}/documents` | `/datasets/{dataset_id}/documents` |
| POST | `/datasets/{dataset_id}/documents/text` | `/datasets/{dataset_id}/document/create-by-text` |
| POST | `/datasets/{dataset_id}/documents/file` | `/datasets/{dataset_id}/document/create-by-file` |
| GET | `/datasets/{dataset_id}/documents/indexing-status/{batch}` | `/datasets/{dataset_id}/documents/{batch}/indexing-status` |
| GET / POST | `/datasets/{dataset_id}/documents/{document_id}/segments` | `/datasets/{dataset_id}/documents/{document_id}/segments` |

文件上传使用 multipart：`file` 为文件，`data` 为 JSON 配置。文档创建是异步流程，前端应保存返回的 `batch`，轮询索引状态直到 `completed` 或 `error`。

未配置时返回 `503` 和错误码 `DIFY_NOT_CONFIGURED`；Dify 无法连接时返回 `502` 和错误码 `DIFY_UNAVAILABLE`；Dify 的业务错误保留其 HTTP 状态码并放入响应 `detail`。
