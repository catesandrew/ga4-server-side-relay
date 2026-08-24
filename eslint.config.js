import tseslint from "typescript-eslint";

// Enforces the client/server entrypoint boundary from plan step 1.13:
// nothing reachable from src/client/** or src/sw/** may import a
// server-only module (token/mp-client/store/secret-touching code).
export default tseslint.config({
  files: ["packages/ga4-relay/src/client/**/*.ts", "packages/ga4-relay/src/sw/**/*.ts"],
  languageOptions: {
    parser: tseslint.parser,
  },
  rules: {
    "no-restricted-imports": [
      "error",
      {
        patterns: [
          {
            group: ["**/server/**", "*/server/*", "../server/*", "../../server/*"],
            message:
              "Client/SW bundles must never import server-only modules (token/mp-client/store) — see plan step 1.13.",
          },
        ],
      },
    ],
  },
});
