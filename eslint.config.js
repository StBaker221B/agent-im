import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";

const shared = {
  ecmaVersion: "latest",
  sourceType: "module",
};

export default [
  {
    ignores: ["**/node_modules/**", "web/dist/**", "app/data/**", "spike/.tmp/**", "spike/node_modules/**"],
  },
  {
    files: ["app/**/*.mjs"],
    ...js.configs.recommended,
    languageOptions: {
      parserOptions: shared,
      globals: { ...globals.node },
    },
    rules: {
      ...js.configs.recommended.rules,
      "no-unused-vars": ["error", { argsIgnorePattern: "^_", caughtErrors: "none" }],
    },
  },
  {
    files: ["bench/**/*.mjs"],
    ...js.configs.recommended,
    languageOptions: {
      parserOptions: shared,
      globals: { ...globals.node },
    },
    rules: {
      ...js.configs.recommended.rules,
      "no-unused-vars": ["error", { argsIgnorePattern: "^_", caughtErrors: "none" }],
    },
  },
  {
    files: ["web/src/**/*.{js,jsx}", "web/vite.config.js"],
    ...js.configs.recommended,
    languageOptions: {
      parserOptions: { ...shared, ecmaFeatures: { jsx: true } },
      globals: { ...globals.browser },
    },
    plugins: { "react-hooks": reactHooks },
    rules: {
      ...js.configs.recommended.rules,
      ...(reactHooks.configs?.recommended?.rules ?? {}),
      "react-hooks/exhaustive-deps": "warn",
      // We intentionally sync a few UI states from props/polling in effects
      // (pending agents, read markers, message merge). The rule is advisory in
      // React 19 and would force extra derived-state plumbing for no gain here.
      "react-hooks/set-state-in-effect": "off",
      "no-unused-vars": ["error", { argsIgnorePattern: "^_", caughtErrors: "none" }],
    },
  },
  {
    files: ["web/vite.config.js"],
    languageOptions: { globals: { ...globals.node } },
  },
];
