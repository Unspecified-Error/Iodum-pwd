import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Tauri 期望前端跑在固定端口，devUrl 与 tauri.conf.json 对应
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 5173,
    strictPort: true,
  },
  build: {
    target: "es2021",
    outDir: "dist",
  },
});
