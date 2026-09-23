import { defineConfig, loadEnv } from "vite";
import { jevMiddleware } from "./server/jev.js";
export default defineConfig(({ mode }) => {
  const env = { ...process.env, ...loadEnv(mode, process.cwd(), "") };
  return {
    base: "./",
    server: {
      host: env.JEV_HOST || "localhost",
      port: 5173,
      strictPort: true,
      allowedHosts: (env.JEV_ALLOWED_HOSTS || "").split(",").filter(Boolean),
    },
    preview: {
      host: env.JEV_HOST || "localhost",
      port: 5173,
      strictPort: true,
      allowedHosts: (env.JEV_ALLOWED_HOSTS || "").split(",").filter(Boolean),
    },
    plugins: [
      {
        name: "jev-server",
        configureServer(server) {
          server.middlewares.use(jevMiddleware(env));
        },
        configurePreviewServer(server) {
          server.middlewares.use(jevMiddleware(env));
        },
      },
    ],
    build: {
      rolldownOptions: {
        input: { main: "index.html", login: "login.html" },
        output: {
          codeSplitting: {
            groups: [{ name: "three", test: /node_modules\/three/ }],
          },
        },
      },
    },
  };
});
