import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";

const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
const allowedHosts = [".pod.compshare.cn"];

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const backendPort = env.VITE_BACKEND_PORT || "8000";
  const backendUrl = env.VITE_BACKEND_URL || `http://127.0.0.1:${backendPort}`;
  const assetBackendUrl = env.VITE_ASSET_BACKEND_URL || backendUrl;
  const apiProxy = {
    target: backendUrl,
    changeOrigin: true,
    ws: true,
    rewrite: (p: string) => p.startsWith("/api/v1/") ? p : p.replace(/^\/api/, ""),
    // SSE (EventSource) through proxy: avoid buffering / stale Content-Length
    configure(proxy) {
      proxy.on("proxyRes", (proxyRes, req) => {
        const url = req.url ?? "";
        if (url.includes("/events")) {
          delete proxyRes.headers["content-length"];
          proxyRes.headers["cache-control"] = "no-cache, no-transform";
          proxyRes.headers["x-accel-buffering"] = "no";
        }
      });
    },
  };
  const assetApiProxy = {
    ...apiProxy,
    target: assetBackendUrl,
    rewrite: (p: string) => p.replace(/^\/api-assets/, "/api"),
  };
  return {
    base: "./",
    plugins: [react()],
    server: {
      port: 5173,
      allowedHosts,
      fs: { allow: [repoRoot] },
      proxy: { "/api-assets": assetApiProxy, "/api": apiProxy },
    },
    preview: {
      port: 5173,
      allowedHosts,
      proxy: { "/api-assets": assetApiProxy, "/api": apiProxy },
    },
  };
});
