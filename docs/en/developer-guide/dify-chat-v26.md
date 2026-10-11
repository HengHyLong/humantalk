# v2.6 digital human answer routing

The frontend submits text, transcribed speech and entity selections to `POST /exhibitions/{exhibition_id}/qa/query`. The backend searches available exhibitors, exhibits and routes within the selected exhibition. Existing public APIs expose draft records, so v2.6 preserves that availability without changing record status. Offline, inactive and deleted records are excluded.

- A unique exact keyword hit speaks stored copy or a description directly. Location questions use the booth or address; route questions use stored speech or directions. The response has `match_type=database` and makes no Dify call.
- Missing matches, fuzzy matches, ambiguous names and missing requested content use a Dify chat application with the current database context. Ordinary answers return `match_type=dify`; ambiguous matches return `clarification`.
- Both paths send `direct=true` to the avatar speech pipeline, bypassing OpenTalking's conversational LLM. Dify failures produce a fixed service message.

Configure the application Base URL, API key, timeout and candidate limit in the admin model management page and test connectivity. The key stays in the server environment file and is never returned to the frontend. Maintain entity keywords, aliases, descriptions and speech copy in exhibition management.

Environment variables: `OPENTALKING_DIFY_CHAT_BASE_URL`, `OPENTALKING_DIFY_CHAT_API_KEY`, `OPENTALKING_DIFY_CHAT_TIMEOUT_SEC`, `OPENTALKING_DIFY_CHAT_TOP_K`. These application credentials are separate from legacy dataset retrieval credentials.

Use a Dify chat application or Chatflow with optional inputs `exhibition_id`, `locale`, `retrieval_status` and `retrieval_context`. The last input contains JSON database facts. Prioritize current facts and clarify missing information. Output only the final answer and separate model reasoning.

Each session stores its Dify conversation ID and recent entity choices. Direct database turns preserve the conversation ID. Subsequent Dify requests continue that conversation with fresh facts. New questions, interruption and session closure cancel obsolete tasks and prevent stale speech from entering the queue.

## Matching and navigation checks

Codes require complete boundaries: `S-01`, `S01` and `S_01` are equivalent, while `S010` is different. Numeric codes require a standalone input or identifier context; `02` never matches `CNCC2026`. Negated names are excluded. A longer name only suppresses a shorter alias at the same text span; separately mentioned objects remain candidates.

Direct database speech requires an exact match, a supported introduction/location/list/validated-route intent, sufficient facts, and no ambiguity or truncation. Prices, founding dates, comparisons, pros/cons, compound questions, schedules, fuzzy names, missing fields and English translations go to Dify. Complete lists can be spoken directly; partial lists carry a total and truncation flag.

The exhibition workspace provides terminal point and intent keyword settings plus a read-only configuration audit. Operators must set `terminalPointId` according to the physical installation. Requests can supply `origin_point_id`; an origin explicitly named in the question takes priority. Missing or unknown origins, missing routes, conflicting endpoints, multiple destinations and cross-exhibition requests receive fixed clarification prompts. Routes are never reversed or stitched together.

Follow-ups prioritize explicit current names/codes or corrections, then valid ordinals, then a pronoun referring to one unique candidate. Cards and cached candidates share display order; routes store separate route IDs. Registration returns a `registration` action only for a unique exhibit with a real survey URL; the frontend generates its QR code without a second speech request.

Responses add `routing_reason` and `registration`. Dify context adds `current_exhibition`, `intent`, `routing_reason`, `truncated`, `origin_id` and `destination_id`. Hit logs record fields, keywords, decision reason, entity/route IDs and endpoints.

`POST /api/v1/admin/event/exhibitions/{id}/runtime-config/validate` returns `issues` for route conflicts, missing terminal points, unlinked points, duplicated match terms and image markup. Route writes reject structural and recognized endpoint conflicts. Speech removes image markup while preserving original data and images. Uncertain business facts require operator verification.

The production Dify system prompt is maintained in `configs/prompts/dify_exhibition_v26.txt`; publish it in the Dify LLM node after backing up the workflow. Existing optional inputs remain compatible. The legacy avatar role prompt is not used by this Q&A chain. Unverified knowledge documents cannot override current database facts.
