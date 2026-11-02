import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { createInstance } from "i18next";
import { I18nextProvider } from "react-i18next";
import zhTW from "@/i18n/locales/zh-TW.json";
import { StreamingCouncilView, type CouncilStreamState } from "@/components/llm-council/StreamingCouncilView";

vi.unmock("react-i18next");

describe("interrupted council stream localization", () => {
  it("displays the interruption in Traditional Chinese", async () => {
    const i18n = createInstance();
    await i18n.init({ lng: "zh-TW", resources: { "zh-TW": { translation: zhTW } }, interpolation: { escapeValue: false } });
    const expert = { text: "", status: "pending" as const };
    const state: CouncilStreamState = {
      openai: expert, gemini_pro: expert, anthropic: expert,
      moderator: { status: "pending" }, council: { status: "error", error: "council_stream_ended_early" },
      session: { sessionId: null, sessionToken: null, retrieveCode: null }, startedAt: Date.now(),
    };
    render(<I18nextProvider i18n={i18n}><StreamingCouncilView state={state} /></I18nextProvider>);
    expect(screen.getByTestId("council-stream-error")).toHaveTextContent("評議回應尚未完成便已中斷，請再次送出問題。");
  });
});
