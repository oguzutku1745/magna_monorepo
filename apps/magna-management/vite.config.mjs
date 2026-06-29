import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { nodePolyfills } from "vite-plugin-node-polyfills";

const appRoot = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(appRoot, "../..");

const aztecBrowserDependencies = [
  "@aztec/bb.js",
  "@aztec/accounts/testing",
  "@aztec/aztec.js/abi",
  "@aztec/aztec.js/account",
  "@aztec/aztec.js/authorization",
  "@aztec/aztec.js/contracts",
  "@aztec/aztec.js/keys",
  "@aztec/aztec.js/node",
  "@aztec/aztec.js/addresses",
  "@aztec/aztec.js/fields",
  "@aztec/aztec.js/fee",
  "@aztec/aztec.js/wallet",
  "@aztec/entrypoints/account",
  "@aztec/entrypoints/default",
  "@aztec/entrypoints/interfaces",
  "@aztec/entrypoints",
  "@aztec/foundation/collection",
  "@aztec/foundation/curves/bn254",
  "@aztec/foundation/crypto/poseidon",
  "@aztec/foundation/crypto/ecdsa",
  "@aztec/foundation/log",
  "@aztec/foundation/serialize",
  "@aztec/foundation/types",
  "@aztec/noir-acvm_js",
  "@aztec/noir-noirc_abi",
  "@aztec/noir-contracts.js/Token",
  "@aztec/pxe/client/lazy",
  "@aztec/pxe/server",
  "@aztec/stdlib/abi",
  "@aztec/stdlib/errors",
  "@aztec/stdlib/gas",
  "@aztec/stdlib/interfaces/client",
  "@aztec/stdlib/auth-witness",
  "@aztec/stdlib/aztec-address",
  "@aztec/stdlib/contract",
  "@aztec/stdlib/hash",
  "@aztec/stdlib/tx",
  "@aztec/wallet-sdk/base-wallet",
  "@magna/contracts-bindings",
  "@aztec/wallets/embedded",
];

const magnaWorkspaceDependencies = [
  "@magna/client",
  "@magna/contracts-bindings",
  "@magna/core",
  "@magna/wallet",
];

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
  resolve: {
    alias: [
      {
        find: /^pino$/,
        replacement: resolve(repoRoot, "apps/magna-web/src/lib/vendor/pino-browser-shim.ts"),
      },
      {
        find: /^sha3$/,
        replacement: resolve(repoRoot, "apps/magna-web/src/lib/vendor/sha3-browser-shim.ts"),
      },
      {
        find: /^hash\.js$/,
        replacement: resolve(repoRoot, "apps/magna-web/src/lib/vendor/hashjs-browser-shim.ts"),
      },
      {
        find: /^lodash\.chunk$/,
        replacement: resolve(repoRoot, "apps/magna-web/src/lib/vendor/lodash-chunk-browser-shim.ts"),
      },
      {
        find: /^lodash\.isequal$/,
        replacement: resolve(repoRoot, "apps/magna-web/src/lib/vendor/lodash-isequal-browser-shim.ts"),
      },
      {
        find: /^lodash\.times$/,
        replacement: resolve(repoRoot, "apps/magna-web/src/lib/vendor/lodash-times-browser-shim.ts"),
      },
      {
        find: /^json-stringify-deterministic$/,
        replacement: resolve(repoRoot, "apps/magna-web/src/lib/vendor/json-stringify-deterministic-browser-shim.ts"),
      },
    ],
  },
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
  assetsInclude: ["**/*.wasm", "**/*.wasm.gz"],
  optimizeDeps: {
    // Aztec/Noir browser packages rely on package-authored worker and WASM URLs.
    // Pre-bundling rewrites those to broken `.vite/deps/main.worker.js` URLs in dev.
    // Magna workspace packages are also excluded so local dist rebuilds are not
    // hidden behind a stale Vite dependency cache during wallet-flow debugging.
    exclude: [...aztecBrowserDependencies, ...magnaWorkspaceDependencies],
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
