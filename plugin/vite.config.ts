import path from "path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  root: "src/web/ui",
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src/web/ui"),
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": "http://127.0.0.1:4747",
    },
  },
  build: {
    outDir: path.resolve(__dirname, "dist/web"),
  },
});
