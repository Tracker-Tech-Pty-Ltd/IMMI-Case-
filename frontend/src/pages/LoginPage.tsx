import { useCallback, useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { TelegramLoginButton } from "@/components/auth/TelegramLoginButton";
import { useAuth } from "@/contexts/AuthContext";
import { PageLoader } from "@/components/shared/PageLoader";

const BOT_NAME = import.meta.env.VITE_TELEGRAM_BOT_NAME || "immi_case_bot";

export function LoginPage() {
  const { isAuthenticated, isLoading } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [loginError, setLoginError] = useState<string | null>(null);

  useEffect(() => {
    if (isAuthenticated && !isLoading) {
      navigate("/", { replace: true });
    }
  }, [isAuthenticated, isLoading, navigate]);

  const handleSuccess = useCallback(() => navigate("/", { replace: true }), [navigate]);
  const handleError = useCallback((err: Error) => setLoginError(err.message), []);
  const authError = searchParams.get("auth_error");
  const visibleError = loginError || (authError ? "Telegram sign-in failed. Please try again." : null);

  if (isLoading) return <PageLoader />;

  return (
    <main className="min-h-screen flex items-center justify-center bg-background">
      <div className="max-w-md w-full p-8 rounded-xl shadow-lg bg-card border border-border">
        <h1 className="text-2xl font-bold text-foreground mb-2 font-serif">
          IMMI Case
        </h1>
        <p className="text-muted-text mb-8 text-sm">
          Australian immigration tribunal case research platform. Sign in with
          Telegram to save searches and collections.
        </p>
        {visibleError && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
            {visibleError}
          </div>
        )}
        <div className="flex justify-center">
          <TelegramLoginButton
            botName={BOT_NAME}
            onSuccess={handleSuccess}
            onError={handleError}
          />
        </div>
        <p className="mt-6 text-xs text-muted-text text-center">
          All 149,016 cases are publicly accessible without login. Login is only
          required to save searches and collections.
        </p>
      </div>
    </main>
  );
}
