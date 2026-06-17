import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const appRoot = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: appRoot,
  publicDir: false,
  cacheDir: resolve(appRoot, "node_modules/.vite"),
  plugins: [react()],
  build: {
    target: "esnext",
    minify: false,
    outDir: resolve(appRoot, "dist"),
    emptyOutDir: true,
  },
  server: {
    host: "0.0.0.0",
    port: 5175,
    fs: {
      allow: [resolve(appRoot, "../..")],
    },
  },
});
