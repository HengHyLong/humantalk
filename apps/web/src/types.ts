export type ConnectionStatus = "idle" | "connecting" | "queued" | "live" | "expiring" | "error";

export interface QueueInfo {
  position: number;   // >0 = waiting, 0 = slot acquired, -1 = rejected
  message: string;    // "waiting" | "slot_acquired" | "queue_full" | "timeout"
}

export type ExhibitionEntityKind = "exhibition" | "exhibitor" | "exhibit" | "venue" | "point" | "schedule";

export type ExhibitionEntityCard = {
  id: string;
  kind: ExhibitionEntityKind;
  /** 展品所属展商 ID，用于展商介绍后的产品列表联动。 */
  parent_id?: string | null;
  name: string;
  description: string;
  image_urls: string[];
  details: Array<{ label: string; value: string }>;
  keywords: string[];
  fuzzy_keywords?: string[];
  spoken_text?: string;
  /** 管理后台为展品生成的调研二维码链接。 */
  survey_path?: string;
};

export interface Message {
  id: string;
  role: "user" | "assistant";
  text: string;
  timestamp: number;
  relatedEntities?: ExhibitionEntityCard[];
  qa?: {
    turnId: string;
    traceId?: string;
    matchType?: "official_qa" | "rag" | "clarification" | "fallback" | "retrieval_error" | "blocked";
    sources?: Array<{ id: string; title: string; excerpt: string; score: number }>;
  };
}

export type MemoryLibrary = {
  id: string;
  name: string;
  profile_id: string;
  character_id: string;
  memory_count: number;
  created_at: string;
  updated_at: string;
};

export type MemoryItem = {
  id: string;
  text: string;
  type: string;
  metadata: Record<string, unknown> | null;
  created_at: string;
};

export type MemoryTurn = {
  role: "user" | "assistant";
  content: string;
};

export type WeChatImportSpeaker = {
  id: string;
  name: string;
  message_count: number;
  is_self: boolean;
  metadata: Record<string, unknown>;
};

export type WeChatImportJob = {
  id: string;
  status: "needs_speaker_selection" | "draft_ready" | "committed" | "error" | string;
  speakers: WeChatImportSpeaker[];
  profile_id: string;
  memory_library_id: string;
  avatar_id: string;
  avatar_model: string;
  character_id: string;
  selected_speaker_id?: string | null;
  persona_md?: string | null;
  source_metadata: Record<string, unknown>;
  error?: string | null;
  created_at: string;
  updated_at: string;
};

export type WeChatImportCommitResult = {
  job_id: string;
  persona_id: string;
  memory_imported: number;
  persona_md_bytes: number;
  profile_id: string;
  character_id: string;
  memory_library_id: string;
};
