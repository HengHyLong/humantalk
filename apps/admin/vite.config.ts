import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";
import fs from "fs";

const backendPort = process.env.VITE_BACKEND_PORT ?? "8000";
const backendUrl = process.env.VITE_BACKEND_URL ?? `http://127.0.0.1:${backendPort}`;
const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
const allowedHosts = [".pod.compshare.cn"];
const apiProxy = {
  target: backendUrl,
  changeOrigin: true,
  ws: true,
  // The admin API already lives under /api/v1, while the legacy runtime
  // endpoints keep their original root-level paths (/models, /voices, ...).
  // Keep the former intact and strip only the frontend compatibility prefix
  // from the latter.
  rewrite: (path: string) => (path.startsWith("/api/v1") ? path : path.replace(/^\/api/, "")),
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

export default defineConfig({
  // Admin uses browser history routing and is served from the site root.
  // Root-relative assets must remain valid after refreshing a nested route.
  base: "/",
  plugins: [react()],
  server: {
    port: 5173,
    
//      https:{
//        key:fs.readFileSync("./ssl/ai.oaii.cn.key"),
//        cert:fs.readFileSync("./ssl/ai.oaii.cn_bundle.pem")
//      },
      
      // 允许通过该域名访问 Vite 开发服务器
      allowedHosts: ["ai.oaii.cn"],

    fs: {
      allow: [repoRoot],
    },
    proxy: {
      "/api": apiProxy,
    },
  },
  preview: {
    port: 5173,
    allowedHosts,
    proxy: {
      "/api": apiProxy,
    },
  },
});
