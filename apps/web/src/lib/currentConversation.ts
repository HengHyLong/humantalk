import type { Message } from "../types";

/** Display one exchange while keeping the full session history intact. */
export function selectCurrentConversation(messages: Message[]): Message[] {
  let user: Message | undefined;
  let assistant: Message | undefined;
  for (const message of messages) {
    if (message.role === "user") {
      user = message;
      assistant = undefined;
    } else {
      assistant = message;
    }
  }
  return [user, assistant].filter((message): message is Message => Boolean(message));
}
