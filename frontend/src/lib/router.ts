const LEGACY_APP_PREFIX = "/app";

export function resolveRouterBasename(pathname: string): "/" | "/app" {
  if (
    pathname === LEGACY_APP_PREFIX ||
    pathname.startsWith(`${LEGACY_APP_PREFIX}/`)
  ) {
    return LEGACY_APP_PREFIX;
  }

  return "/";
}
