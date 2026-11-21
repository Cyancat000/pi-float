import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  clearScreen: false,
  server: { host: "127.0.0.1", port: 1420, strictPort: true },
  build: { rollupOptions: { output: { manualChunks(id) {
    if (/\/highlight\.js\/(?:lib|es)\//.test(id)) return "highlight";
    if (id.includes("/node_modules/@codemirror/")) return "composer";
  } } } },
});
