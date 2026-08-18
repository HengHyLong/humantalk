import { useEffect, useRef } from "react";

export const WEB_DIALOG_AUTO_DISMISS_MS = 90_000;

/** Automatically close an open dialog after the configured lifetime. */
export function useAutoDismiss(
  open: boolean,
  onDismiss: () => void,
  timeoutMs = WEB_DIALOG_AUTO_DISMISS_MS,
): void {
  const onDismissRef = useRef(onDismiss);

  useEffect(() => {
    onDismissRef.current = onDismiss;
  }, [onDismiss]);

  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => onDismissRef.current(), timeoutMs);
    return () => window.clearTimeout(timer);
  }, [open, timeoutMs]);
}
