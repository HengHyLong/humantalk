type LiveSubtitleProps = {
  text: string;
  english?: boolean;
  className?: string;
};

export function LiveSubtitle({ text, english = false, className = "" }: LiveSubtitleProps) {
  const content = text.trim();
  if (!content) return null;

  return (
    <div className={`digital-display-live-subtitle is-presentation-subtitle ${className}`.trim()} role="status" aria-live="polite">
      <span>{english ? "Digital Human" : "数字人"}</span>
      <p>{content}</p>
    </div>
  );
}
