import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'STUDIO_');
  const backend = process.env.STUDIO_BACKEND_URL || env.STUDIO_BACKEND_URL || "http://127.0.0.1:8788";
  return {
  plugins: [react()],
  build: { outDir: "dist" },
  // Accounts, saving, and equipment analysis share the separate NestJS backend.
  server: { proxy: { "/api": backend } },
  preview: { proxy: { "/api": backend } },
  };
});
