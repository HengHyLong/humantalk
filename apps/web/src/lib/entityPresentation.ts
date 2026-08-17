import type { Message } from "../types";

export function selectCurrentEntityPresentation(messages: Message[]): Message[] {
  const latestMessage = messages[messages.length - 1];
  return latestMessage?.relatedEntities?.length ? [latestMessage] : [];
}
