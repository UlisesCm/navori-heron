const SPECIAL = new Set(["\\", "`", "*", "_", "[", "]", "<", ">", "#", "|", "!", "~"]);

/** CR/LF/TAB -> " "; escapes \ ` * _ [ ] < > # | ! ~ with a backslash and & as &amp;; never emits raw HTML.
 * GFM autolink literals are broken with a backslash that keeps the visible text: "http://", "https://" -> "http\://",
 * "https\://" (case-insensitive) and "www." -> "www\.". A list marker at the start of the (flattened) text
 * ("-", "+", "*", "1.", "1)" followed by a space or the end) gets its marker character escaped ("- " -> "\- ",
 * "1. " -> "1\. "); "*" and "#" are already escaped by SPECIAL. */
export function escapeMarkdownText(text: string): string {
  let out = "";
  for (const char of text) {
    if (char === "\r" || char === "\n" || char === "\t") out += " ";
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
