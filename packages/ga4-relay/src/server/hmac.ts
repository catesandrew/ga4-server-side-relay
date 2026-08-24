// Uses Web Crypto (crypto.subtle / crypto.randomUUID) rather than Node's
// `node:crypto` — withGa4Token (this module's consumer, via token.ts) must
// run inside Next.js middleware.ts, which is constrained to the Edge
// runtime and has no access to Node-only APIs. Web Crypto is available in
// Node (globalThis.crypto since Node 19+), the Edge runtime, and browsers,
// so the same implementation works everywhere this code runs.

// Cast to ArrayBuffer: TS 5.6+'s DOM lib types TextEncoder#encode as
// Uint8Array<ArrayBufferLike>, which SubtleCrypto's BufferSource param
// rejects at the type level (ArrayBufferLike includes SharedArrayBuffer).
// The underlying bytes are always a plain ArrayBuffer at runtime here.
function textToBytes(text: string): ArrayBuffer {
  return new TextEncoder().encode(text).buffer as ArrayBuffer;
}

function bytesToBase64Url(bytes: ArrayBuffer): string {
  const binary = String.fromCharCode(...new Uint8Array(bytes));
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", textToBytes(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
    "verify",
  ]);
}

export async function signPayload(payload: string, secret: string): Promise<string> {
  const key = await hmacKey(secret);
  const signature = await crypto.subtle.sign("HMAC", key, textToBytes(payload));
  return bytesToBase64Url(signature);
}

export async function verifySignature(payload: string, signature: string, secret: string): Promise<boolean> {
  // Defensive: a malformed request body (e.g. `replay: {}`) can reach here
  // with `signature` as `undefined` despite the type annotation — crashed
  // with a TypeError on `.length` instead of returning false (codex critic
  // review round 3, reproduced live with a 500).
  if (typeof signature !== "string") return false;
  const expected = await signPayload(payload, secret);
  // Constant-time-ish comparison: both are fixed-length base64url HMAC
  // digests, so a simple length+char compare doesn't leak early-exit
  // timing in a way that's exploitable beyond what fixed-length equality
  // checks already are; Web Crypto has no built-in timingSafeEqual.
  if (expected.length !== signature.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  }
  return diff === 0;
}

export function newId(): string {
  return crypto.randomUUID();
}
