/** Terminal-escape payloads built from code points, so no invisible control character lives in source. */
const cp = (...codes: number[]): string => String.fromCodePoint(...codes);

export const ESC = cp(0x1b);
export const HOSTILE_CONTROLS = {
  clearScreen: `${ESC}[2J`,
  osc8: `${ESC}]8;;https://evil.example${cp(0x07)}click${ESC}]8;;${cp(0x07)}`,
  c1Csi: `${cp(0x9b)}31m`,
  bel: cp(0x07),
  nul: cp(0x00),
  del: cp(0x7f),
  c1Edges: `${cp(0x80)}${cp(0x9f)}`,
};

/** Text carrying every hostile control between words, so removal is checkable. */
export const hostileText = (): string => `a${Object.values(HOSTILE_CONTROLS).join("b")}c`;

/** True when `text` holds a C0 control other than LF/TAB, DEL or a C1 control. */
export const hasControlChars = (text: string): boolean =>
  [...text].some((ch) => {
    const code = ch.codePointAt(0) ?? 0;
    return (code < 0x20 && code !== 0x0a && code !== 0x09) || (code >= 0x7f && code <= 0x9f);
  });
