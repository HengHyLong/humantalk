export type MediaFailureCategory =
  | "connection-lost"
  | "timeout"
  | "service-unavailable"
  | "authorization-required"
  | "access-denied"
  | "scope-expired"
  | "protocol-incompatible"
  | "cancelled"
  | "unknown";

export type MediaRecoveryAction = "retry" | "reauthenticate" | "restart-scope" | "degrade" | "none";

export type MediaFailureClassification = {
  category: MediaFailureCategory;
  recoverable: boolean;
  recoveryAction: MediaRecoveryAction;
};

const FAILURE_CLASSIFICATIONS: Readonly<Record<MediaFailureCategory, Omit<MediaFailureClassification, "category">>> = {
  "connection-lost": { recoverable: true, recoveryAction: "retry" },
  timeout: { recoverable: true, recoveryAction: "retry" },
  "service-unavailable": { recoverable: true, recoveryAction: "retry" },
  "authorization-required": { recoverable: false, recoveryAction: "reauthenticate" },
  "access-denied": { recoverable: false, recoveryAction: "none" },
  "scope-expired": { recoverable: false, recoveryAction: "restart-scope" },
  "protocol-incompatible": { recoverable: false, recoveryAction: "degrade" },
  cancelled: { recoverable: false, recoveryAction: "none" },
  unknown: { recoverable: false, recoveryAction: "degrade" },
};

export function classifyMediaFailure(category: MediaFailureCategory): MediaFailureClassification {
  return { category, ...FAILURE_CLASSIFICATIONS[category] };
}

export type ReconnectPolicy = {
  maxAttempts: number;
  delaysMs: readonly number[];
  jitterRatio: number;
};

export const DEFAULT_MEDIA_RECONNECT_POLICY: Readonly<ReconnectPolicy> = Object.freeze({
  maxAttempts: 3,
  delaysMs: Object.freeze([1_000, 2_000, 4_000]),
  jitterRatio: 0.1,
});

export type ReconnectDecision =
  | { shouldRetry: true; attempt: number; delayMs: number }
  | { shouldRetry: false; stopReason: "terminal-failure" | "attempts-exhausted"; recoveryAction: Exclude<MediaRecoveryAction, "retry"> | "degrade" };

export function decideMediaReconnect(
  failure: MediaFailureClassification,
  completedAttempts: number,
  jitterUnit = 0.5,
  policy: ReconnectPolicy = DEFAULT_MEDIA_RECONNECT_POLICY,
): ReconnectDecision {
  if (!Number.isInteger(policy.maxAttempts) || policy.maxAttempts < 0) throw new RangeError("maxAttempts must be a non-negative integer");
  if (!policy.delaysMs.length || policy.delaysMs.some((delay) => !Number.isFinite(delay) || delay < 0)) throw new RangeError("delaysMs must contain finite non-negative values");
  if (!Number.isFinite(policy.jitterRatio) || policy.jitterRatio < 0 || policy.jitterRatio > 1) throw new RangeError("jitterRatio must be between 0 and 1");
  if (!Number.isFinite(jitterUnit) || jitterUnit < 0 || jitterUnit > 1) throw new RangeError("jitterUnit must be between 0 and 1");
  if (!Number.isInteger(completedAttempts) || completedAttempts < 0) throw new RangeError("completedAttempts must be a non-negative integer");
  if (!failure.recoverable || failure.recoveryAction !== "retry") {
    return { shouldRetry: false, stopReason: "terminal-failure", recoveryAction: failure.recoveryAction === "retry" ? "degrade" : failure.recoveryAction };
  }
  if (completedAttempts >= policy.maxAttempts) return { shouldRetry: false, stopReason: "attempts-exhausted", recoveryAction: "degrade" };
  const baseDelayMs = policy.delaysMs[Math.min(completedAttempts, policy.delaysMs.length - 1)];
  const jitterMultiplier = 1 + policy.jitterRatio * (jitterUnit * 2 - 1);
  return { shouldRetry: true, attempt: completedAttempts + 1, delayMs: Math.round(baseDelayMs * jitterMultiplier) };
}

