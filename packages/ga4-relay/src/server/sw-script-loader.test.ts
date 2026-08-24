import { describe, expect, it, vi } from "vitest";

vi.mock("node:fs/promises", () => ({
  readFile: vi.fn().mockResolvedValue("// bundled sw script"),
}));

describe("sw-script-loader.ts", () => {
  it("reads dist/sw/index.js relative to its own module and caches the result", async () => {
    const fsPromises = await import("node:fs/promises");
    const { loadBundledSwScript } = await import("./sw-script-loader.js");

    const first = await loadBundledSwScript();
    const second = await loadBundledSwScript();

    expect(first).toBe("// bundled sw script");
    expect(second).toBe("// bundled sw script");
    expect(fsPromises.readFile).toHaveBeenCalledTimes(1);
    const calledPath = vi.mocked(fsPromises.readFile).mock.calls[0]?.[0] as string;
    expect(calledPath.endsWith("sw/index.js")).toBe(true);
  });
});
