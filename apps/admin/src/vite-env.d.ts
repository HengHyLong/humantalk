/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE?: string;
  readonly VITE_BACKEND_URL?: string;
  readonly VITE_ASSET_BACKEND_URL?: string;
  readonly VITE_ADMIN_API_MODE?: "real" | "mock";
  /** Optional separate asset-backend token; normally populated after dual login. */
  readonly VITE_ADMIN_ASSET_TOKEN?: string;
  /** Max chat bubbles to show (most recent). 0 or unset = show all. */
  readonly VITE_CHAT_MAX_VISIBLE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
