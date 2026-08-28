// Regression coverage for two react-router advisories fixed by the 7.13.0 ->
// 7.18.2 bump in plan 035 (frontend dependency advisories):
//
//   - GHSA-wrjc-x8rr-h8h6 "Open redirect via backslash in <Link> and
//     useNavigate" (fixed >= 7.18.0)
//   - GHSA-2j2x-hqr9-3h42 "same-origin redirect with path starting //
//     reinterpreted as protocol-relative URL" (fixed >= 7.14.1)
//
// Both advisories describe react-router treating a `//host` or `\\host`
// "to" value as if it were a same-origin path, when a browser interprets a
// leading `//` as protocol-relative (i.e. an actual cross-origin redirect).
// This SPA (frontend/src/App.tsx) mounts a plain client-side
// <BrowserRouter>, so the reachable attack surface is exactly what these
// tests exercise: a value that ends up in `useNavigate()` or `<Link to>`
// from application state (e.g. a `redirect` query param, a saved-search
// deep link, a bookmark import) must never cause the app to leave the
// current origin.
//
// Verified empirically against the installed react-router-dom (7.18.2)
// before writing these assertions, because guessing exact resolved values
// is not enough to catch a regression:
//   - useNavigate("//evil.example.com") resolves to the SAME-ORIGIN,
//     single-slash path "/evil.example.com" -- the doubled leading slash
//     that a browser would read as protocol-relative is collapsed away.
//   - useNavigate("\\evil.example.com") (an actual single-backslash-prefixed
//     value; written here as the JS string literal "\\\\evil.example.com")
//     resolves the same way, to "/evil.example.com".
//   - Clicking a <Link to="//evil.example.com"> (or the backslash
//     equivalent) does NOT perform an in-app navigation at all: the click
//     handler declines to treat it as a same-app route and the SPA's
//     location is left unchanged. (The rendered `href` DOM attribute is
//     NOT rewritten -- react-router still needs the literal `to` value
//     there for native browser fallback semantics such as opening in a
//     new tab -- so this suite intentionally does not assert on
//     `getAttribute("href")`; the click-through behaviour below is what
//     actually protects a client-only SPA like this one.)
//
// Every assertion below is an exact-value match, not a loose
// `not.toContain("//")`: a regression that resolves these paths to some
// OTHER value (including a different-but-still-wrong one) must fail this
// suite, and so must a regression that changes the correct value in either
// direction.

import { describe, it, expect } from "vitest";
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

function NavigateOnMount({ to }: { to: string }) {
  const navigate = useNavigate();
  useEffect(() => {
    navigate(to);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once on mount, `to` is fixed per test
  }, []);
  return <LocationProbe />;
}

describe("router open-redirect regression (react-router GHSA-wrjc-x8rr-h8h6, GHSA-2j2x-hqr9-3h42)", () => {
  it("useNavigate to a protocol-relative // path resolves same-origin", () => {
    render(
      <MemoryRouter initialEntries={["/start"]}>
        <Routes>
          <Route path="*" element={<NavigateOnMount to="//evil.example.com" />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByTestId("pathname").textContent).toBe(
      "/evil.example.com",
    );
  });

  it("useNavigate to a backslash path resolves same-origin", () => {
    render(
      <MemoryRouter initialEntries={["/start"]}>
        <Routes>
          <Route
            path="*"
            element={<NavigateOnMount to={"\\\\evil.example.com"} />}
          />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByTestId("pathname").textContent).toBe(
      "/evil.example.com",
    );
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
