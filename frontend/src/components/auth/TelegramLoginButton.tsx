import { useEffect, useMemo, useRef } from "react";

interface TelegramLoginButtonProps {
  botName: string;
  onSuccess?: () => void;
  onError?: (err: Error) => void;
  size?: "large" | "medium" | "small";
}

declare global {
  interface Window {
    onTelegramAuthCallback?: (user: Record<string, string>) => void;
  }
}

export function TelegramLoginButton({
  botName,
  onSuccess,
  onError,
  size = "large",
}: TelegramLoginButtonProps) {
  const ref = useRef<HTMLDivElement>(null);
  void onSuccess;
  void onError;

  const authUrl = useMemo(() => {
    if (typeof window === "undefined") return "/api/v1/auth/telegram/callback";
    const next = window.location.pathname.startsWith("/app") ? "/app/" : "/";
    const url = new URL("/api/v1/auth/telegram/callback", window.location.origin);
    url.searchParams.set("next", next);
    return url.toString();
  }, []);

  useEffect(() => {
    if (!ref.current) return;
    // StrictMode guard: avoid double-mounting the script
    if (ref.current.childElementCount > 0) return;

    const script = document.createElement("script");
    script.src = "https://telegram.org/js/telegram-widget.js?22";
    script.setAttribute("data-telegram-login", botName);
    script.setAttribute("data-size", size);
    script.setAttribute("data-auth-url", authUrl);
    script.setAttribute("data-request-access", "write");
    script.async = true;

    ref.current.appendChild(script);

    return () => {
      ref.current?.querySelector("script[src^='https://telegram.org/js/telegram-widget.js']")?.remove();
    };
  }, [authUrl, botName, size]);

  return <div ref={ref} />;
}
