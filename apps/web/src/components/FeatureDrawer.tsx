import { useEffect, useId, useRef, type ReactNode } from "react";

type FeatureDrawerProps = {
  eyebrow: string;
  title: string;
  description?: string;
  onClose: () => void;
  children: ReactNode;
};

export function FeatureDrawer({
  eyebrow,
  title,
  description,
  onClose,
  children,
}: FeatureDrawerProps) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const titleId = `digital-human-feature-drawer-${useId().replace(/:/g, "")}`;

  useEffect(() => {
    closeButtonRef.current?.focus();
  }, []);

  return (
    <>
      <button
        type="button"
        className="digital-display-feature-drawer-backdrop"
        aria-label="关闭功能抽屉"
        onClick={onClose}
      />
      <aside
        className="digital-display-feature-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <header className="digital-display-feature-drawer-header">
          <div>
            <small>{eyebrow}</small>
            <h2 id={titleId}>{title}</h2>
            {description ? <p>{description}</p> : null}
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            className="digital-display-feature-drawer-close"
            aria-label="关闭功能抽屉"
            onClick={onClose}
          >
            关闭
          </button>
        </header>
        <div className="digital-display-feature-drawer-body">{children}</div>
      </aside>
    </>
  );
}
