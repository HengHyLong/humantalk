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

## Dify 网页知识库发现与展会绑定

`GET /agent/knowledge-bases` 会合并本地 registry 和当前服务端 Dify API Key
可访问的 `/datasets` 列表。因此，直接在 Dify 网页创建的知识库也会出现在 Admin
的“数字人与知识库”选择区；后端会为尚未登记的 dataset 生成稳定的
`knowledge_base_id`，但不会把 Dify dataset ID 返回浏览器。

在“本届工作台 → 数字人与知识库”中保存运行配置时，后端会把选中的一个或多个
`knowledgeBaseIds` 一次性同步到 Dify registry，并把 registry 中的
`exhibition_id` 更新为展会记录的真实 ID。取消选择的旧知识库会保留映射，但清空
展会归属，后续可重新绑定到其他展会。默认 registry 文件位于
`OPENTALKING_AGENT_KNOWLEDGE_ROOT/knowledge_base_registry.json`；如配置了
`OPENTALKING_AGENT_DIFY_REGISTRY_PATH`，则以指定路径为准。

如果 Dify 的 dataset 列表接口暂时不可用，列表接口会回退到已登记的 registry，
不会影响已绑定知识库的召回。

## 数字人问答绑定多个知识库

前端只传稳定的 `knowledge_base_id`，不要传 Dify 的 dataset ID。创建会话时可以绑定一个或多个知识库：

```http
POST /sessions
Content-Type: application/json
```

```json
{
  "avatar_id": "可用数字人 ID",
  "model": "mock",
  "agent_enabled": true,
  "knowledge_enabled": true,
  "knowledge_base_ids": ["kb-001", "kb-002"]
}
```

之后调用展会问答接口时，后端会读取会话中的知识库绑定，分别请求对应的 Dify dataset，合并、按分数排序并截取 Top-K：

```http
POST /exhibitions/{exhibition_id}/qa/query
Content-Type: application/json
```

```json
{
  "session_id": "session-id",
  "turn_id": "turn-001",
  "question": "这个展会有哪些重点活动？"
}
```

如需临时覆盖会话绑定，也可以在问答请求中传 `knowledge_base_ids`。后端会校验知识库是否属于当前展会；Dify 的 API Key 和 dataset ID 始终只在服务端使用。响应的 `sources` 会带回 `knowledge_base_id` 和 `namespace_id`，方便前端展示来源。

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
