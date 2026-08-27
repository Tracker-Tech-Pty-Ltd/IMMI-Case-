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
          manualChunks: (id) => {
            // Tiny shared utilities (clsx / tailwind-merge / class-variance-authority)
            // are imported by nearly every component AND by recharts. Left
            // unassigned, Rollup folds them into the "charts" chunk, which forces
            // the entry chunk to statically import charts-*.js — 413 kB raw /
            // 120 kB gzip of Recharts + d3 downloaded, parsed and top-level
            // evaluated on every route, including chart-free ones. Pinning them
            // to the always-eager "vendor" chunk makes that edge impossible.
            if (id.includes("node_modules/clsx") || id.includes("node_modules/tailwind-merge") || id.includes("node_modules/class-variance-authority")) return "vendor";
            if (id.includes("node_modules/recharts") || id.includes("node_modules/victory-vendor") || id.includes("node_modules/d3-")) return "charts";
            if (id.includes("node_modules/i18next") || id.includes("node_modules/react-i18next")) return "i18n";
            if (id.includes("node_modules/@dnd-kit")) return "dnd";
            if (id.includes("node_modules/@tanstack/react-query")) return "query";
            if (id.includes("node_modules/react-dom") || id.includes("node_modules/react/") || id.includes("node_modules/react-router")) return "vendor";
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
