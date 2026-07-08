import { defineConfig } from "vite";

const BACKEND_TARGET = process.env.VITE_BACKEND_TARGET ?? "https://table-soccer-group-7-server.onrender.com";

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
