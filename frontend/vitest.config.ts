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
      // never gated anything.
      //
      // A RATCHET, AND WHY THE NUMBERS ARE NOT HAND-MAINTAINED ANY MORE
      //
      // Hand-written floors go stale in one direction only: coverage rises,
      // nobody edits the config, and the gap becomes free headroom for a
      // regression. That is exactly what happened here — the previous comment
      // recorded 28.92/30.74/24.25/29.78 as "measured", while the suite had
      // since climbed to 40.23/38.82/32.50/41.17. The floors were 12 points
      // below reality, so a PR could have deleted a third of the frontend tests
      // and still gone green.
      //
      // `autoUpdate` closes that gap permanently: whenever a local run measures
      // higher than the stored floor, Vitest rewrites the numbers below, and the
      // raise is committed with the work that earned it. The formatter rounds
      // DOWN to one decimal, which is the only slack in the system (<= 0.1pp) —
      // enough to absorb noise, far too little to hide a regression.
      //
      // Lowering these is still possible in a text editor, which is why
      // scripts/check_coverage_ratchet.mjs runs in CI and fails any commit that
      // reduces a floor. Together: coverage cannot fall, and the floor cannot be
      // quietly moved to let it.
      //
      // Measured 2026-08-28: statements 40.23, branches 38.82, functions 32.50,
      // lines 41.17.
      thresholds: {
        autoUpdate: (measured: number) => Math.floor(measured * 10) / 10,
        lines: 41.1,
        functions: 32.5,
        branches: 38.8,
        statements: 40.2,
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
