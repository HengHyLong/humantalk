/** Generation may finish before playback. Only playback advances visible text. */
export type QaSpeechPresentation = {
  turnId: string;
  messageId: string;
  text: string;
  spokenText: string;
  active: boolean;
  ended: boolean;
};

export function newQaSpeechPresentation(turnId = "", messageId = ""): QaSpeechPresentation {
  return { turnId, messageId, text: "", spokenText: "", active: false, ended: false };
}

export function generatedQaText(state: QaSpeechPresentation, text: string): string {
  state.active = true;
  state.text = text;
  return state.ended ? text : state.spokenText;
}

export function spokenQaText(state: QaSpeechPresentation, text: string): string {
  state.spokenText = text;
  return text;
}

export function completedQaSpeech(state: QaSpeechPresentation, fallback: string): string {
  state.ended = true;
  return state.text || state.spokenText || fallback;
}
