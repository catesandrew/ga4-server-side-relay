import { defineConfig } from "tsup";

export default defineConfig([
  {
    // Two separate entries in the same outDir so they build as two
    // separate output files: sw-script-loader's node:fs/node:url usage
    // must never end up bundled into index.js, which Edge middleware
    // imports via the ./server export (see sw-script-loader.ts's doc).
    entry: { index: "src/server/index.ts", "sw-script-loader": "src/server/sw-script-loader.ts" },
    outDir: "dist/server",
    format: ["esm"],
    dts: true,
    platform: "node",
    clean: true,
  },
  {
    entry: { index: "src/client/index.ts" },
    outDir: "dist/client",
    format: ["esm"],
    dts: true,
    platform: "browser",
  },
  {
    entry: { index: "src/sw/index.ts" },
    outDir: "dist/sw",
    format: ["esm"],
    dts: true,
    platform: "browser",
    tsconfig: "tsconfig.sw.json",
  },
]);
