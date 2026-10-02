const SPECIAL = new Set(["\\", "`", "*", "_", "[", "]", "<", ">", "#", "|", "!", "~"]);

/** C0 (CR/LF/TAB excluded), DEL and C1: terminal-escape material, never kept in a text. */
const isControl = (char: string): boolean => {
  const code = char.codePointAt(0) ?? 0;
  return code < 0x20 || (code >= 0x7f && code <= 0x9f);
};

/** CR/LF/TAB -> " "; every other C0 control, DEL and C1 are removed; escapes \ ` * _ [ ] < > # | ! ~ with a backslash and & as &amp;; never emits raw HTML.
 * GFM autolink literals are broken with a backslash that keeps the visible text: "http://", "https://" -> "http\://",
 * "https\://" (case-insensitive) and "www." -> "www\.". A list marker at the start of the (flattened) text
 * ("-", "+", "*", "1.", "1)" followed by a space or the end) gets its marker character escaped ("- " -> "\- ",
 * "1. " -> "1\. "); "*" and "#" are already escaped by SPECIAL. */
export function escapeMarkdownText(text: string): string {
  let out = "";
  for (const char of text) {
    if (char === "\r" || char === "\n" || char === "\t") out += " ";
    else if (isControl(char)) continue;
    else if (char === "&") out += "&amp;";
    else out += SPECIAL.has(char) ? `\\${char}` : char;
  }
  return out
    .replace(/(https?):\/\//gi, "$1\\://")
    .replace(/www\./gi, (match) => `${match.slice(0, 3)}\\.`)
    .replace(/^( {0,3})([-+]|\d{1,9}[.)])(?= |$)/, (_m, space: string, marker: string) => {
      const last = marker.length - 1;
      return `${space}${marker.slice(0, last)}\\${marker.slice(last)}`;
    });
}
