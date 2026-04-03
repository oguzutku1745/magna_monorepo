import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { nodePolyfills } from "vite-plugin-node-polyfills";

const appRoot = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: appRoot,
  publicDir: false,
  cacheDir: resolve(appRoot, "node_modules/.vite"),
  plugins: [
    react(),
    nodePolyfills({
      globals: {
        Buffer: true,
        global: true,
        process: true,
      },
      protocolImports: true,
    }),
  ],
  build: {
    target: "esnext",
    minify: false,
    outDir: resolve(appRoot, "dist"),
    emptyOutDir: true,
  },
  esbuild: {
    target: "esnext",
    supported: {
      "top-level-await": true,
    },
  },
  server: {
    host: "0.0.0.0",
    port: 5173,
    fs: {
      allow: [resolve(appRoot, "../..")],
    },
  },
});
