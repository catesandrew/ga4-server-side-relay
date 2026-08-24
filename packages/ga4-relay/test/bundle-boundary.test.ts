import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// AC8: the built ./client and ./sw bundles must never contain server-only
// secret-touching identifiers. This greps the ACTUAL dist output (built by
// `pnpm --filter ga4-relay build` before this test runs), not source —
// a detection control complementing the ESLint import-boundary rule
// (build-time prevention) from plan step 1.13.
const CANARY_TOKENS = ["signPayload", "verifySignature", "hmacKey", "UpstashStore", "apiSecret", "tokenSecret"];

function readBundle(relativePath: string): string {
  return readFileSync(join(import.meta.dirname, "..", relativePath), "utf8");
}

function listJsFiles(dir: string): string[] {
  return readdirSync(join(import.meta.dirname, "..", dir))
    .filter((f) => f.endsWith(".js"))
    .map((f) => join(dir, f));
}

describe("bundle boundary (AC8)", () => {
  it("the client bundle contains none of the server-secret-touching identifiers", () => {
    for (const file of listJsFiles("dist/client")) {
      const source = readBundle(file);
      for (const token of CANARY_TOKENS) {
        expect(source, `${file} must not reference "${token}"`).not.toContain(token);
      }
    }
  });

  it("the sw bundle contains none of the server-secret-touching identifiers", () => {
    for (const file of listJsFiles("dist/sw")) {
      const source = readBundle(file);
      for (const token of CANARY_TOKENS) {
        expect(source, `${file} must not reference "${token}"`).not.toContain(token);
      }
    }
  });
});
