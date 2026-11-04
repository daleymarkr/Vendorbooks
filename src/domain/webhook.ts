/**
 * Square signs HMAC-SHA256(notificationUrl + rawBody) with the webhook
 * signature key and base64-encodes it. The header is x-square-hmacsha256-signature.
 * Comparison is constant-time: the loop never returns early.
 */

export async function squareSignature(signatureKey: string, notificationUrl: string, rawBody: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(signatureKey),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signed = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(notificationUrl + rawBody));
  return bytesToBase64(new Uint8Array(signed));
}

export async function verifySquareSignature(
  rawBody: string,
  signatureHeader: string | null | undefined,
  notificationUrl: string,
  signatureKey: string,
): Promise<boolean> {
  if (!signatureHeader || !signatureKey || !notificationUrl) return false;
  const expected = await squareSignature(signatureKey, notificationUrl, rawBody);
  return timingSafeEqualString(expected, signatureHeader.trim());
}

/** Constant-time string compare. Length mismatch still scans a full buffer. */
export function timingSafeEqualString(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const left = enc.encode(a);
  const right = enc.encode(b);
  const length = Math.max(left.length, right.length, 1);
  let diff = left.length ^ right.length;
  for (let i = 0; i < length; i++) {
    diff |= (left[i] ?? 0) ^ (right[i] ?? 0);
  }
  return diff === 0;
}

function bytesToBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== "undefined") return Buffer.from(bytes).toString("base64");
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export function bytesToBase64Url(bytes: Uint8Array): string {
  return bytesToBase64(bytes).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

export function base64UrlToBytes(value: string): Uint8Array {
  const pad = value.length % 4 === 0 ? "" : "=".repeat(4 - (value.length % 4));
  const b64 = value.replaceAll("-", "+").replaceAll("_", "/") + pad;
  if (typeof Buffer !== "undefined") return new Uint8Array(Buffer.from(b64, "base64"));
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

export async function hmacSha256Base64Url(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signed = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return bytesToBase64Url(new Uint8Array(signed));
}

export async function encryptSecret(plain: string, keyMaterial: string): Promise<string> {
  const key = await importAesKey(keyMaterial);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(plain));
  return `v1.${bytesToBase64Url(iv)}.${bytesToBase64Url(new Uint8Array(cipher))}`;
}

export async function decryptSecret(payload: string, keyMaterial: string): Promise<string> {
  const [version, ivPart, dataPart] = payload.split(".");
  if (version !== "v1" || !ivPart || !dataPart) throw new Error("Unknown token cipher");
  const key = await importAesKey(keyMaterial);
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: toBufferSource(base64UrlToBytes(ivPart)) },
    key,
    toBufferSource(base64UrlToBytes(dataPart)),
  );
  return new TextDecoder().decode(plain);
}

function toBufferSource(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

async function importAesKey(keyMaterial: string): Promise<CryptoKey> {
  const raw = decodeKey(keyMaterial);
  if (raw.length !== 32) throw new Error("TOKEN_ENCRYPTION_KEY must decode to 32 bytes");
  return crypto.subtle.importKey("raw", toBufferSource(raw), { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

function decodeKey(keyMaterial: string): Uint8Array {
  const trimmed = keyMaterial.trim();
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    const out = new Uint8Array(32);
    for (let i = 0; i < 32; i++) out[i] = Number.parseInt(trimmed.slice(i * 2, i * 2 + 2), 16);
    return out;
  }
  return base64UrlToBytes(trimmed.replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", ""));
}

export type OAuthState = {
  shopId: string;
  userId: string;
  nonce: string;
  exp: number;
  env: "sandbox" | "production";
};

export async function signOAuthState(state: OAuthState, secret: string): Promise<string> {
  const body = bytesToBase64Url(new TextEncoder().encode(JSON.stringify(state)));
  const sig = await hmacSha256Base64Url(secret, body);
  return `${body}.${sig}`;
}

export async function readOAuthState(token: string, secret: string, now = Date.now()): Promise<OAuthState> {
  const [body, sig] = token.split(".");
  if (!body || !sig) throw new Error("OAuth state is malformed");
  const expected = await hmacSha256Base64Url(secret, body);
  if (!timingSafeEqualString(expected, sig)) throw new Error("OAuth state signature mismatch");
  const parsed = JSON.parse(new TextDecoder().decode(base64UrlToBytes(body))) as OAuthState;
  if (parsed.exp < now) throw new Error("OAuth state expired");
  return parsed;
}
