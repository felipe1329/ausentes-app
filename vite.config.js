import { defineConfig } from "vite";
import { handleApi } from "./server/api.mjs";

function tiktokApi() {
  const handle = (req, res, next) => {
    handleApi(req, res)
      .then((handled) => {
        if (!handled) next();
      })
      .catch((error) => {
        res.statusCode = 500;
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        res.end(JSON.stringify({ message: error.message || "Error interno." }));
      });
  };

  return {
    name: "tiktok-check",
    configureServer(server) {
      server.middlewares.use(handle);
    },
    configurePreviewServer(server) {
      server.middlewares.use(handle);
    },
  };
}

export default defineConfig({
  plugins: [tiktokApi()],
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
  },
});
