import { handleApi } from "../server/api.mjs";

export const config = {
  maxDuration: 60,
};

export default async function handler(req, res) {
  const path = req.url || "/";
  if (!path.startsWith("/api/")) {
    const query = path.includes("?") ? path.slice(path.indexOf("?")) : "";
    const parts = Array.isArray(req.query?.path) ? req.query.path.join("/") : "";
    req.url = `/api/${parts}${query}`;
  }
  await handleApi(req, res);
}
