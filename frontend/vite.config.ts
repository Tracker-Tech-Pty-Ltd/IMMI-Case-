import path from "path";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

function resolveApiProxyTarget(mode: string): string {
  const sharedEnv = loadEnv(mode, path.resolve(process.cwd(), ".."), "");
  const localEnv = loadEnv(mode, process.cwd(), "");
  const env = { ...sharedEnv, ...localEnv, ...process.env };
  const backendHost =
    env.BACKEND_HOST || env.VITE_BACKEND_HOST || "127.0.0.1";
  const backendPort = env.BACKEND_PORT || env.VITE_BACKEND_PORT || "8080";

  // Highest priority override for non-standard environments.
  if (env.VITE_API_PROXY_TARGET) {
    return env.VITE_API_PROXY_TARGET;
  }

  return `http://${backendHost}:${backendPort}`;
}

export default defineConfig(({ mode }) => {
  const apiProxyTarget = resolveApiProxyTarget(mode);

  return {
    base: "/",
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
    build: {
      outDir: "../immi_case_downloader/static/react",
      emptyOutDir: true,
      rollupOptions: {
        output: {
          manualChunks: {
            vendor: ["react", "react-dom", "react-router-dom"],
            query: ["@tanstack/react-query"],
            charts: ["recharts"],
          },
        },
      },
    },
    server: {
      proxy: {
        "/api": apiProxyTarget,
      },
    },
  };
});
