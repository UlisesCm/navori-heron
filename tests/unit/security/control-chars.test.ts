// Covers: R13
import { describe, expect, test } from "bun:test";
import { safeText } from "../../../src/cli/render-research.ts";
import { escapeMarkdownText } from "../../../src/security/markdown.ts";
import { HOSTILE_CONTROLS, hasControlChars, hostileText } from "../../helpers/hostile-controls.ts";

describe("terminal-escape control characters", () => {
  test("escapeMarkdownText removes every C0 (but flattens CR/LF/TAB), DEL and C1", () => {
    for (const payload of Object.values(HOSTILE_CONTROLS)) {
      expect(hasControlChars(escapeMarkdownText(`x${payload}y`))).toBe(false);
    }
    expect(hasControlChars(escapeMarkdownText(hostileText()))).toBe(false);
    expect(escapeMarkdownText(`a${HOSTILE_CONTROLS.clearScreen}b`)).toBe("a\\[2Jb");
    expect(escapeMarkdownText(`a${HOSTILE_CONTROLS.c1Csi}b`)).toBe("a31mb");
    expect(escapeMarkdownText(`a${HOSTILE_CONTROLS.nul}${HOSTILE_CONTROLS.bel}b\tc`)).toBe("ab c");
  });

  test("safeText shows C0, DEL and C1 as \\xNN", () => {
    expect(hasControlChars(safeText(hostileText()))).toBe(false);
    expect(safeText(HOSTILE_CONTROLS.c1Csi)).toBe("\\x9b31m");
    expect(safeText(HOSTILE_CONTROLS.c1Edges)).toBe("\\x80\\x9f");
    expect(safeText(HOSTILE_CONTROLS.nul + HOSTILE_CONTROLS.del)).toBe("\\x00\\x7f");
    expect(safeText("plain áé 日本")).toBe("plain áé 日本");
  });
});
