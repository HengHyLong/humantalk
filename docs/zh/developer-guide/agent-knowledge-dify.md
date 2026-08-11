# Dify 知识库接入

`v1.5` 的知识库接口保持稳定的 OpenTalking ID，Dify 的 API Key 和 dataset ID 只由后端使用。

## 配置

在服务端 `.env` 配置：

```dotenv
OPENTALKING_AGENT_RAG_PROVIDER=dify
OPENTALKING_AGENT_DIFY_BASE_URL=https://your-dify-host/v1
OPENTALKING_AGENT_DIFY_API_KEY=<server-only-api-key>
```

单知识库场景可以把现有 dataset 绑定到稳定 ID：

```dotenv
OPENTALKING_AGENT_DIFY_DATASET_ID=<dify-dataset-id>
OPENTALKING_AGENT_DIFY_KNOWLEDGE_BASE_ID=kb-001
OPENTALKING_AGENT_DIFY_DEFAULT_EXHIBITION_ID=expo-2026
OPENTALKING_AGENT_DIFY_DEFAULT_NAMESPACE_ID=namespace-001
```

多知识库场景建议使用 registry：

```dotenv
OPENTALKING_AGENT_DIFY_KNOWLEDGE_BASE_REGISTRY={"kb-001":{"name":"四川博览集团知识库","exhibition_id":"expo-2026","namespace_id":"namespace-001","dify_dataset_id":"dataset-001","status":"active"}}
```

也可以把 JSON 放在 `OPENTALKING_AGENT_DIFY_REGISTRY_PATH` 指定的文件中。

## 代理接口

Admin 代理接口需要 Admin 登录 Token：

```text
GET  /api/v1/admin/knowledge/bases
GET  /api/v1/admin/knowledge/documents?knowledgeBaseId=kb-001&exhibition_id=expo-2026&namespace_id=namespace-001
POST /api/v1/admin/knowledge/documents/upload
GET  /api/v1/admin/knowledge/documents/batches/{batch_id}/indexing-status
POST /api/v1/admin/knowledge/retrieve
```

召回请求示例：

```json
{
  "query": "四川博览集团",
  "exhibition_id": "expo-2026",
  "knowledgeBaseId": "kb-001",
  "namespaceId": "namespace-001",
  "limit": 3
}
```

成功响应中的 `results` 使用后端稳定字段：`document_id`、`content`、`score`、`metadata`。前端不需要传 `dify_dataset_id`。

## 现有前端兼容接口

Admin/Web 现有页面继续使用：

```text
/agent/knowledge-bases
/agent/knowledge-documents
/agent/knowledge-bases/{knowledge_base_id}/documents
/agent/knowledge-bases/{knowledge_base_id}/rag/query
```

当 `OPENTALKING_AGENT_RAG_PROVIDER=dify` 时，这些接口的索引和查询会通过 Dify；不配置 Dify 时继续使用 LightRAG。

## 错误契约

代理错误统一返回：

```json
{
  "code": "KNOWLEDGE_BASE_NOT_FOUND",
  "detail": "知识库不存在",
  "trace_id": "trace_xxx"
}
```

当前覆盖的主要错误码包括：

- `KNOWLEDGE_BASE_NOT_FOUND`
- `KNOWLEDGE_BASE_EXHIBITION_MISMATCH`
- `KNOWLEDGE_BASE_NAMESPACE_MISMATCH`
- `KNOWLEDGE_DOCUMENT_NOT_FOUND`
- `KNOWLEDGE_PROVIDER_UNAVAILABLE`
