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
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value).toSorted()) {
      out[key] = normalize((value as Record<string, unknown>)[key], `${at}.${key}`);
    }
    return out;
  }
  throw new TypeError(`canonicalJson: unsupported ${typeof value} at ${at}`);
}