export const DEFAULT_SUBTITLE_FALLBACK_DELAY_MS = 1_500;
export const DEFAULT_SUBTITLE_TURN_LIMIT = 32;

export type SubtitleChunkInput = {
  scopeKey: string;
  turnKey: string;
  chunkKey: string;
  order: number;
  text: string;
  observedAtMs: number;
};

export type SubtitleTurnSignal = { scopeKey: string; turnKey: string; observedAtMs: number };
export type BufferedSubtitleChunk = { chunkKey: string; order: number; text: string; observedAtMs: number };
export type BufferedSubtitleTurn = {
  scopeKey: string;
  turnKey: string;
  createdAtMs: number;
  firstChunkAtMs?: number;
  mediaStartedAtMs?: number;
  endedAtMs?: number;
  chunks: readonly BufferedSubtitleChunk[];
};
export type SubtitleTurnBuffer = { fallbackDelayMs: number; turnLimit: number; turns: readonly BufferedSubtitleTurn[] };
export type SubtitleUpdateReason = "accepted" | "duplicate-chunk" | "duplicate-order" | "duplicate-signal" | "turn-ended";
export type SubtitleBufferUpdate = { buffer: SubtitleTurnBuffer; accepted: boolean; reason: SubtitleUpdateReason };
export type SubtitlePresentationReason = "missing-turn" | "empty" | "waiting-for-media" | "media-started" | "fallback";
export type SubtitlePresentation = { visible: boolean; degraded: boolean; reason: SubtitlePresentationReason; text: string; chunks: readonly BufferedSubtitleChunk[] };

function assertKey(value: string, name: string): void {
  if (!value.trim()) throw new TypeError(`${name} must not be empty`);
}

function assertTimestamp(value: number): void {
  if (!Number.isFinite(value)) throw new RangeError("observedAtMs must be finite");
}

function turnIndex(buffer: SubtitleTurnBuffer, scopeKey: string, turnKey: string): number {
  return buffer.turns.findIndex((turn) => turn.scopeKey === scopeKey && turn.turnKey === turnKey);
}

function putTurn(buffer: SubtitleTurnBuffer, turn: BufferedSubtitleTurn, existingIndex: number): SubtitleTurnBuffer {
  const turns = existingIndex >= 0
    ? buffer.turns.map((candidate, index) => index === existingIndex ? turn : candidate)
    : [...buffer.turns, turn].slice(-buffer.turnLimit);
  return { ...buffer, turns };
}

function unchanged(buffer: SubtitleTurnBuffer, reason: Exclude<SubtitleUpdateReason, "accepted">): SubtitleBufferUpdate {
  return { buffer, accepted: false, reason };
}

export function createSubtitleTurnBuffer(options: { fallbackDelayMs?: number; turnLimit?: number } = {}): SubtitleTurnBuffer {
  const fallbackDelayMs = options.fallbackDelayMs ?? DEFAULT_SUBTITLE_FALLBACK_DELAY_MS;
  const turnLimit = options.turnLimit ?? DEFAULT_SUBTITLE_TURN_LIMIT;
  if (!Number.isFinite(fallbackDelayMs) || fallbackDelayMs < 0) throw new RangeError("fallbackDelayMs must be finite and non-negative");
  if (!Number.isInteger(turnLimit) || turnLimit <= 0) throw new RangeError("turnLimit must be a positive integer");
  return { fallbackDelayMs, turnLimit, turns: [] };
}

function createTurn(signal: SubtitleTurnSignal): BufferedSubtitleTurn {
  return { scopeKey: signal.scopeKey, turnKey: signal.turnKey, createdAtMs: signal.observedAtMs, chunks: [] };
}

