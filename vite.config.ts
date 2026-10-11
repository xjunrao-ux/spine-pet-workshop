import { defineConfig } from "vite";
import { resolve } from "node:path";

export default defineConfig({
  base: "./",
  build: {
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      input: {
        pet: resolve(import.meta.dirname, "index.html"),
        extensions: resolve(import.meta.dirname, "extensions.html"),
        settings: resolve(import.meta.dirname, "settings.html")
      }
    }
  }
});
