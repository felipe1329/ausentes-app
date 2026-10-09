import { createHmac, timingSafeEqual } from "node:crypto";

function secret() {
  return process.env.TIKTOK_CLIENT_SECRET || process.env.SESSION_SECRET || "";
}

export function seal(payload) {
  const key = secret();
  if (!key) throw new Error("Falta TIKTOK_CLIENT_SECRET para firmar la sesión.");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = createHmac("sha256", key).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export function unseal(token) {
  const key = secret();
  if (!token || !key) return null;
  const splitAt = token.lastIndexOf(".");
  if (splitAt <= 0) return null;
  const body = token.slice(0, splitAt);
  const sig = token.slice(splitAt + 1);
  const expected = createHmac("sha256", key).update(body).digest("base64url");
  const left = Buffer.from(sig);
  const right = Buffer.from(expected);
  if (left.length !== right.length || !timingSafeEqual(left, right)) return null;
  try {
    return JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return null;
  }
}
