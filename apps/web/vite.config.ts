import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";

const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
const allowedHosts = [".pod.compshare.cn"];

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const backendPort = env.VITE_BACKEND_PORT ?? "8000";
  const backendUrl = env.VITE_BACKEND_URL ?? `http://127.0.0.1:${backendPort}`;
  const businessBackendUrl = env.VITE_BUSINESS_BACKEND_URL ?? "http://127.0.0.1:18302";
  const knowledgeBackendUrl = env.VITE_KNOWLEDGE_BACKEND_URL ?? "http://127.0.0.1:18303";

  const createApiProxy = (prefix: string, target: string, configureEvents = false) => ({
    changeOrigin: true,
    ws: true,
    rewrite: (p: string) => p.startsWith(prefix) ? p.slice(prefix.length) || "/" : p,
    ...(configureEvents ? {
      configure(proxy: { on: (event: string, listener: (proxyRes: any, req: any) => void) => void }) {
        proxy.on("proxyRes", (proxyRes, req) => {
          const url = req.url ?? "";
          if (url.includes("/events")) {
            delete proxyRes.headers["content-length"];
            proxyRes.headers["cache-control"] = "no-cache, no-transform";
            proxyRes.headers["x-accel-buffering"] = "no";
          }
        });
      },
    } : {}),
    target,
  });

  const apiProxy = createApiProxy("/api", backendUrl, true);
  const businessApiProxy = createApiProxy("/business-api", businessBackendUrl);
  const knowledgeApiProxy = createApiProxy("/knowledge-api", knowledgeBackendUrl);

  return {
    base: "./",
    plugins: [react()],
    server: {
      port: 5173,
      allowedHosts,
      fs: {
        allow: [repoRoot],
      },
      proxy: {
        "/api": apiProxy,
        "/business-api": businessApiProxy,
        "/knowledge-api": knowledgeApiProxy,
      },
    },
    preview: {
      port: 5173,
      allowedHosts,
      proxy: {
        "/api": apiProxy,
        "/business-api": businessApiProxy,
        "/knowledge-api": knowledgeApiProxy,
      },
    },
  };
});
