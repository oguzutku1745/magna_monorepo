import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { nodePolyfills } from "vite-plugin-node-polyfills";

const appRoot = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(appRoot, "../..");

function aztecNoirWasmDevAssets() {
  const wasmByName = new Map([
    [
      "acvm_js_bg.wasm",
      resolve(repoRoot, "node_modules/@aztec/noir-acvm_js/web/acvm_js_bg.wasm"),
    ],
    [
      "noirc_abi_wasm_bg.wasm",
      resolve(repoRoot, "node_modules/@aztec/noir-noirc_abi/web/noirc_abi_wasm_bg.wasm"),
    ],
  ]);

  return {
    name: "aztec-noir-wasm-dev-assets",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const pathname = request.url ? request.url.split("?")[0] : "";
        const wasmName = pathname.split("/").pop();
        const wasmPath = wasmName ? wasmByName.get(wasmName) : undefined;
        if (!wasmPath) {
          next();
          return;
        }
        response.statusCode = 200;
        response.setHeader("content-type", "application/wasm");
        response.end(readFileSync(wasmPath));
      });
    },
  };
}

export default defineConfig({
  root: appRoot,
  publicDir: false,
  cacheDir: resolve(appRoot, "node_modules/.vite"),
  plugins: [
    react(),
    aztecNoirWasmDevAssets(),
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
  optimizeDeps: {
    esbuildOptions: {
      target: "esnext",
      supported: {
        "top-level-await": true,
      },
    },
  },
  server: {
    host: "0.0.0.0",
    port: 5174,
    fs: {
      allow: [resolve(appRoot, "../..")],
    },
  },
});
