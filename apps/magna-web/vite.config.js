import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { nodePolyfills } from "vite-plugin-node-polyfills";
import { resolve } from "node:path";

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

export default defineConfig({
  resolve: {
    alias: [
      {
        // `@aztec/foundation` expects `pino` to expose named ESM exports in the browser.
        // Vite serves `pino/browser.js` as raw CJS when pulled via excluded Aztec browser entrypoints,
        // so we shim only the bare `pino` import back to the shape Aztec expects.
        find: /^pino$/,
        replacement: resolve(import.meta.dirname, "./src/lib/vendor/pino-browser-shim.ts"),
      },
      {
        // `sha3` is also consumed as named ESM exports by `@aztec/foundation`.
        find: /^sha3$/,
        replacement: resolve(import.meta.dirname, "./src/lib/vendor/sha3-browser-shim.ts"),
      },
      {
        // `hash.js` is consumed as a default import by `@aztec/foundation`.
        find: /^hash\.js$/,
        replacement: resolve(import.meta.dirname, "./src/lib/vendor/hashjs-browser-shim.ts"),
      },
      {
        find: /^lodash\.chunk$/,
        replacement: resolve(import.meta.dirname, "./src/lib/vendor/lodash-chunk-browser-shim.ts"),
      },
      {
        find: /^lodash\.isequal$/,
        replacement: resolve(import.meta.dirname, "./src/lib/vendor/lodash-isequal-browser-shim.ts"),
      },
      {
        find: /^lodash\.times$/,
        replacement: resolve(import.meta.dirname, "./src/lib/vendor/lodash-times-browser-shim.ts"),
      },
      {
        find: /^json-stringify-deterministic$/,
        replacement: resolve(import.meta.dirname, "./src/lib/vendor/json-stringify-deterministic-browser-shim.ts"),
      },
    ],
  },
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
  server: {
    host: "0.0.0.0",
    port: 5173,
  },
  assetsInclude: ["**/*.wasm", "**/*.wasm.gz"],
  optimizeDeps: {
    // Aztec/zkPassport browser packages rely on import-meta asset resolution and worker loading.
    // Keeping these entrypoints out of Vite's dep optimizer preserves the package-authored
    // paths instead of rewriting them into broken `.vite/deps` URLs like `main.worker.js`.
    exclude: aztecBrowserDependencies,
    esbuildOptions: {
      target: "esnext",
    },
  },
  build: {
    target: "esnext",
  },
  test: {
    include: ["src/**/*.spec.ts"],
  },
});
