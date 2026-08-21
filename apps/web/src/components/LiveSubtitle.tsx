type LiveSubtitleProps = {
  text: string;
  english?: boolean;
};

export function LiveSubtitle({ text, english = false }: LiveSubtitleProps) {
  const content = text.trim();
  if (!content) return null;

  return (
    <div className="digital-display-live-subtitle is-presentation-subtitle" role="status" aria-live="polite">
      <span>{english ? "Digital Human" : "数字人"}</span>
      <p>{content}</p>
    </div>
  );
}
