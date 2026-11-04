import type { SquareConnection } from "./types";

const DAY = 24 * 60 * 60 * 1000;

/** Square asks apps to refresh at least every 7 days, and to alert if a token is older than 8. */
export function tokenNeedsRefresh(
  connection: Pick<SquareConnection, "tokenExpiresAt" | "lastRefreshedAt" | "createdAt">,
  now: Date,
): boolean {
  const refreshedAt = new Date(connection.lastRefreshedAt ?? connection.createdAt).getTime();
  const ageMs = now.getTime() - refreshedAt;
  const expiresInMs = new Date(connection.tokenExpiresAt).getTime() - now.getTime();
  return ageMs >= 7 * DAY || expiresInMs < 8 * DAY;
}

export function tokenRefreshIsStale(
  connection: Pick<SquareConnection, "lastRefreshedAt" | "createdAt">,
  now: Date,
): boolean {
  const refreshedAt = new Date(connection.lastRefreshedAt ?? connection.createdAt).getTime();
  return now.getTime() - refreshedAt > 8 * DAY;
}
