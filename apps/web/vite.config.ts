import fs from "node:fs";
import type { ServerOptions as HttpsServerOptions } from "node:https";
import path from "node:path";
import { fileURLToPath, URL } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
const allowedHosts = ["ai.oaii.cn", ".pod.compshare.cn"];

function readTlsFile(filePath: string, variableName: string): Buffer {
  const resolvedPath = path.resolve(process.cwd(), filePath);
  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`${variableName} points to a missing file: ${resolvedPath}`);
  }
  return fs.readFileSync(resolvedPath);
}

function createHttpsOptions(env: Record<string, string>): HttpsServerOptions {
  const keyPath = env.HTTPS_KEY_PATH || "./ssl/ai.oaii.cn.key";
  const certPath = env.HTTPS_CERT_PATH || "./ssl/ai.oaii.cn_bundle.pem";
  const caPath = env.HTTPS_CA_PATH;

  return {
    key: readTlsFile(keyPath, "HTTPS_KEY_PATH"),
    cert: readTlsFile(certPath, "HTTPS_CERT_PATH"),
    ...(caPath ? { ca: readTlsFile(caPath, "HTTPS_CA_PATH") } : {}),
  };
}

export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const isProduction = mode === "production";
  const https = isProduction && command === "serve" ? createHttpsOptions(env) : undefined;
  const backendPort = env.VITE_BACKEND_PORT || "8000";
  const backendUrl = env.VITE_BACKEND_URL || `http://127.0.0.1:${backendPort}`;
  const apiProxy = {
    target: backendUrl,
    changeOrigin: true,
    ws: true,
    // Admin and public survey APIs already include /api/v1. Legacy runtime
    // endpoints still rely on stripping the leading /api proxy namespace.
    rewrite: (requestPath: string) =>
      requestPath.startsWith("/api/v1") ? requestPath : requestPath.replace(/^\/api/, ""),
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

  return {
    base: "./",
    plugins: [react()],
    server: {
      port: 5173,
      https,
      allowedHosts,
      fs: {
        allow: [repoRoot],
      },
      proxy: {
        "/api": apiProxy,
      },
    },
    preview: {
      port: 5173,
      https,
      allowedHosts,
      proxy: {
        "/api": apiProxy,
      },
    },
  };
});
