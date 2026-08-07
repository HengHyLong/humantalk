import type { Message } from "../types";
import { ExhibitionEntityCard } from "./ExhibitionEntityCard";

interface ChatBubbleProps {
  message: Message;
}

export function ChatBubble({ message }: ChatBubbleProps) {
  const isUser = message.role === "user";

  return (
    <div className={`flex animate-slide-up ${isUser ? "justify-end" : "justify-start"}`}>
      <div className={`flex max-w-[92%] flex-col gap-2 ${isUser ? "items-end" : "items-start"}`}>
        <div
          className={`rounded-lg px-3 py-2 text-sm leading-relaxed ${
            isUser
              ? "bg-cyan-600 text-white"
              : "bg-slate-100 text-slate-800"
          }`}
        >
          {message.text}
        </div>
        {message.relatedEntities?.map((entity) => (
          <ExhibitionEntityCard key={`${message.id}-${entity.kind}-${entity.id}`} entity={entity} />
        ))}
      </div>
    </div>
  );
}
