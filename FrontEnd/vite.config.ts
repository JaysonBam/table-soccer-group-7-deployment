import { defineConfig } from "vite";

const BACKEND_TARGET = process.env.VITE_BACKEND_TARGET ?? "http://localhost:3000";

export default defineConfig({
  server: {
    allowedHosts: true,
    proxy: {
      "/health": {
        target: BACKEND_TARGET,
        changeOrigin: true
      },
      "/lobbies": {
        target: BACKEND_TARGET,
        changeOrigin: true,
        ws: true
      }
    }
  }
});
