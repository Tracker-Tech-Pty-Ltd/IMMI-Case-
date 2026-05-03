import { useEffect, useRef, useCallback } from "react";
import { useAuth } from "@/contexts/AuthContext";

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
  const { login } = useAuth();

  const handleAuth = useCallback(
    async (user: Record<string, string>) => {
      try {
        await login(user);
        onSuccess?.();
      } catch (err) {
        onError?.(err instanceof Error ? err : new Error("Login failed"));
      }
    },
    [login, onSuccess, onError],
  );

  useEffect(() => {
    if (!ref.current) return;
    // StrictMode guard: avoid double-mounting the script
    if (ref.current.childElementCount > 0) return;

    window.onTelegramAuthCallback = handleAuth;

    const script = document.createElement("script");
    script.src = "https://telegram.org/js/telegram-widget.js?22";
    script.setAttribute("data-telegram-login", botName);
    script.setAttribute("data-size", size);
    script.setAttribute("data-onauth", "onTelegramAuthCallback(user)");
    script.setAttribute("data-request-access", "write");
    script.async = true;

    ref.current.appendChild(script);

    return () => {
      delete window.onTelegramAuthCallback;
    };
  }, [botName, size, handleAuth]);

  return <div ref={ref} />;
}
