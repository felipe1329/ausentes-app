import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

let loaded = false;

export function loadEnv() {
  if (loaded) return;
  loaded = true;
  const file = join(process.cwd(), ".env");
  if (!existsSync(file)) return;

  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

export function tiktokConfig(requestHost, protocol = "http") {
  loadEnv();
  const clientKey = process.env.TIKTOK_CLIENT_KEY || "";
  const clientSecret = process.env.TIKTOK_CLIENT_SECRET || "";
  const configuredUri = process.env.TIKTOK_REDIRECT_URI || "";
  const localUri = !configuredUri || /localhost|127\.0\.0\.1/.test(configuredUri);
  const redirectUri =
    process.env.VERCEL && localUri
      ? `https://${requestHost}/api/auth/callback`
      : configuredUri || `${protocol}://${requestHost || "127.0.0.1:5173"}/api/auth/callback`;
  return {
    clientKey,
    clientSecret,
    redirectUri,
    configured: Boolean(clientKey && clientSecret),
  };
}

const LOGIN_KIT_SCOPES = ["user.info.basic", "user.info.profile", "user.info.stats"];
const PORTABILITY_SCOPES = ["portability.activity.single", "portability.postsandprofile.single"];

export function loginScopes(clientKey = "") {
  // Las claves de Sandbox empiezan por "sb". Data Portability no existe ahí:
  // pedirlo hace que TikTok rechace todo el inicio de sesión con error "scope".
  const scopes = clientKey.startsWith("sb")
    ? LOGIN_KIT_SCOPES
    : [...LOGIN_KIT_SCOPES, ...PORTABILITY_SCOPES];
  return scopes.join(",");
}
