import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// The web app and the API share ports and a domain from the repo root
// .env file (see docs/architecture.md section 7: one origin in dev and
// in production, through this proxy).
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, "../..", "");
  const apiPort = env.API_PORT ?? "3000";

  return {
    plugins: [react(), tailwindcss()],
    server: {
      proxy: {
        "/api": `http://localhost:${apiPort}`,
        "/gateway": { target: `ws://localhost:${apiPort}`, ws: true },
      },
    },
  };
});
