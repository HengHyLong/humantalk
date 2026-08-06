import {
  DEFAULT_WELCOME_OVERVIEW,
  welcomePhaseLabel,
  type WelcomePhase,
} from "../lib/welcomeExperience";

type WelcomeOverviewCardProps = {
  phase: WelcomePhase;
  replayDisabled?: boolean;
  onReplay?: () => void;
  onOpenMultimodalPreview?: () => void;
};

function phaseHint(phase: WelcomePhase): string {
  switch (phase) {
    case "speaking":
      return "正在为你介绍，可以随时提问或打断。";
    case "interrupted":
      return "介绍已暂停，你可以继续提问。";
    case "failed":
      return "自动介绍暂时不可用，你仍可以直接输入问题。";
    case "cooldown":
      return "你可以继续提问，或选择下方服务入口。";
    default:
      return "连接后我会先做简要介绍，也可以直接选择下方服务。";
  }
}

export function WelcomeOverviewCard({
  phase,
  replayDisabled = false,
  onReplay,
  onOpenMultimodalPreview,
}: WelcomeOverviewCardProps) {
  return (
    <article className="digital-display-welcome-card" aria-label="展会概览">
      <div className="digital-display-welcome-card-heading">
        <span>展会概览</span>
        <span>{welcomePhaseLabel(phase)}</span>
      </div>
      <h2>{DEFAULT_WELCOME_OVERVIEW.title}</h2>
      <p>{DEFAULT_WELCOME_OVERVIEW.summary}</p>
      <div className="digital-display-welcome-highlights">
        {DEFAULT_WELCOME_OVERVIEW.suggestions.map((suggestion) => (
          <span key={suggestion}>{suggestion}</span>
        ))}
      </div>
      <div className="digital-display-welcome-card-footer">
        <span>{phaseHint(phase)}</span>
        {onReplay ? (
          <button type="button" onClick={onReplay} disabled={replayDisabled}>
            再播概览
          </button>
        ) : null}
      </div>
      {onOpenMultimodalPreview ? (
        <button type="button" className="digital-display-welcome-multimodal-button" onClick={onOpenMultimodalPreview}>
          浏览展会内容
        </button>
      ) : null}
    </article>
  );
}
