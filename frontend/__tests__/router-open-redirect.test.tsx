// Regression coverage for external navigation guards in react-router 7.18.4.
// Upstream 7.18.3 added validation that rejects protocol-relative and
// backslash-prefixed cross-origin navigation instead of normalizing it into a
// same-origin path. Keep that stricter protection and assert both the explicit
// rejection and the unchanged router location. Ordinary internal links must
// still work, and suspicious Link clicks must not navigate the SPA.
// Official change: https://reactrouter.com/7.18.4/changelog#v7183
// Installed implementation: validateNavigationTarget(..., "reject").
// These continue to cover the boundary documented by GHSA-wrjc-x8rr-h8h6
// and GHSA-2j2x-hqr9-3h42; they do not enable external navigation.
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  Link,
  MemoryRouter,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from "react-router-dom";
import { useEffect } from "react";

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="pathname">{location.pathname}</div>;
}

function NavigateOnMount({ to, onError }: { to: string; onError: (error: unknown) => void }) {
  const navigate = useNavigate();
  useEffect(() => {
    try {
      navigate(to);
    } catch (error) {
      onError(error);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once on mount, `to` is fixed per test
  }, []);
  return <LocationProbe />;
}

describe("router open-redirect regression (react-router GHSA-wrjc-x8rr-h8h6, GHSA-2j2x-hqr9-3h42)", () => {
  it("useNavigate rejects a protocol-relative // path and stays on the current route", () => {
    const onError = vi.fn();
    render(
      <MemoryRouter initialEntries={["/start"]}>
        <Routes>
          <Route path="*" element={<NavigateOnMount to="//evil.example.com" onError={onError} />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByTestId("pathname").textContent).toBe(
      "/start",
    );
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining("External navigation is not allowed") }));
  });

  it("useNavigate rejects a backslash path and stays on the current route", () => {
    const onError = vi.fn();
    render(
      <MemoryRouter initialEntries={["/start"]}>
        <Routes>
          <Route
            path="*"
            element={<NavigateOnMount to={"\\\\evil.example.com"} onError={onError} />}
          />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByTestId("pathname").textContent).toBe(
      "/start",
    );
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining("External navigation is not allowed") }));
  });

  it("clicking a <Link> to a protocol-relative // path does not navigate the SPA", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={["/start"]}>
        <Routes>
          <Route
            path="*"
            element={
              <>
                <Link to="//evil.example.com">Suspicious link</Link>
                <LocationProbe />
              </>
            }
          />
        </Routes>
      </MemoryRouter>,
    );

    await user.click(screen.getByRole("link", { name: "Suspicious link" }));

    expect(screen.getByTestId("pathname").textContent).toBe("/start");
  });

  it("clicking a <Link> to a backslash path does not navigate the SPA", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={["/start"]}>
        <Routes>
          <Route
            path="*"
            element={
              <>
                <Link to={"\\\\evil.example.com"}>Suspicious link</Link>
                <LocationProbe />
              </>
            }
          />
        </Routes>
      </MemoryRouter>,
    );

    await user.click(screen.getByRole("link", { name: "Suspicious link" }));

    expect(screen.getByTestId("pathname").textContent).toBe("/start");
  });

  it("sanity: clicking an ordinary <Link> does navigate the SPA", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={["/start"]}>
        <Routes>
          <Route
            path="*"
            element={
              <>
                <Link to="/somewhere-else">Ordinary link</Link>
                <LocationProbe />
              </>
            }
          />
        </Routes>
      </MemoryRouter>,
    );

    await user.click(screen.getByRole("link", { name: "Ordinary link" }));

    expect(screen.getByTestId("pathname").textContent).toBe(
      "/somewhere-else",
    );
  });
});
