import type { NavigationResult } from "./api";

type UnknownRecord = Record<string, unknown>;

export type NavigationStep = {
  id: string;
  index: number;
  instruction: string;
  spokenText: string;
  pointId?: string;
};

export type NavigationMarker = {
  id: string;
  label: string;
  x: number;
  y: number;
  stepIndex?: number;
};

export type NavigationPresentation = {
  routeId: string | null;
  title: string;
  summary: string;
  from: string;
  to: string;
  estimatedMinutes: number | null;
  imageUrl: string | null;
  steps: NavigationStep[];
  markers: NavigationMarker[];
};

function record(value: unknown): UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as UnknownRecord
    : {};
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function numberValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, value));
}

function normalizeStep(value: unknown, index: number): NavigationStep | null {
  if (typeof value === "string") {
    const instruction = value.trim();
    if (!instruction) return null;
    return {
      id: `step-${index + 1}`,
      index,
      instruction,
      spokenText: instruction,
    };
  }

  const item = record(value);
  const instruction = text(item.instruction ?? item.text ?? item.description ?? item.title);
  if (!instruction) return null;
  const id = text(item.id ?? item.step_id ?? item.stepId) || `step-${index + 1}`;
  const spokenText = text(item.spoken_text ?? item.spokenText ?? item.instruction) || instruction;
  const pointId = text(item.point_id ?? item.pointId) || undefined;
  return { id, index, instruction, spokenText, pointId };
}

function normalizeSteps(value: unknown): NavigationStep[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item, index) => normalizeStep(item, index))
    .filter((item): item is NavigationStep => item !== null)
    .map((item, index) => ({ ...item, index }));
}

function normalizeMarker(value: unknown, index: number): NavigationMarker | null {
  const item = record(value);
  const x = numberValue(item.x ?? item.left);
  const y = numberValue(item.y ?? item.top);
  if (x === null || y === null) return null;
  const id = text(item.id ?? item.point_id ?? item.pointId) || `marker-${index + 1}`;
  const label = text(item.label ?? item.name ?? item.title) || id;
  const rawStepIndex = numberValue(item.step_index ?? item.stepIndex);
  return {
    id,
    label,
    x: clampPercent(x),
    y: clampPercent(y),
    stepIndex: rawStepIndex === null ? index : Math.max(0, Math.floor(rawStepIndex)),
  };
}

function normalizeMarkers(value: unknown): NavigationMarker[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item, index) => normalizeMarker(item, index))
    .filter((item): item is NavigationMarker => item !== null);
}

/**
 * Converts the currently documented navigation response into a stable UI model.
 * Optional enriched map/step fields are read defensively so a future reviewed
 * contract can add coordinates without changing the presentation component.
 */
export function normalizeNavigationPresentation(result: NavigationResult): NavigationPresentation {
  const raw = record(result as unknown);
  const route = record(raw.route);
  const map = record(raw.map ?? route.map);
  const directions = route.directions ?? raw.directions;
  const steps = normalizeSteps(route.steps ?? raw.steps ?? directions);
  const summary = text(raw.subtitle_text ?? raw.spoken_text) || "已为你整理好前往目的地的路线。";

  return {
    routeId: text(raw.route_id ?? raw.routeId ?? route.id ?? route.route_id) || null,
    title: text(raw.title ?? route.title) || "导航指引",
    summary,
    from: text(route.from ?? raw.from) || "当前位置",
    to: text(route.to ?? raw.to),
    estimatedMinutes: numberValue(route.estimated_minutes ?? route.estimatedMinutes ?? raw.estimated_minutes),
    imageUrl: text(raw.image_url ?? raw.imageUrl ?? map.image_url ?? map.imageUrl ?? route.image_url ?? route.imageUrl) || null,
    steps: steps.length ? steps : [{ id: "step-1", index: 0, instruction: summary, spokenText: summary }],
    markers: normalizeMarkers(map.markers ?? route.markers ?? raw.markers),
  };
}

export function navigationProgress(activeStep: number, stepCount: number): number {
  if (stepCount <= 1) return 100;
  const safeStep = Math.max(0, Math.min(stepCount - 1, activeStep));
  return Math.round((safeStep / (stepCount - 1)) * 100);
}
