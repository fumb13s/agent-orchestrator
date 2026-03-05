/**
 * Next.js middleware — authentication and CSRF protection for API routes.
 *
 * 1. Authentication: Checks Authorization: Bearer <token> header or token
 *    query parameter against the shared auth token. Returns 401 for
 *    unauthorized requests. Auth is disabled when no token is configured.
 *
 * 2. CSRF protection: For state-changing methods (POST, PUT, DELETE, PATCH):
 *    - If Origin header is present, validate it against the allowlist
 *    - If Origin header is absent, allow (non-browser clients like curl/CLI)
 *    - Reject requests with disallowed or "null" Origin
 *
 * GET/HEAD/OPTIONS are always allowed past CSRF check (read-only, no CSRF risk).
 *
 * NOTE: Origin validation logic is duplicated from server/origin-validation.ts
 * because Next.js middleware runs in the Edge Runtime and cannot import
 * Node.js server modules. Keep both in sync when updating the allowlist.
 *
 * NOTE: Reads token from AO_AUTH_TOKEN env var only (not from file).
 * The `ao start` command sets this env var when launching the dashboard.
 * This avoids importing node:fs/node:os which are not available in
 * Next.js Edge Runtime (where middleware runs).
 */

import { NextResponse, type NextRequest } from "next/server";

/** Default allowed origin prefixes (localhost with any port) */
const DEFAULT_ALLOWED_PREFIXES = [
  "http://localhost",
  "https://localhost",
  "http://127.0.0.1",
  "https://127.0.0.1",
  "http://[::1]",
  "https://[::1]",
];

function getConfiguredOrigins(): string[] {
  const envOrigins = process.env.AO_ALLOWED_ORIGINS;
  if (!envOrigins) return [];
  return envOrigins
    .split(",")
    .map((o) => o.trim())
    .filter((o) => o.length > 0);
}

function isAllowedOrigin(origin: string | null): boolean {
  if (!origin || origin === "null") {
    return false;
  }

  for (const prefix of DEFAULT_ALLOWED_PREFIXES) {
    if (origin === prefix || origin.startsWith(prefix + ":")) {
      return true;
    }
  }

  const configured = getConfiguredOrigins();
  for (const allowed of configured) {
    if (origin === allowed) {
      return true;
    }
  }

  return false;
}

function getToken(): string | null {
  const token = process.env["AO_AUTH_TOKEN"];
  return token && token.trim().length > 0 ? token.trim() : null;
}

const STATE_CHANGING_METHODS = new Set(["POST", "PUT", "DELETE", "PATCH"]);

export function middleware(request: NextRequest): NextResponse | undefined {
  // --- Authentication check ---
  const token = getToken();

  if (token) {
    let authenticated = false;

    // Check Authorization: Bearer <token> header
    const authHeader = request.headers.get("authorization");
    if (authHeader) {
      const parts = authHeader.split(" ");
      if (parts.length === 2 && parts[0].toLowerCase() === "bearer" && parts[1] === token) {
        authenticated = true;
      }
    }

    // Check token query parameter (for EventSource which can't set headers)
    if (!authenticated) {
      const url = new URL(request.url);
      const queryToken = url.searchParams.get("token");
      if (queryToken === token) {
        authenticated = true;
      }
    }

    if (!authenticated) {
      return NextResponse.json(
        { error: "Unauthorized: missing or invalid auth token" },
        { status: 401 },
      );
    }
  }

  // --- CSRF protection for state-changing methods ---
  if (STATE_CHANGING_METHODS.has(request.method)) {
    const origin = request.headers.get("origin");

    // No Origin header = non-browser client (curl, CLI, server-to-server) — allow
    if (origin !== null && !isAllowedOrigin(origin)) {
      return NextResponse.json(
        { error: "Forbidden: origin not allowed" },
        { status: 403 },
      );
    }
  }

  return NextResponse.next();
}

/** Only protect API routes — dashboard pages are read-only */
export const config = {
  matcher: "/api/:path*",
};
