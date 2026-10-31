import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, readFileSync } from "node:fs";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { nodePolyfills } from "vite-plugin-node-polyfills";

const appRoot = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(appRoot, "../..");

const aztecBrowserDependencies = [
  "@aztec/bb.js",
  "@aztec-foundation/bb.js",
  // The repository intentionally carries separate Noir runtime lanes:
  // beta.5 for zkEmail and beta.22 for the zkPassport wrappers. Prebundling
  // these bare specifiers can flatten a stale copy into the Instagram bundle.
  "@noir-lang/acvm_js",
  "@noir-lang/noir_js",
  "@noir-lang/noirc_abi",
  "@aztec-labs/accounts/testing",
  "@aztec-labs/aztec.js/abi",
  "@aztec-labs/aztec.js/account",
  "@aztec-labs/aztec.js/authorization",
  "@aztec-labs/aztec.js/contracts",
  "@aztec-labs/aztec.js/keys",
  "@aztec-labs/aztec.js/node",
  "@aztec-labs/aztec.js/addresses",
  "@aztec-labs/aztec.js/fields",
  "@aztec-labs/aztec.js/fee",
  "@aztec-labs/aztec.js/wallet",
  "@aztec-labs/entrypoints/account",
  "@aztec-labs/entrypoints/default",
  "@aztec-labs/entrypoints/interfaces",
  "@aztec-labs/entrypoints",
  "@aztec-labs/foundation/collection",
  "@aztec-labs/foundation/curves/bn254",
  "@aztec-labs/foundation/crypto/poseidon",
  "@aztec-labs/foundation/crypto/ecdsa",
  "@aztec-labs/foundation/log",
  "@aztec-labs/foundation/serialize",
  "@aztec-labs/foundation/types",
  "@aztec-labs/kv-store/sqlite-opfs",
  "@aztec-foundation/noir-acvm_js",
  "@aztec-foundation/noir-noirc_abi",
  "@aztec-labs/noir-contracts.js/Token",
  "@aztec-labs/pxe/client/lazy",
  "@aztec-labs/pxe/server",
  "@aztec-labs/stdlib/abi",
  "@aztec-labs/stdlib/errors",
  "@aztec-labs/stdlib/gas",
  "@aztec-labs/stdlib/interfaces/client",
  "@aztec-labs/stdlib/auth-witness",
  "@aztec-labs/stdlib/aztec-address",
  "@aztec-labs/stdlib/contract",
  "@aztec-labs/stdlib/hash",
  "@aztec-labs/stdlib/tx",
  "@aztec-labs/wallet-sdk/base-wallet",
  "@magna/contracts-bindings",
  "@aztec-labs/wallets/embedded",
];

const magnaWorkspaceDependencies = [
  "@magna/contracts-bindings",
  "@magna-protocol/core",
  "@magna/instagram-proof",
  "@magna/wallet",
];

const NOIR_WASM_BASENAMES = new Set(["acvm_js_bg.wasm", "noirc_abi_wasm_bg.wasm"]);
const NOIR_WASM_PACKAGE_PATH =
  /[/\\]node_modules[/\\](?:@aztec-foundation[/\\]noir-(?:acvm_js|noirc_abi)|@noir-lang[/\\](?:acvm_js|noirc_abi))[/\\](?:web|nodejs)[/\\](?:acvm_js_bg|noirc_abi_wasm_bg)\.wasm$/u;

export function resolveNoirWasmDevAsset(requestUrl) {
  const rawPathname = requestUrl ? requestUrl.split("?")[0] : "";
  let pathname;
  try {
    pathname = decodeURIComponent(rawPathname);
  } catch {
    return undefined;
  }
  const wasmName = pathname.split("/").pop();
  if (!wasmName || !NOIR_WASM_BASENAMES.has(wasmName)) return undefined;

  const candidate = pathname.startsWith("/@fs/")
    ? resolve("/", pathname.slice("/@fs/".length))
    : resolve(repoRoot, `.${pathname}`);
  if (!candidate.startsWith(`${repoRoot}/`) || !NOIR_WASM_PACKAGE_PATH.test(candidate) || !existsSync(candidate)) {
    return undefined;
  }
  return candidate;
}

function noirWasmDevAssets() {

  return {
    name: "noir-wasm-dev-assets",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const wasmPath = resolveNoirWasmDevAsset(request.url);
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
  envDir: process.env.MAGNA_ENV_DIR ? resolve(process.env.MAGNA_ENV_DIR) : appRoot,
  root: appRoot,
  publicDir: false,
  cacheDir: resolve(appRoot, "node_modules/.vite"),
  resolve: {
    alias: [
      {
        // @aztec-labs/kv-store uses this package-import alias in browser builds.
        // Route it through the ESM facade for msgpackr's CommonJS no-eval bundle.
        find: /^#msgpackr$/,
        replacement: resolve(
          repoRoot,
          "apps/magna-management/src/lib/vendor/msgpackr-no-eval-browser-shim.js",
        ),
      },
      {
        find: /^punycode\/$/,
        replacement: resolve(repoRoot, "node_modules/punycode/punycode.js"),
      },
      {
        find: /^pino$/,
        replacement: resolve(repoRoot, "apps/magna-management/src/lib/vendor/pino-browser-shim.ts"),
      },
      {
        find: /^sha3$/,
        replacement: resolve(repoRoot, "apps/magna-management/src/lib/vendor/sha3-browser-shim.ts"),
      },
      {
        find: /^hash\.js$/,
        replacement: resolve(repoRoot, "apps/magna-management/src/lib/vendor/hashjs-browser-shim.ts"),
      },
      {
        find: /^lodash\.chunk$/,
        replacement: resolve(repoRoot, "apps/magna-management/src/lib/vendor/lodash-chunk-browser-shim.ts"),
      },
      {
        find: /^lodash\.isequal$/,
        replacement: resolve(repoRoot, "apps/magna-management/src/lib/vendor/lodash-isequal-browser-shim.ts"),
      },
      {
        find: /^lodash\.times$/,
        replacement: resolve(repoRoot, "apps/magna-management/src/lib/vendor/lodash-times-browser-shim.ts"),
      },
      {
        find: /^json-stringify-deterministic$/,
        replacement: resolve(repoRoot, "apps/magna-management/src/lib/vendor/json-stringify-deterministic-browser-shim.ts"),
      },
    ],
  },
  plugins: [
    react(),
    noirWasmDevAssets(),
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
  ssr: {
    // Vitest otherwise externalizes this ESM browser shim and Node tries to
    // execute its non-standard `punycode/` directory import directly.
    noExternal: ["node-stdlib-browser"],
  },
  optimizeDeps: {
    // Aztec/Noir browser packages rely on package-authored worker and WASM URLs.
    // Pre-bundling rewrites those to broken `.vite/deps/main.worker.js` URLs in dev.
    // Magna workspace packages are also excluded so local dist rebuilds are not
    // hidden behind a stale Vite dependency cache during wallet-flow debugging.
    exclude: [...aztecBrowserDependencies, ...magnaWorkspaceDependencies],
    // @aztec-labs/kv-store maps its browser-only #msgpackr import to the CommonJS
    // no-eval build. Because the parent Aztec entrypoints are excluded above,
    // Vite would otherwise serve that CJS file directly and named imports such
    // as `Encoder` would fail in the browser. Pre-bundle only this leaf module
    // so it is converted to ESM while preserving Aztec's no-eval selection.
    include: ["msgpackr/index-no-eval"],
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
