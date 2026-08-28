import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./__tests__/legislations-setup.ts"],
    // Two roots on purpose: the historical suite under frontend/__tests__/ and
    // tests colocated next to the module they cover (src/**/__tests__/). Before
    // the second glob existed, src/lib/__tests__/saved-searches.test.ts was in
    // the tree but collected by nothing. `make check-vitest-collection` now
    // fails if any test file on disk is missed again.
    include: [
      "__tests__/**/*.{test,spec}.{ts,tsx}",
      "src/**/*.{test,spec}.{ts,tsx}",
    ],
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
      // raise them, never lower them. Re-measured 2026-08-28 on
      // advisor/002-fix-test-collection-and-install after widening `include`
      // above to also collect src/**/__tests__/**: statements 28.92,
      // branches 30.74, functions 24.25, lines 29.78 (plan 001's numbers —
      // statements 27.55, branches 29.09, functions 23.53, lines 28.39 —
      // are the floor these must never go back below).
      thresholds: {
        lines: 29,
        functions: 24,
        branches: 30,
        statements: 28,
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
