const USERNAME = /^[A-Za-z0-9._]{2,24}$/;
const cache = new Map();
const CACHE_MS = 10 * 60 * 1000;

function normalizeUsername(value) {
  const username = String(value || "").trim().replace(/^@/, "");
  if (!USERNAME.test(username)) {
    throw new Error("Ese usuario no tiene un formato válido de TikTok.");
  }
  return username;
}

function readCache(username) {
  const hit = cache.get(username.toLowerCase());
  if (!hit) return null;
  if (Date.now() - hit.at > CACHE_MS) {
    cache.delete(username.toLowerCase());
    return null;
  }
  return hit.value;
}

function writeCache(username, value) {
  cache.set(username.toLowerCase(), { at: Date.now(), value });
}

export async function checkProfile(rawUsername) {
  const username = normalizeUsername(rawUsername);
  const cached = readCache(username);
  if (cached) return cached;

  const profileUrl = `https://www.tiktok.com/@${username}`;
  const endpoint = `https://www.tiktok.com/oembed?url=${encodeURIComponent(profileUrl)}`;

  const request = () =>
    fetch(endpoint, {
      headers: {
        Accept: "application/json",
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
      },
      signal: AbortSignal.timeout(12000),
    });

  let response = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      response = await request();
    } catch {
      response = null;
    }

    const retryable = !response || response.status === 429 || response.status >= 500;
    if (!retryable) break;
    await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
  }

  if (!response) {
    return {
      status: "unknown",
      username,
      profileUrl,
      detail: "No se pudo consultar TikTok. Inténtalo otra vez.",
    };
  }

  if (response.status === 429) {
    return {
      status: "unknown",
      username,
      profileUrl,
      detail: "TikTok pidió una pausa. Espera un momento y sigue.",
    };
  }

  if (response.ok) {
    let data = null;
    try {
      data = await response.json();
    } catch {
      data = null;
    }

    if (data && (data.author_name || data.type === "rich" || data.author_url)) {
      const result = {
        status: "alive",
        username,
        profileUrl,
        displayName: data.author_name || username,
      };
      writeCache(username, result);
      return result;
    }
  }

  if (response.status === 400 || response.status === 404) {
    const result = {
      status: "missing",
      username,
      profileUrl,
      detail: "TikTok no encuentra este perfil.",
    };
    writeCache(username, result);
    return result;
  }

  return {
    status: "unknown",
    username,
    profileUrl,
    detail: `TikTok respondió ${response.status}. No la marco como eliminada.`,
  };
}
