const encoder = new TextEncoder();
export const SESSION_COOKIE = "__Host-jevpilot";
const encode = (bytes) =>
  btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
const decode = (text) =>
  Uint8Array.from(atob(text.replaceAll("-", "+").replaceAll("_", "/")), (c) =>
    c.charCodeAt(0),
  );

async function key(secret) {
  if (!secret) throw new Error("Session signing is not configured.");
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}
export async function sign(secret, value, seconds) {
  const payload = encode(
    encoder.encode(JSON.stringify({ value, exp: Date.now() + seconds * 1000 })),
  );
  return `${payload}.${encode(new Uint8Array(await crypto.subtle.sign("HMAC", await key(secret), encoder.encode(payload))))}`;
}
export async function verify(secret, token) {
  try {
    if (!token || token.length > 4096) return null;
    const [payload, signature, extra] = token.split(".");
    if (
      !payload ||
      !signature ||
      extra ||
      !(await crypto.subtle.verify(
        "HMAC",
        await key(secret),
        decode(signature),
        encoder.encode(payload),
      ))
    )
      return null;
    const data = JSON.parse(new TextDecoder().decode(decode(payload)));
    return Number.isFinite(data.exp) && data.exp > Date.now()
      ? data.value
      : null;
  } catch {
    return null;
  }
}
export function readCookie(request, name) {
  return (
    request.headers
      .get("Cookie")
      ?.split(";")
      .map((c) => c.trim())
      .find((c) => c.startsWith(`${name}=`))
      ?.slice(name.length + 1) || null
  );
}
export async function authenticatedUserId(request, secret) {
  const session = await verify(secret, readCookie(request, SESSION_COOKIE));
  return typeof session?.user_id === "string" &&
    /^[a-zA-Z0-9_-]{1,128}$/.test(session.user_id)
    ? session.user_id
    : null;
}
export function cookie(name, value, seconds) {
  return `${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${seconds}`;
}
export async function platform(env, path, body) {
  const response = await fetch(`${env.PLATFORM_URL}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.PLATFORM_PARTNER_SECRET}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  const data = await response.json();
  if (!response.ok)
    throw new Error(
      "Standard Agents sign-in is temporarily unavailable. Please try again.",
    );
  return data;
}
