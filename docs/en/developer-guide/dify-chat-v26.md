# v2.6 digital human answer routing

The frontend submits text, transcribed speech and entity selections to `POST /exhibitions/{exhibition_id}/qa/query`. The backend searches available exhibitors, exhibits and routes within the selected exhibition. Existing public APIs expose draft records, so v2.6 preserves that availability without changing record status. Offline, inactive and deleted records are excluded.

- A unique exact keyword hit speaks stored copy or a description directly. Location questions use the booth or address; route questions use stored speech or directions. The response has `match_type=database` and makes no Dify call.
- Missing matches, fuzzy matches, ambiguous names and missing requested content use a Dify chat application with the current database context. Ordinary answers return `match_type=dify`; ambiguous matches return `clarification`.
- Both paths send `direct=true` to the avatar speech pipeline, bypassing OpenTalking's conversational LLM. Dify failures produce a fixed service message.

Configure the application Base URL, API key, timeout and candidate limit in the admin model management page and test connectivity. The key stays in the server environment file and is never returned to the frontend. Maintain entity keywords, aliases, descriptions and speech copy in exhibition management.

Environment variables: `OPENTALKING_DIFY_CHAT_BASE_URL`, `OPENTALKING_DIFY_CHAT_API_KEY`, `OPENTALKING_DIFY_CHAT_TIMEOUT_SEC`, `OPENTALKING_DIFY_CHAT_TOP_K`. These application credentials are separate from legacy dataset retrieval credentials.

Use a Dify chat application or Chatflow with optional inputs `exhibition_id`, `locale`, `retrieval_status` and `retrieval_context`. The last input contains JSON database facts. Prioritize current facts and clarify missing information. Output only the final answer and separate model reasoning.

Each session stores its Dify conversation ID and recent entity choices. Direct database turns preserve the conversation ID. Subsequent Dify requests continue that conversation with fresh facts. New questions, interruption and session closure cancel obsolete tasks and prevent stale speech from entering the queue.
