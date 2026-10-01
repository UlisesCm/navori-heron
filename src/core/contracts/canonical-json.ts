/** Keys sorted by UTF-16 code unit at every depth, array order kept, 2-space indent, "\n" at EOF.
 * Throws TypeError on undefined, functions, symbols, bigint, NaN or Infinity. */
export function canonicalJson(value: unknown): string {
  return `${JSON.stringify(normalize(value, "$"), null, 2)}\n`;
}

function normalize(value: unknown, at: string): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError(`canonicalJson: non-finite number at ${at}`);
    return value;
  }
  if (Array.isArray(value)) return value.map((v, i) => normalize(v, `${at}[${i}]`));
  if (typeof value === "object") {
    // Own data properties (not `out[key] = …`): a "__proto__" key must stay a key (DR25).
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value).toSorted()) {
      Object.defineProperty(out, key, {
        value: normalize((value as Record<string, unknown>)[key], `${at}.${key}`),
        enumerable: true,
        writable: true,
        configurable: true,
      });
    }
    return out;
  }
  throw new TypeError(`canonicalJson: unsupported ${typeof value} at ${at}`);
}
