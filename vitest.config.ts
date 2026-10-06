import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [
      "packages/**/*.test.ts",
      "packages/**/*.spec.ts",
      "apps/mobile/src/presentation/**/*.test.ts",
    ],
    environment: "node",
    globals: false,
  },
});
