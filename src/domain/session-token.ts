import { base64UrlToBytes, bytesToBase64Url, hmacSha256Base64Url, timingSafeEqualString } from "./webhook";

export async function writeSessionToken(userId: string, secret: string, ttlMs = 14 * 24 * 60 * 60 * 1000): Promise<string> {
  const body = bytesToBase64Url(new TextEncoder().encode(JSON.stringify({ uid: userId, exp: Date.now() + ttlMs })));
  const sig = await hmacSha256Base64Url(secret, body);
  return `${body}.${sig}`;
}

export async function readSessionToken(token: string | undefined, secret: string, now = Date.now()): Promise<string | null> {
  if (!token) return null;
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const expected = await hmacSha256Base64Url(secret, body);
  if (!timingSafeEqualString(expected, sig)) return null;
  try {
    const parsed = JSON.parse(new TextDecoder().decode(base64UrlToBytes(body))) as { uid?: string; exp?: number };
    if (!parsed.uid || !parsed.exp || parsed.exp < now) return null;
    return parsed.uid;
  } catch {
    return null;
  }
}
