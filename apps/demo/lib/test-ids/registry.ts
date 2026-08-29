/**
 * Shared registry helper for building a typed data-testid catalog.
 *
 * A catalog module calls `createTestIdRegistry` with a nested object of
 * string leaf values (grouped by view/section) and gets back the same
 * object typed `as const`. In development, every leaf string is checked for
 * uniqueness across the entire nested structure — a duplicate id string
 * anywhere throws a clear error listing the offending duplicates, so a
 * copy-pasted id surfaces immediately instead of silently shadowing another
 * element later.
 */

type Leaf = string | ((...args: any[]) => string);

type TestIdTree = {
  [key: string]: Leaf | TestIdTree;
};

function collectLiteralLeaves(node: TestIdTree, path: string[], out: Map<string, string[]>) {
  for (const [key, value] of Object.entries(node)) {
    const nextPath = [...path, key];
    if (typeof value === "string") {
      const existing = out.get(value);
      if (existing) {
        existing.push(nextPath.join("."));
      } else {
        out.set(value, [nextPath.join(".")]);
      }
    } else if (typeof value === "function") {
      // Functions produce dynamic ids (e.g. per-row prefix-${id}) and are
      // intentionally excluded from the static uniqueness check — their
      // output is only known at render time.
      continue;
    } else if (value && typeof value === "object") {
      collectLiteralLeaves(value, nextPath, out);
    }
  }
}

/**
 * Validates a nested test-id catalog for duplicate literal string leaves
 * and returns it typed `as const`. Validation only runs when
 * `process.env.NODE_ENV === 'development'` so production and CI builds pay
 * no runtime cost.
 */
export function createTestIdRegistry<const T extends TestIdTree>(catalog: T): T {
  if (process.env.NODE_ENV === "development") {
    const seen = new Map<string, string[]>();
    collectLiteralLeaves(catalog, [], seen);

    const duplicates = Array.from(seen.entries()).filter(([, paths]) => paths.length > 1);

    if (duplicates.length > 0) {
      const lines = duplicates.map(([value, paths]) => `  "${value}" used at: ${paths.join(", ")}`);
      throw new Error(`Duplicate data-testid values found:\n${lines.join("\n")}`);
    }
  }

  return catalog;
}

/**
 * Derives a union of every literal string leaf value in a catalog tree —
 * useful for typing a helper that accepts "any known test id".
 */
export type TestIdValues<T> = T extends string
  ? T
  : T extends (...args: any[]) => infer R
    ? R
    : T extends object
      ? { [K in keyof T]: TestIdValues<T[K]> }[keyof T]
      : never;
