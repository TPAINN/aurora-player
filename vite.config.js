import { defineConfig } from "vite";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import babel from "@rolldown/plugin-babel";
import { fileURLToPath } from "node:url";

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    // The compiler memoizes every component: a song change or a sheet no longer
    // re-renders the lyrics, the page behind the player or anything else unchanged.
    babel({ presets: [reactCompilerPreset()] }),
    {
      name: "aurora-local-api",
      configureServer: installApi,
      configurePreviewServer: installApi,
    },
  ],
  resolve: {
    alias: { "@shared": fileURLToPath(new URL("./shared", import.meta.url)) },
  },
  // Libraries that rarely change get their own long-lived files: after a deploy a
  // returning listener downloads only the app's own code again (the service worker
  // keeps the rest), and the browser fetches the pieces in parallel.
  build: {
    rolldownOptions: {
      output: {
        advancedChunks: {
          groups: [
            { name: "react", test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/ },
            { name: "motion", test: /node_modules[\\/](framer-motion|motion-dom|motion-utils)[\\/]/ },
            { name: "vendor", test: /node_modules[\\/]/ },
          ],
        },
      },
    },
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
      "/api/collection": "./api/collection.js",
      "/api/mood": "./api/mood.js",
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
