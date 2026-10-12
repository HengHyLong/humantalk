import type { NavigationResult } from "./api";

/** Accept both legacy navigation and v2.6 QA responses. */
export function resolveNavigationImage(
  navigation: Pick<NavigationResult, "image_url" | "image_urls"> | null | undefined,
  apiUrl: (path: string) => string,
): string {
  const image = [navigation?.image_url, ...(navigation?.image_urls ?? [])]
    .find((value) => typeof value === "string" && value.trim())?.trim() ?? "";
  return image.startsWith("/scene-assets/") ? apiUrl(image) : image;
}
