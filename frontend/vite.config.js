import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Proxy /api (REST + WebSocket) to the Express server so the browser talks to a
// single origin — no CORS, and the voice WS just works over ws://localhost:5173.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:3000",
        changeOrigin: true,
        ws: true,
      },
    },
  },
});
