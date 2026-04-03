import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.spec.ts"],
    // Let Node load Aztec packages directly. This avoids Vite parser
    // choking on legacy JSON import assertions used by upstream deps.
    server: {
      deps: {
        external: [/^@aztec\//],
      },
    },
  },
});