export function bufferSubtitleChunk(buffer: SubtitleTurnBuffer, input: SubtitleChunkInput): SubtitleBufferUpdate {
  assertKey(input.scopeKey, "scopeKey");
  assertKey(input.turnKey, "turnKey");
  assertKey(input.chunkKey, "chunkKey");
  assertTimestamp(input.observedAtMs);
  if (!Number.isFinite(input.order)) throw new RangeError("order must be finite");
  const existingIndex = turnIndex(buffer, input.scopeKey, input.turnKey);
  const existing = existingIndex >= 0 ? buffer.turns[existingIndex] : createTurn(input);
  if (existing.endedAtMs !== undefined) return unchanged(buffer, "turn-ended");
  if (existing.chunks.some((chunk) => chunk.chunkKey === input.chunkKey)) return unchanged(buffer, "duplicate-chunk");
  if (existing.chunks.some((chunk) => chunk.order === input.order)) return unchanged(buffer, "duplicate-order");
  const chunk = { chunkKey: input.chunkKey, order: input.order, text: input.text, observedAtMs: input.observedAtMs };
  const turn: BufferedSubtitleTurn = {
    ...existing,
    firstChunkAtMs: existing.firstChunkAtMs === undefined ? input.observedAtMs : Math.min(existing.firstChunkAtMs, input.observedAtMs),
    chunks: [...existing.chunks, chunk].sort((left, right) => left.order - right.order),
  };
  return { buffer: putTurn(buffer, turn, existingIndex), accepted: true, reason: "accepted" };
}

export function markSubtitleMediaStarted(buffer: SubtitleTurnBuffer, signal: SubtitleTurnSignal): SubtitleBufferUpdate {
  assertKey(signal.scopeKey, "scopeKey");
  assertKey(signal.turnKey, "turnKey");
  assertTimestamp(signal.observedAtMs);
  const existingIndex = turnIndex(buffer, signal.scopeKey, signal.turnKey);
  const existing = existingIndex >= 0 ? buffer.turns[existingIndex] : createTurn(signal);
  if (existing.endedAtMs !== undefined) return unchanged(buffer, "turn-ended");
  if (existing.mediaStartedAtMs !== undefined) return unchanged(buffer, "duplicate-signal");
  return { buffer: putTurn(buffer, { ...existing, mediaStartedAtMs: signal.observedAtMs }, existingIndex), accepted: true, reason: "accepted" };
}

export function endSubtitleTurn(buffer: SubtitleTurnBuffer, signal: SubtitleTurnSignal): SubtitleBufferUpdate {
  assertKey(signal.scopeKey, "scopeKey");
  assertKey(signal.turnKey, "turnKey");
  assertTimestamp(signal.observedAtMs);
  const existingIndex = turnIndex(buffer, signal.scopeKey, signal.turnKey);
  const existing = existingIndex >= 0 ? buffer.turns[existingIndex] : createTurn(signal);
  if (existing.endedAtMs !== undefined) return unchanged(buffer, "duplicate-signal");
  return { buffer: putTurn(buffer, { ...existing, endedAtMs: signal.observedAtMs }, existingIndex), accepted: true, reason: "accepted" };
}

export function getSubtitlePresentation(buffer: SubtitleTurnBuffer, scopeKey: string, turnKey: string, nowMs: number): SubtitlePresentation {
  assertTimestamp(nowMs);
  const index = turnIndex(buffer, scopeKey, turnKey);
  if (index < 0) return { visible: false, degraded: false, reason: "missing-turn", text: "", chunks: [] };
  const turn = buffer.turns[index];
  if (!turn.chunks.length || turn.firstChunkAtMs === undefined) return { visible: false, degraded: false, reason: "empty", text: "", chunks: turn.chunks };
  const text = turn.chunks.map((chunk) => chunk.text).join("");
  if (turn.mediaStartedAtMs !== undefined) return { visible: true, degraded: false, reason: "media-started", text, chunks: turn.chunks };
  if (nowMs - turn.firstChunkAtMs >= buffer.fallbackDelayMs) return { visible: true, degraded: true, reason: "fallback", text, chunks: turn.chunks };
  return { visible: false, degraded: false, reason: "waiting-for-media", text, chunks: turn.chunks };
}

export function removeSubtitleScope(buffer: SubtitleTurnBuffer, scopeKey: string): SubtitleTurnBuffer {
  return { ...buffer, turns: buffer.turns.filter((turn) => turn.scopeKey !== scopeKey) };
}

export function readMediaEventString(value: unknown, keys: readonly string[]): string | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  for (const key of keys) {
    const candidate = record[key];
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
  }
  return null;
}

export function readMediaEventNumber(value: unknown, keys: readonly string[]): number | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  for (const key of keys) {
    const candidate = record[key];
    if (typeof candidate === "number" && Number.isFinite(candidate)) return candidate;
  }
  return null;
}

