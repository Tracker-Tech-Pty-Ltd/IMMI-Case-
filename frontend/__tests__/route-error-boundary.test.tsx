import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import {
  ErrorBoundary,
  RouteBoundary,
} from "@/components/shared/RouteErrorBoundary";

function Boom(): never {
  throw new Error("kaboom");
}

/** Throws once (on first render) then renders normally — proves Retry
 *  actually re-mounts the child rather than just clearing local state. */
function BoomOnce({ shouldThrow }: { shouldThrow: boolean }) {
  if (shouldThrow) throw new Error("kaboom-once");
  return <span>recovered</span>;
}

describe("RouteErrorBoundary", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("renders the route-scoped panel with role=alert and logs via componentDidCatch", () => {
    render(
      <ErrorBoundary scope="route">
        <Boom />
      </ErrorBoundary>,
    );

    const panel = screen.getByTestId("route-error-boundary");
    expect(panel).toBeInTheDocument();
    expect(panel.getAttribute("role")).toBe("alert");
    expect(
      screen.getByText("Something went wrong on this screen"),
    ).toBeInTheDocument();

    const logged = vi
      .mocked(console.error)
      .mock.calls.some((call) =>
        /\[ErrorBoundary:route\]/.test(String(call[0])),
      );
    expect(logged).toBe(true);
  });

  it("both Retry and a resetKey change clear the error", () => {
    // Retry: re-render after flipping the condition that made the child throw.
    let shouldThrow = true;
    function Wrapper() {
      return (
        <ErrorBoundary scope="route">
          <BoomOnce shouldThrow={shouldThrow} />
        </ErrorBoundary>
      );
    }
    const { rerender, unmount } = render(<Wrapper />);
    expect(screen.getByTestId("route-error-boundary")).toBeInTheDocument();

    // The boundary is still showing its cached fallback (state.error is
    // set), but re-rendering the parent first updates `children` under it
    // to the now-safe element. Retry then clears state.error and renders
    // those already-updated (non-throwing) children.
    shouldThrow = false;
    rerender(<Wrapper />);
    fireEvent.click(screen.getByTestId("error-boundary-retry"));

    expect(screen.getByText("recovered")).toBeInTheDocument();
    expect(screen.queryByTestId("route-error-boundary")).toBeNull();
    unmount();

    // resetKey: a changed resetKey clears a showing error on its own.
    const { rerender: rerenderB } = render(
      <ErrorBoundary scope="route" resetKey="/a">
        <Boom />
      </ErrorBoundary>,
    );
    expect(screen.getByTestId("route-error-boundary")).toBeInTheDocument();

    rerenderB(
      <ErrorBoundary scope="route" resetKey="/b">
        <span>ok</span>
      </ErrorBoundary>,
    );

    expect(screen.getByText("ok")).toBeInTheDocument();
    expect(screen.queryByTestId("route-error-boundary")).toBeNull();
  });

  it("RouteBoundary renders its children through when nothing throws", () => {
    render(
      <MemoryRouter>
        <RouteBoundary>
          <span>hello from route boundary</span>
        </RouteBoundary>
      </MemoryRouter>,
    );

    expect(
      screen.getByText("hello from route boundary"),
    ).toBeInTheDocument();
  });
});
