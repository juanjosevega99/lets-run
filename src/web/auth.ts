import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Single-user password gate (PROJECT.md §5/§11: "a lock, not multi-tenancy").
 * Enabled only when DASHBOARD_PASSWORD is set — local dev stays frictionless.
 * HTTP Basic auth: any username, one shared password, compared timing-safely.
 */
export function isAuthorized(authorizationHeader: string | undefined, password: string): boolean {
  if (!authorizationHeader?.startsWith("Basic ")) return false;
  let decoded: string;
  try {
    decoded = Buffer.from(authorizationHeader.slice(6), "base64").toString("utf8");
  } catch {
    return false;
  }
  const colon = decoded.indexOf(":");
  if (colon === -1) return false;
  const supplied = decoded.slice(colon + 1);
  // hash both sides to fixed length so timingSafeEqual is applicable and length leaks nothing
  const a = createHash("sha256").update(supplied).digest();
  const b = createHash("sha256").update(password).digest();
  return timingSafeEqual(a, b);
}
