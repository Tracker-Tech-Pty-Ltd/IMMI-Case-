import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./__tests__/legislations-setup.ts"],
    include: ["__tests__/**/*.{test,spec}.{ts,tsx}"],
    exclude: ["e2e/**", "node_modules/**"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "json-summary", "html"],
      // Explicit universe. Without `include`, Vitest 4 reports only files that
      // some test imported, so untested modules silently vanish from the
      // denominator and the thresholds below would measure nothing.
      include: ["src/**/*.{ts,tsx}"],
      exclude: [
        "**/__tests__/**",
        "**/*.test.{ts,tsx}",
        "**/*.spec.{ts,tsx}",
        "**/*.d.ts",
        "**/*.config.*",
        "src/tokens/tokens.ts",
      ],
      // Vitest 4 only reads thresholds nested under `thresholds`. The four
      // flat `80`s that used to live here were not recognised options and
      // never gated anything. These numbers are a RATCHET pinned to the
      // coverage measured on the universe defined by `include` above —
      // raise them, never lower them. Measured 2026-08-28 on main
      // (166 src files, 59 test files / 513 tests): statements 27.55,
      // branches 29.09, functions 23.53, lines 28.39.
      thresholds: {
        lines: 28,
        functions: 23,
        branches: 29,
        statements: 27,
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
