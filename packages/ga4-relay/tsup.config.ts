import { defineConfig } from "tsup";

export default defineConfig([
  {
    entry: { index: "src/server/index.ts" },
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
