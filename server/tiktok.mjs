import JSZip from "jszip";
import { mergeImports, parseJsonText, parseTxt } from "../src/parseTikTok.js";
import { LOGIN_SCOPES } from "./env.mjs";

const TOKEN_URL = "https://open.tiktokapis.com/v2/oauth/token/";
const REVOKE_URL = "https://open.tiktokapis.com/v2/oauth/revoke/";
const USER_URL = "https://open.tiktokapis.com/v2/user/info/";
const DATA_ADD_URL = "https://open.tiktokapis.com/v2/user/data/add/?fields=request_id";
const DATA_CHECK_URL =
  "https://open.tiktokapis.com/v2/user/data/check/?fields=request_id,status,apply_time,collect_time";
const DATA_DOWNLOAD_URL = "https://open.tiktokapis.com/v2/user/data/download/";

function assertOk(payload) {
  const code = payload?.error?.code;
  if (code && code !== "ok") {
    const message = payload.error.message || code;
    const error = new Error(message);
    error.code = code;
    throw error;
  }
  if (typeof payload?.error === "string" && payload.error) {
    throw new Error(payload.error_description || payload.error);
  }
  return payload;
}

async function formPost(url, params) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params),
  });
  const payload = await response.json();
  return assertOk(payload);
}

export function authorizeUrl({ clientKey, redirectUri, state }) {
  const url = new URL("https://www.tiktok.com/v2/auth/authorize/");
  url.searchParams.set("client_key", clientKey);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", LOGIN_SCOPES);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("state", state);
  return url.toString();
}

export async function exchangeCode({ clientKey, clientSecret, code, redirectUri }) {
  return formPost(TOKEN_URL, {
    client_key: clientKey,
    client_secret: clientSecret,
    code,
    grant_type: "authorization_code",
    redirect_uri: redirectUri,
  });
}

export async function refreshAccess({ clientKey, clientSecret, refreshToken }) {
  return formPost(TOKEN_URL, {
    client_key: clientKey,
    client_secret: clientSecret,
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });
}

export async function revokeAccess({ clientKey, clientSecret, token }) {
  await formPost(REVOKE_URL, {
    client_key: clientKey,
    client_secret: clientSecret,
    token,
  });
}

function fieldsFor(scope = "") {
  const fields = ["open_id", "avatar_url", "display_name"];
  if (scope.includes("user.info.profile")) {
    fields.push("username", "bio_description", "profile_deep_link", "is_verified");
  }
  if (scope.includes("user.info.stats")) {
    fields.push("follower_count", "following_count", "likes_count", "video_count");
  }
  return fields.join(",");
}

export function publicProfile(user = {}) {
  return {
    displayName: user.display_name || "Tu TikTok",
    username: user.username || "",
    avatarUrl: user.avatar_url || "",
    bio: user.bio_description || "",
    verified: Boolean(user.is_verified),
    followerCount: user.follower_count ?? null,
    followingCount: user.following_count ?? null,
    likesCount: user.likes_count ?? null,
    videoCount: user.video_count ?? null,
    profileUrl: user.profile_deep_link || (user.username ? `https://www.tiktok.com/@${user.username}` : ""),
  };
}

export async function fetchProfile(accessToken, scope) {
  const url = new URL(USER_URL);
  url.searchParams.set("fields", fieldsFor(scope));
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const payload = assertOk(await response.json());
  return publicProfile(payload.data?.user || {});
}

async function bearerJson(url, accessToken, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  return assertOk(await response.json());
}

export async function addDataRequest(accessToken) {
  const payload = await bearerJson(DATA_ADD_URL, accessToken, {
    data_format: "json",
    category_selection_list: ["activity", "profile"],
  });
  return payload.data?.request_id;
}

export async function checkDataRequest(accessToken, requestId) {
  const payload = await bearerJson(DATA_CHECK_URL, accessToken, {
    request_id: Number(requestId),
  });
  return payload.data || {};
}

export async function downloadBook(accessToken, requestId) {
  const response = await fetch(DATA_DOWNLOAD_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ request_id: Number(requestId) }),
  });

  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer[0] === 0x7b) {
    assertOk(JSON.parse(buffer.toString("utf8")));
    throw new Error("TikTok no devolvió el archivo de tu lista.");
  }

  const zip = await JSZip.loadAsync(buffer);
  const parts = [];
  for (const entry of Object.values(zip.files)) {
    if (entry.dir || !/\.(json|txt)$/i.test(entry.name)) continue;
    const text = await entry.async("string");
    parts.push(entry.name.toLowerCase().endsWith(".json") ? parseJsonText(text) : parseTxt(text, entry.name));
  }
  if (!parts.length) throw new Error("La copia de TikTok no trae listas de seguidos.");
  return mergeImports(parts);
}
