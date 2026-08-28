import { useEffect, useMemo, useRef } from "react";

interface TelegramLoginButtonProps {
  botName: string;
  size?: "large" | "medium" | "small";
}

declare global {
  interface Window {
    onTelegramAuthCallback?: (user: Record<string, string>) => void;
  }
}

// NOTE: no success/failure callback props here. The widget below uses
// `data-auth-url` (full-page redirect to /api/v1/auth/telegram/callback), so
// Telegram never invokes a JS callback. Failures come back as the
// ?auth_error query param, which LoginPage reads. If a popup-mode variant is
// ever added, callback props can come back with it.
export function TelegramLoginButton({
  botName,
  size = "large",
}: TelegramLoginButtonProps) {
  const ref = useRef<HTMLDivElement>(null);

  const authUrl = useMemo(() => {
    if (typeof window === "undefined") return "/api/v1/auth/telegram/callback";
    const next = window.location.pathname.startsWith("/app") ? "/app/" : "/";
    const url = new URL("/api/v1/auth/telegram/callback", window.location.origin);
    url.searchParams.set("next", next);
    return url.toString();
  }, []);

  useEffect(() => {
    const host = ref.current;
    if (!host) return;
    // StrictMode guard: avoid double-mounting the script
    if (host.childElementCount > 0) return;

    const script = document.createElement("script");
    script.src = "https://telegram.org/js/telegram-widget.js?22";
    script.setAttribute("data-telegram-login", botName);
    script.setAttribute("data-size", size);
    script.setAttribute("data-auth-url", authUrl);
    script.setAttribute("data-request-access", "write");
    script.async = true;

    host.appendChild(script);

    return () => {
      host
        .querySelector("script[src^='https://telegram.org/js/telegram-widget.js']")
        ?.remove();
    };
  }, [authUrl, botName, size]);

  return <div ref={ref} />;
}
