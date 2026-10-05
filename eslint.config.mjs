import js from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";
import expoConfig from "eslint-config-expo/flat.js";
import prettierConfig from "eslint-config-prettier/flat";
import tseslint from "typescript-eslint";

export default defineConfig([
  globalIgnores([
    "**/node_modules/**",
    "**/.expo/**",
    "**/dist/**",
    "**/coverage/**",
    "**/private/**",
    "statements/**",
  ]),
  {
    files: ["packages/**/*.ts"],
    extends: [js.configs.recommended, tseslint.configs.recommended],
  },
  {
    files: ["apps/mobile/**/*.{js,jsx,ts,tsx}"],
    extends: [expoConfig],
    // Bootstrap keeps syntax style and import placement out of lint policy.
    rules: {
      "import/first": "off",
      "@typescript-eslint/array-type": "off",
      "@typescript-eslint/consistent-type-assertions": "off",
    },
  },
  prettierConfig,
]);
