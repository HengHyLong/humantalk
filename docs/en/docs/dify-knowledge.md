# Reserved Dify knowledge API

This integration is for backend deployments and Admin integration testing. OpenTalking proxies Dify Knowledge API requests on the server so the browser never receives the Dify dataset API key.

## Server configuration

```dotenv
OPENTALKING_DIFY_API_BASE_URL=https://api.dify.ai/v1
OPENTALKING_DIFY_DATASET_API_KEY=
OPENTALKING_DIFY_TIMEOUT_SEC=30
```

`DIFY_API_BASE_URL` and `DIFY_DATASET_API_KEY` are accepted for existing deployments. Prefixed variables take precedence. Never place the key in a `VITE_*` variable or frontend source code.

## Admin proxy endpoints

Base prefix: `/api/v1/admin/knowledge/dify`

| Method | OpenTalking endpoint | Dify upstream endpoint |
| --- | --- | --- |
| GET | `/status` | Checks local configuration only |
| GET / POST | `/datasets` | `/datasets` |
| GET / PATCH / DELETE | `/datasets/{dataset_id}` | `/datasets/{dataset_id}` |
| POST | `/datasets/{dataset_id}/retrieve` | `/datasets/{dataset_id}/retrieve` |
| GET | `/datasets/{dataset_id}/documents` | `/datasets/{dataset_id}/documents` |
| POST | `/datasets/{dataset_id}/documents/text` | `/datasets/{dataset_id}/document/create-by-text` |
| POST | `/datasets/{dataset_id}/documents/file` | `/datasets/{dataset_id}/document/create-by-file` |
| GET | `/datasets/{dataset_id}/documents/indexing-status/{batch}` | `/datasets/{dataset_id}/documents/{batch}/indexing-status` |
| GET / POST | `/datasets/{dataset_id}/documents/{document_id}/segments` | `/datasets/{dataset_id}/documents/{document_id}/segments` |

File upload is multipart: `file` contains the file and `data` contains JSON processing options. Document creation is asynchronous; retain the returned `batch` and poll until every indexing status is `completed` or `error`.

Missing configuration returns `503` with `DIFY_NOT_CONFIGURED`. Connectivity failures return `502` with `DIFY_UNAVAILABLE`. Dify business errors retain their upstream HTTP status and are returned in `detail`.
