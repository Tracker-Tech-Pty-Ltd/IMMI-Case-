/**
 * frontend/src/components/shared/RouteErrorBoundary.tsx
 *
 * Two exports:
 *   ErrorBoundary  — the class boundary. `scope="app"` is the last-resort
 *                    full-screen version at the root of App; `scope="route"`
 *                    is the per-route version that sits INSIDE AppLayout's
 *                    <Outlet>, so a crashed page leaves the nav usable.
 *   RouteBoundary  — <ErrorBoundary scope="route"> + <Suspense> in one
 *                    wrapper, keyed on the pathname so navigating away clears
 *                    a previous crash.
 *
 * Raw stacks are gated behind import.meta.env.DEV — the production user of
 * this app is a self-representing immigration applicant, not a developer.
 */
import { Component, Suspense, type ErrorInfo, type ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { AlertTriangle } from "lucide-react";
import { StatePanel } from "@/components/shared/StatePanel";
import { PageLoader } from "@/components/shared/PageLoader";

interface ErrorBoundaryProps {
  children: ReactNode;
  scope?: "app" | "route";
  /** When this value changes and an error is showing, the boundary resets. */
  resetKey?: string;
}

interface ErrorBoundaryState {
  error: Error | null;
}

export class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(
      `[ErrorBoundary:${this.props.scope ?? "app"}]`,
      error,
      info.componentStack,
    );
  }

  componentDidUpdate(prevProps: ErrorBoundaryProps) {
    if (this.state.error && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ error: null });
    }
  }

  handleRetry = () => {
    this.setState({ error: null });
  };

  handleReload = () => {
    window.location.reload();
  };

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    const isApp = (this.props.scope ?? "app") === "app";

    return (
      <div
        role="alert"
        data-testid={isApp ? "app-error-boundary" : "route-error-boundary"}
        className={
          isApp
            ? "flex min-h-screen items-center justify-center bg-background px-6 py-10"
            : "px-1 py-6"
        }
      >
        <StatePanel
          tone="error"
          align="start"
          icon={<AlertTriangle className="h-5 w-5" />}
          title="Something went wrong on this screen"
          description="The page could not be displayed. You can try again, or reload the app if the problem persists."
          className="max-w-3xl"
          action={
            <>
              <button
                type="button"
                data-testid="error-boundary-retry"
                onClick={this.handleRetry}
                className="inline-flex items-center gap-1.5 rounded-md border border-danger/25 bg-background-card px-3 py-1.5 text-xs font-medium text-danger transition-colors hover:bg-danger/10"
              >
                Try again
              </button>
              <button
                type="button"
                data-testid="error-boundary-reload"
                onClick={this.handleReload}
                className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-surface"
              >
                Reload page
              </button>
            </>
          }
        >
          {import.meta.env.DEV ? (
            <pre
              data-testid="error-boundary-stack"
              className="overflow-x-auto rounded-xl border border-danger/15 bg-background px-4 py-3 font-mono text-xs leading-6 text-danger"
            >
              {error.message}
              {"\n\n"}
              {error.stack}
            </pre>
          ) : null}
        </StatePanel>
      </div>
    );
  }
}

export function RouteBoundary({ children }: { children: ReactNode }) {
  const location = useLocation();
  return (
    <ErrorBoundary scope="route" resetKey={location.pathname}>
      <Suspense fallback={<PageLoader />}>{children}</Suspense>
    </ErrorBoundary>
  );
}
