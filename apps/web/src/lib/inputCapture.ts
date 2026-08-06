export const INPUT_EVENT_VERSION = 1 as const;
export const INPUT_SCAN_EVENT_NAME = "digital-human:scan";

export type InputCaptureSource = "microphone" | "touch" | "scan";
export type InputCaptureKind =
  | "voice.started"
  | "voice.ended"
  | "voice.interrupted"
  | "voice.error"
  | "touch"
  | "scan";

export type InputCapturePayload = Readonly<Record<string, string | number | boolean | null>>;

export type InputCaptureEvent = {
  eventId: string;
  eventVersion: typeof INPUT_EVENT_VERSION;
  sessionId: string | null;
  terminalId: string;
  occurredAt: string;
  source: InputCaptureSource;
  kind: InputCaptureKind;
  correlationId: string;
  payload: InputCapturePayload;
};

export type ScanInputDetail = {
  targetId: string;
  routeId?: string;
  assetId?: string;
  correlationId?: string;
};

type CreateInputCaptureEventArgs = {
  sessionId?: string | null;
  terminalId?: string | null;
  source: InputCaptureSource;
  kind: InputCaptureKind;
  correlationId?: string | null;
  payload?: InputCapturePayload;
  now?: number;
};

function cleanId(value: string | null | undefined, fallback: string): string {
  const normalized = value?.trim();
  return normalized ? normalized.slice(0, 128) : fallback;
}

function randomToken(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function createInputCorrelationId(prefix = "input"): string {
  return `${cleanId(prefix, "input")}-${randomToken()}`;
}

export function createInputCaptureEvent({
  sessionId = null,
  terminalId = "web-terminal",
  source,
  kind,
  correlationId = null,
  payload = {},
  now = Date.now(),
}: CreateInputCaptureEventArgs): InputCaptureEvent {
  const normalizedCorrelationId = correlationId?.trim();
  return {
    eventId: createInputCorrelationId("event"),
    eventVersion: INPUT_EVENT_VERSION,
    sessionId: sessionId?.trim() || null,
    terminalId: cleanId(terminalId, "web-terminal"),
    occurredAt: new Date(now).toISOString(),
    source,
    kind,
    correlationId: normalizedCorrelationId ? cleanId(normalizedCorrelationId, source) : createInputCorrelationId(source),
    payload,
  };
}

function optionalId(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized ? normalized.slice(0, 128) : undefined;
}

export function parseScanInputDetail(value: unknown): ScanInputDetail | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const targetId = optionalId(raw.targetId ?? raw.target_id);
  if (!targetId) return null;
  const routeId = optionalId(raw.routeId ?? raw.route_id);
  const assetId = optionalId(raw.assetId ?? raw.asset_id);
  const correlationId = optionalId(raw.correlationId ?? raw.correlation_id);
  return {
    targetId,
    ...(routeId ? { routeId } : {}),
    ...(assetId ? { assetId } : {}),
    ...(correlationId ? { correlationId } : {}),
  };
}
