import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  base: "/static/ui/",
  build: {
    outDir: path.resolve(__dirname, "../static/ui"),
    emptyOutDir: true,
    sourcemap: false,
    cssCodeSplit: false,
    rollupOptions: {
      output: {
        entryFileNames: "app.js",
        assetFileNames: (assetInfo) => {
          if (assetInfo.name === "style.css") {
            return "app.css";
          }
          return assetInfo.name ?? "asset";
        },
        inlineDynamicImports: true
      }
    }
  },
  server: {
    host: "127.0.0.1",
    port: 11441,
    strictPort: true,
    proxy: {
      "/health": "http://127.0.0.1:11440",
      "/ready": "http://127.0.0.1:11440",
      "/history": "http://127.0.0.1:11440",
      "/convert_chinese": "http://127.0.0.1:11440",
      "/export": "http://127.0.0.1:11440",
      "/api": "http://127.0.0.1:11440",
      "/job": "http://127.0.0.1:11440",
      "/preprocess_audio": "http://127.0.0.1:11440",
      "/transcribe": "http://127.0.0.1:11440",
      "/models": "http://127.0.0.1:11440",
      "/download": "http://127.0.0.1:11440",
      "/audio": "http://127.0.0.1:11440",
      "/media": "http://127.0.0.1:11440",
      "/import": "http://127.0.0.1:11440",
      "/proxy": "http://127.0.0.1:11440",
      "/static/vendor": "http://127.0.0.1:11440"
    }
  }
});
