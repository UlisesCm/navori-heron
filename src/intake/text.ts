/** Drops inline Markdown emphasis markers: `**`, `__` and backticks. */
export function stripInline(text: string): string {
  return text.replaceAll("**", "").replaceAll("__", "").replaceAll("`", "");
}

/** Comparison form of a text (DR3): NFC, no inline markers, collapsed spaces, trimmed, one trailing "." dropped, lower case. */
export function normalizeText(text: string): string {
  const collapsed = stripInline(text.normalize("NFC")).replace(/\s+/g, " ").trim();
  const unterminated = collapsed.endsWith(".") ? collapsed.slice(0, -1).trimEnd() : collapsed;
  return unterminated.toLowerCase();
}

/** Replaces each `( … )` (up to the first `)`) with a space; an unclosed `(` is kept. One forward pass. */
function dropParentheses(text: string): string {
  let out = "";
  let from = 0;
  for (;;) {
    const open = text.indexOf("(", from);
    const close = open < 0 ? -1 : text.indexOf(")", open + 1);
    if (close < 0) return out + text.slice(from);
    out += `${text.slice(from, open)} `;
    from = close + 1;
  }
}

const PINNED_ID = /\bACT-[A-Z0-9]+(?:-[A-Z0-9]+)*\b/;

/** Matching keys of an actor or entity cell (DR21): NFKD without marks, lower case, no parentheses,
 * collapsed spaces, alternatives split on "/". An `ACT-*` id pinned in the cell is returned apart and
 * never becomes a key. */
export function actorKeys(cell: string): { keys: string[]; pinnedId: string | null } {
  const pinnedId = PINNED_ID.exec(cell)?.[0] ?? null;
  const withoutId = pinnedId === null ? cell : cell.replace(PINNED_ID, " ");
  const plain = dropParentheses(
    stripInline(withoutId).normalize("NFKD").replace(/\p{M}/gu, ""),
  ).toLowerCase();
  const keys = plain
    .split("/")
    .map((part) => part.replace(/\s+/g, " ").trim())
    .filter((part) => part.length > 0);
  return { keys: [...new Set(keys)], pinnedId };
}