export function compatibleSubtitleTurnKey(value: unknown, fallback: string): string {
  return readMediaEventString(value, ["turn_id", "turnId", "speech_id", "speechId"]) ?? fallback;
}

export function compatibleSubtitleChunkKey(value: unknown, fallback: string): string {
  return readMediaEventString(value, ["chunk_id", "chunkId", "event_id", "eventId"]) ?? fallback;
}

export function compatibleSubtitleChunkOrder(value: unknown, fallback: number): number {
  return readMediaEventNumber(value, ["sequence", "seq", "order", "index"]) ?? fallback;
}

export function compatibleSubtitleText(value: unknown): string {
  return readMediaEventString(value, ["text", "content", "delta"]) ?? "";
}

export type MediaPlaybackStatus = "idle" | "negotiating" | "buffering" | "playing" | "stalled" | "reconnecting" | "degraded" | "ended" | "error";
export type MediaPlaybackState = {
  status: MediaPlaybackStatus;
  hasRemoteStream: boolean;
  hasFirstFrame: boolean;
  reconnectAttempt: number;
  failureCategory: MediaFailureCategory | null;
  lastChangedAtMs: number | null;
};

export type MediaPlaybackEvent =
  | { type: "reset" }
  | { type: "negotiate" }
  | { type: "remote-stream" }
  | { type: "first-frame" }
  | { type: "connected" }
  | { type: "stalled" }
  | { type: "reconnect-requested"; attempt: number }
  | { type: "reconnected" }
  | { type: "degraded"; category: MediaFailureCategory }
  | { type: "ended" }
  | { type: "failed"; category: MediaFailureCategory };

export function createInitialMediaPlaybackState(): MediaPlaybackState {
  return { status: "idle", hasRemoteStream: false, hasFirstFrame: false, reconnectAttempt: 0, failureCategory: null, lastChangedAtMs: null };
}

export function mediaPlaybackReducer(state: MediaPlaybackState, event: MediaPlaybackEvent): MediaPlaybackState {
  const changed = (patch: Partial<MediaPlaybackState>): MediaPlaybackState => ({ ...state, ...patch, lastChangedAtMs: Date.now() });
  switch (event.type) {
    case "reset": return createInitialMediaPlaybackState();
    case "negotiate": return changed({ status: state.status === "playing" || state.status === "stalled" ? "reconnecting" : "negotiating", hasRemoteStream: false, hasFirstFrame: false, failureCategory: null });
    case "remote-stream": return changed({ hasRemoteStream: true, status: state.status === "negotiating" ? "buffering" : state.status });
    case "first-frame": return changed({ hasRemoteStream: true, hasFirstFrame: true, status: "playing", failureCategory: null });
    case "connected": return changed({ status: state.hasFirstFrame ? "playing" : "buffering", failureCategory: null });
    case "stalled": return changed({ status: "stalled" });
    case "reconnect-requested": return changed({ status: "reconnecting", reconnectAttempt: event.attempt });
    case "reconnected": return changed({ status: state.hasFirstFrame ? "playing" : "buffering", reconnectAttempt: 0, failureCategory: null });
    case "degraded": return changed({ status: "degraded", failureCategory: event.category });
    case "ended": return changed({ status: "ended" });
    case "failed": return changed({ status: "error", failureCategory: event.category });
  }
}

export function classifyPlaybackError(error: unknown): MediaFailureCategory {
  if (error instanceof DOMException) {
    if (error.name === "AbortError") return "cancelled";
    if (error.name === "NotAllowedError" || error.name === "SecurityError") return "access-denied";
    if (error.name === "NotSupportedError") return "protocol-incompatible";
  }
  if (error && typeof error === "object") {
    const status = (error as { status?: unknown }).status;
    if (typeof status === "number") {
      if (status === 401) return "authorization-required";
      if (status === 403) return "access-denied";
      if ([404, 409, 410].includes(status)) return "scope-expired";
      if (status === 426) return "protocol-incompatible";
      if (status >= 500) return "service-unavailable";
    }
  }
  return "connection-lost";
}
