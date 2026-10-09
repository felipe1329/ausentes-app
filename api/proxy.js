import { handleApi } from "../server/api.mjs";

export const config = {
  maxDuration: 60,
};

export default async function handler(req, res) {
  const extra = req.query?.path;
  const path = Array.isArray(extra) ? extra.join("/") : extra || "";
  const current = req.url || "";
  const query = current.includes("?") ? current.slice(current.indexOf("?")) : "";
  const cleaned = query.replace(/([?&])path=[^&]*/g, "$1").replace(/\?&/, "?").replace(/[?&]$/, "");
  req.url = `/api/${path}${cleaned && !cleaned.startsWith("?") ? `?${cleaned}` : cleaned}`;
  await handleApi(req, res);
}
