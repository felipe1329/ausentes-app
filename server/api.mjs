import { randomBytes } from "node:crypto";
import { checkProfile } from "./checkProfile.mjs";
import { tiktokConfig } from "./env.mjs";
import { seal, unseal } from "./seal.mjs";
import { createSession, deleteSession, getSession, updateSession } from "./sessions.mjs";
import {
  addDataRequest,
  authorizeUrl,
  checkDataRequest,
  downloadBook,
  exchangeCode,
  fetchProfile,
  publicProfile,
  refreshAccess,
  revokeAccess,
} from "./tiktok.mjs";

const COOKIE = "ausentes_session";
const STATE_COOKIE = "ausentes_state";
const serverless = Boolean(process.env.VERCEL);

function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

function redirect(res, location) {
  res.statusCode = 302;
  res.setHeader("Location", location);
  res.end();
}

function readCookie(req, name) {
  const raw = req.headers.cookie || "";
  const hit = raw.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name}=`));
  return hit ? decodeURIComponent(hit.slice(name.length + 1)) : "";
}

function cookieSuffix() {
  return `HttpOnly; SameSite=Lax; Path=/${serverless ? "; Secure" : ""}`;
}

function appendCookie(res, cookie) {
  const current = res.getHeader("Set-Cookie");
  if (!current) res.setHeader("Set-Cookie", cookie);
  else if (Array.isArray(current)) res.setHeader("Set-Cookie", [...current, cookie]);
  else res.setHeader("Set-Cookie", [current, cookie]);
}

function setSessionCookie(res, id) {
  const value = id
    ? `${COOKIE}=${encodeURIComponent(id)}; ${cookieSuffix()}; Max-Age=2592000`
    : `${COOKIE}=; ${cookieSuffix()}; Max-Age=0`;
  appendCookie(res, value);
}

function writeSealedSession(res, session) {
  if (!session) {
    appendCookie(res, `${COOKIE}=; ${cookieSuffix()}; Max-Age=0`);
    return;
  }
  const { book, id, profileError, ...rest } = session;
  appendCookie(res, `${COOKIE}=${seal(rest)}; ${cookieSuffix()}; Max-Age=2592000`);
}

function readRequestSession(req) {
  if (!serverless) return getSession(readCookie(req, COOKIE));
  const data = unseal(readCookie(req, COOKIE));
  return data ? { id: "cookie", ...data } : null;
}

function saveSession(res, session) {
  if (serverless) {
    writeSealedSession(res, session);
    return session;
  }
  if (!session?.id || session.id === "cookie") {
    const created = createSession(session);
    setSessionCookie(res, created.id);
    return created;
  }
  updateSession(session.id, session);
  setSessionCookie(res, session.id);
  return getSession(session.id);
}

async function withAccess(session, config, res) {
  if (!session?.accessToken) return null;
  const fresh = !session.expiresAt || session.expiresAt - Date.now() > 60_000;
  if (fresh) return session.accessToken;

  const tokens = await refreshAccess({
    clientKey: config.clientKey,
    clientSecret: config.clientSecret,
    refreshToken: session.refreshToken,
  });
  Object.assign(session, {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token || session.refreshToken,
    expiresAt: Date.now() + Number(tokens.expires_in || 86400) * 1000,
    scope: tokens.scope || session.scope,
  });
  saveSession(res, session);
  return session.accessToken;
}

function applyTokens(tokens) {
  return {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    openId: tokens.open_id || "",
    scope: tokens.scope || "",
    expiresAt: Date.now() + Number(tokens.expires_in || 86400) * 1000,
  };
}

function clientSession(session) {
  if (!session) return { connected: false };
  return {
    connected: true,
    profile: session.profile || null,
    scope: session.scope || "",
    dataStatus: session.dataStatus || "",
    book: session.book || null,
  };
}

async function loadProfile(session, config, res) {
  const token = await withAccess(session, config, res);
  const profile = await fetchProfile(token, session.scope);
  Object.assign(session, { profile });
  saveSession(res, session);
  return profile;
}

async function syncData(session, config, res) {
  if (!session.scope?.includes("portability.")) {
    const error = new Error("Vuelve a conectar y acepta el permiso para traer tu lista.");
    error.code = "missing_scope";
    throw error;
  }

  const token = await withAccess(session, config, res);
  if (!session.requestId) {
    session.requestId = await addDataRequest(token);
    session.dataStatus = "pending";
    session.book = null;
    saveSession(res, session);
  }

  const status = await checkDataRequest(token, session.requestId);
  session.dataStatus = status.status || "pending";
  saveSession(res, session);

  if (status.status === "downloading" && !session.book) {
    const book = await downloadBook(token, session.requestId);
    session.book = serverless ? null : book;
    session.dataStatus = "ready";
    saveSession(res, session);
    return { status: "ready", book };
  }

  if (session.book) return { status: "ready", book: session.book };
  return { status: session.dataStatus || "pending", book: null };
}

export async function handleApi(req, res) {
  const url = new URL(req.url || "/", "http://127.0.0.1");
  if (!url.pathname.startsWith("/api/")) return false;

  const protocol = String(req.headers["x-forwarded-proto"] || "http").split(",")[0];
  const config = tiktokConfig(req.headers.host, protocol);

  try {
    if (url.pathname === "/api/check") {
      const result = await checkProfile(url.searchParams.get("username") || "");
      sendJson(res, 200, result);
      return true;
    }

    if (url.pathname === "/api/tiktok/config") {
      sendJson(res, 200, {
        configured: config.configured,
        redirectUri: config.redirectUri,
      });
      return true;
    }

    if (url.pathname === "/api/auth/login") {
      if (!config.configured) {
        sendJson(res, 400, {
          message: "Faltan TIKTOK_CLIENT_KEY y TIKTOK_CLIENT_SECRET en el archivo .env.",
        });
        return true;
      }
      const state = randomBytes(16).toString("hex");
      appendCookie(res, `${STATE_COOKIE}=${state}; ${cookieSuffix()}; Max-Age=900`);
      redirect(res, authorizeUrl({ clientKey: config.clientKey, redirectUri: config.redirectUri, state }));
      return true;
    }

    if (url.pathname === "/api/auth/callback") {
      const error = url.searchParams.get("error_description") || url.searchParams.get("error");
      if (error) {
        redirect(res, `/?auth_error=${encodeURIComponent(error)}`);
        return true;
      }
      const returnedState = url.searchParams.get("state") || "";
      if (!returnedState || returnedState !== readCookie(req, STATE_COOKIE)) {
        redirect(res, `/?auth_error=${encodeURIComponent("La conexión expiró. Inténtalo otra vez.")}`);
        return true;
      }
      appendCookie(res, `${STATE_COOKIE}=; ${cookieSuffix()}; Max-Age=0`);
      const tokens = await exchangeCode({
        clientKey: config.clientKey,
        clientSecret: config.clientSecret,
        code: url.searchParams.get("code") || "",
        redirectUri: config.redirectUri,
      });
      let session = { ...applyTokens(tokens) };
      try {
        session.profile = await fetchProfile(session.accessToken, session.scope);
      } catch (profileError) {
        session.profile = publicProfile({ display_name: "Cuenta conectada" });
        session.profileError = profileError.message;
      }
      session = saveSession(res, session);
      redirect(res, "/?connected=1");
      return true;
    }

    if (url.pathname === "/api/tiktok/me" && req.method === "GET") {
      const session = readRequestSession(req);
      if (!session) {
        sendJson(res, 200, { connected: false });
        return true;
      }
      if (!session.profile) {
        try {
          await loadProfile(session, config, res);
        } catch (error) {
          sendJson(res, 200, { ...clientSession(session), warning: error.message });
          return true;
        }
      }
      sendJson(res, 200, clientSession(session));
      return true;
    }

    if (url.pathname === "/api/tiktok/disconnect" && req.method === "POST") {
      const session = readRequestSession(req);
      if (session?.accessToken) {
        try {
          await revokeAccess({
            clientKey: config.clientKey,
            clientSecret: config.clientSecret,
            token: session.accessToken,
          });
        } catch {
          // La sesión local se borra aunque TikTok no responda.
        }
        if (!serverless && session.id && session.id !== "cookie") deleteSession(session.id);
      }
      setSessionCookie(res, "");
      sendJson(res, 200, { connected: false });
      return true;
    }

    if (url.pathname === "/api/tiktok/data") {
      const session = readRequestSession(req);
      if (!session) {
        sendJson(res, 401, { message: "Conecta tu TikTok primero." });
        return true;
      }
      if (req.method === "GET" && session.book) {
        sendJson(res, 200, { status: "ready", book: session.book });
        return true;
      }
      if (req.method === "GET" && !session.requestId) {
        sendJson(res, 200, { status: session.dataStatus || "idle", book: null });
        return true;
      }
      const result = await syncData(session, config, res);
      sendJson(res, 200, result);
      return true;
    }
  } catch (error) {
    const status = error.code === "missing_scope" ? 403 : 400;
    sendJson(res, status, { message: error.message || "TikTok no respondió.", code: error.code || "" });
    return true;
  }

  sendJson(res, 404, { message: "No existe esa ruta." });
  return true;
}
