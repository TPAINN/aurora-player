import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    {
      name: "aurora-local-api",
      configureServer: installApi,
      configurePreviewServer: installApi,
    },
  ],
  resolve: {
    alias: { "@shared": fileURLToPath(new URL("./shared", import.meta.url)) },
  },
});

function installApi(server) {
  server.middlewares.use(async (req, res, next) => {
    const url = new URL(req.url, "http://localhost");
    const routes = {
      "/api/search": "./api/search.js",
      "/api/video/search": "./api/video/search.js",
      "/api/lyrics/structured": "./api/lyrics/structured.js",
      "/api/health": "./api/health.js",
      "/api/recommendations": "./api/recommendations.js",
      "/api/tempo": "./api/tempo.js",
    };
    if (!routes[url.pathname]) return next();
    req.query = Object.fromEntries(url.searchParams);
    res.status = (code) => {
      res.statusCode = code;
      return res;
    };
    res.json = (body) => {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(body));
    };
    try {
      const { default: handler } = await import(
        new URL(routes[url.pathname], import.meta.url).href
      );
      await handler(req, res);
    } catch (error) {
      console.error("[local-api]", error.message);
      if (!res.writableEnded)
        res
          .status(502)
          .json({ error: "The music service is temporarily unavailable." });
    }
  });
}
