/** Omit shared host cookies only while the local Council demo is active. */
export function demoRequestCredentials(): { credentials?: RequestCredentials } {
  return import.meta.env.DEV && import.meta.env.VITE_COUNCIL_DEMO === "true"
    ? { credentials: "omit" }
    : {};
}
