import { useEffect, useMemo, useState, type CSSProperties } from "react";
import type { NavigationResult } from "../lib/api";
import {
  navigationProgress,
  normalizeNavigationPresentation,
  type NavigationStep,
} from "../lib/navigationPresentation";

type NavigationGuideCardProps = {
  navigationResult: NavigationResult;
  isSpeaking?: boolean;
  onSpeakStep?: (step: NavigationStep) => void;
};

export function NavigationGuideCard({
  navigationResult,
  isSpeaking = false,
  onSpeakStep,
}: NavigationGuideCardProps) {
  const presentation = useMemo(
    () => normalizeNavigationPresentation(navigationResult),
    [navigationResult],
  );
  const [activeStep, setActiveStep] = useState(0);
  const [imageFailed, setImageFailed] = useState(false);
  const routeKey = `${presentation.routeId ?? ""}:${presentation.title}:${presentation.steps.map((step) => step.id).join(",")}`;

  useEffect(() => {
    setActiveStep(0);
    setImageFailed(false);
  }, [routeKey]);

  const currentStep = presentation.steps[activeStep] ?? presentation.steps[0];
  const progress = navigationProgress(activeStep, presentation.steps.length);
  const markerPoints = presentation.markers
    .map((marker) => `${marker.x},${marker.y}`)
    .join(" ");

  const moveStep = (nextStep: number) => {
    setActiveStep(Math.max(0, Math.min(presentation.steps.length - 1, nextStep)));
  };

  return (
    <article className="digital-display-navigation-guide" aria-label="分步导航指引">
      <div className="digital-display-navigation-map" role="img" aria-label={`${presentation.title}地图高亮`}>
        {presentation.imageUrl && !imageFailed ? (
          <img
            src={presentation.imageUrl}
            alt={`${presentation.title}地图`}
            loading="lazy"
            onError={() => setImageFailed(true)}
          />
        ) : (
          <div className="digital-display-navigation-map-fallback">
            <span>地图示意</span>
            <strong>{presentation.to || "目的地"}</strong>
            <small>{presentation.imageUrl ? "地图暂时无法加载，仍可按文字路线前往" : "服务端尚未配置地图图片"}</small>
          </div>
        )}
        <div className="digital-display-navigation-map-shade" aria-hidden />
        {presentation.markers.length ? (
          <svg className="digital-display-navigation-route-line" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
            <polyline points={markerPoints} pathLength="100" />
          </svg>
        ) : (
          <div
            className="digital-display-navigation-generic-route"
            style={{ "--navigation-progress": `${progress}%` } as CSSProperties}
            aria-hidden
          />
        )}
        {presentation.markers.map((marker) => {
          const markerStep = marker.stepIndex ?? -1;
          const markerClass = markerStep === activeStep
            ? "is-active"
            : markerStep >= 0 && markerStep < activeStep
              ? "is-visited"
              : "";
          return (
            <span
              key={marker.id}
              className={`digital-display-navigation-marker ${markerClass}`}
              style={{ left: `${marker.x}%`, top: `${marker.y}%` }}
              title={marker.label}
              aria-hidden
            />
          );
        })}
        <span className="digital-display-navigation-map-badge">第 {activeStep + 1} 步 / 共 {presentation.steps.length} 步</span>
      </div>

      <div className="digital-display-navigation-content">
        <div className="digital-display-navigation-heading">
          <div>
            <strong>{presentation.title}</strong>
            <p>{presentation.summary}</p>
          </div>
          <span>{progress}%</span>
        </div>
        <p className="digital-display-navigation-route">
          {presentation.from}
          {presentation.to ? ` → ${presentation.to}` : ""}
          {presentation.estimatedMinutes != null ? ` · 约 ${presentation.estimatedMinutes} 分钟` : ""}
        </p>

        <div className="digital-display-navigation-progress" aria-hidden>
          <span style={{ width: `${progress}%` }} />
        </div>

        <ol className="digital-display-navigation-steps" aria-label="导航步骤">
          {presentation.steps.map((step, index) => (
            <li key={step.id} className={index === activeStep ? "is-active" : index < activeStep ? "is-visited" : ""}>
              <button type="button" onClick={() => moveStep(index)} aria-current={index === activeStep ? "step" : undefined}>
                <span>{index + 1}</span>
                <strong>{step.instruction}</strong>
              </button>
            </li>
          ))}
        </ol>

        <div className="digital-display-navigation-current" aria-live="polite">
          <span>当前指引</span>
          <p>{currentStep.instruction}</p>
        </div>
        <div className="digital-display-navigation-actions">
          <button type="button" onClick={() => moveStep(activeStep - 1)} disabled={activeStep === 0}>上一步</button>
          <button type="button" onClick={() => moveStep(activeStep + 1)} disabled={activeStep >= presentation.steps.length - 1}>下一步</button>
          {onSpeakStep ? (
            <button type="button" className="is-primary" onClick={() => onSpeakStep(currentStep)} disabled={isSpeaking}>
              {isSpeaking ? "正在播报" : "播报本步"}
            </button>
          ) : null}
        </div>
      </div>
    </article>
  );
}
