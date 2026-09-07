export function parseWakeWordsInput(value: string): string[] {
  return [...new Set(value.split(/[,，、\r\n]+/).map((item) => item.trim()).filter(Boolean))];
}

export function formatWakeWordsInput(wakeWords: string[]): string {
  return wakeWords.join("\n");
}
