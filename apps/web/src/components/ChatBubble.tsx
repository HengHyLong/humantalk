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
        {!isUser && message.qa?.matchType ? (
          <div className="flex max-w-full flex-wrap items-center gap-2 text-[11px] text-slate-500">
            <span className="rounded-full bg-cyan-50 px-2 py-1 font-medium text-cyan-700">
              {{
                official_qa: "官方问答",
                rag: "知识库",
                clarification: "需要补充",
                fallback: "人工兜底",
                retrieval_error: "检索故障",
                blocked: "安全拦截",
              }[message.qa.matchType]}
            </span>
            {message.qa.traceId ? <span>Trace：{message.qa.traceId}</span> : null}
          </div>
        ) : null}
        {!isUser && message.qa?.sources?.length ? (
          <div className="w-full rounded-lg border border-slate-200 bg-white p-2 text-xs text-slate-600">
            <p className="mb-1 font-semibold text-slate-700">回答依据</p>
            {message.qa.sources.map((source) => (
              <p key={`${message.id}-${source.id}`} className="truncate" title={source.excerpt}>
                {source.title} · {Math.round(source.score * 100)}%
              </p>
            ))}
          </div>
        ) : null}
        {message.relatedEntities?.map((entity) => (
          <ExhibitionEntityCard key={`${message.id}-${entity.kind}-${entity.id}`} entity={entity} />
        ))}
      </div>
    </div>
  );
}
