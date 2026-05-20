// Cookie-based admin auth using HMAC-SHA256 over an expiry timestamp.
// Edge-runtime safe: only Web Crypto + TextEncoder.

export const ADMIN_COOKIE_NAME = "admin_auth";
export const ADMIN_COOKIE_TTL_SECONDS = 8 * 60 * 60; // 8h, plenty for one event.

function toHex(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i].toString(16).padStart(2, "0");
  }
  return out;
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

async function hmac(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return toHex(sig);
}

export async function signAdminCookie(
  secret: string,
  ttlSeconds = ADMIN_COOKIE_TTL_SECONDS,
): Promise<{ value: string; expiresAt: Date }> {
  const expiresAtUnix = Math.floor(Date.now() / 1000) + ttlSeconds;
  const sig = await hmac(secret, String(expiresAtUnix));
  return {
    value: `${expiresAtUnix}.${sig}`,
    expiresAt: new Date(expiresAtUnix * 1000),
  };
}

export async function verifyAdminCookie(
  secret: string,
  value: string | undefined | null,
): Promise<boolean> {
  if (!value || !secret) return false;
  const dot = value.indexOf(".");
  if (dot <= 0) return false;
  const expiresAtStr = value.slice(0, dot);
  const sig = value.slice(dot + 1);
  const expiresAt = Number(expiresAtStr);
  if (!Number.isFinite(expiresAt)) return false;
  if (Math.floor(Date.now() / 1000) >= expiresAt) return false;
  const expected = await hmac(secret, expiresAtStr);
  return constantTimeEqual(expected, sig);
}
