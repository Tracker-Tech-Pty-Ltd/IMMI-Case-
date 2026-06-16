import type { Env } from "./types";

export async function sendPipelineAlert(
  env: Env,
  title: string,
  payload: Record<string, unknown>,
): Promise<void> {
  if (!env.ALERT_DISCORD_WEBHOOK_URL) return;

  const content = [
    `IMMI pipeline alert: ${title}`,
    "```json",
    JSON.stringify(payload, null, 2).slice(0, 1800),
    "```",
  ].join("\n");

  await fetch(env.ALERT_DISCORD_WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "IMMI-Cron", content }),
  }).catch((err) => {
    console.warn(JSON.stringify({
      event: "alert.discord.failed",
      error: err instanceof Error ? err.message : String(err),
    }));
  });
}
