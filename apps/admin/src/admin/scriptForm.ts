export function resolveScriptExhibitionId(
  exhibitionIds: string[],
  requestedId: string | undefined,
  fallbackId: string,
): string {
  if (requestedId && exhibitionIds.includes(requestedId)) return requestedId;
  if (fallbackId && exhibitionIds.includes(fallbackId)) return fallbackId;
  return exhibitionIds[0] || "";
}
