// Covers: R12
import { describe, expect, test } from "bun:test";
import {
  checkContrast,
  CONTRAST_THRESHOLDS,
  contrastRatio,
  parseHexColor,
} from "../../../src/tokens/contrast.ts";

describe("contrast", () => {
  test("computes WCAG 2.2 contrast ratios for sRGB hex pairs", () => {
    expect(contrastRatio("#000000", "#FFFFFF")).toBeCloseTo(21, 2);
    expect(contrastRatio("#FFFFFF", "#000000")).toBeCloseTo(21, 2);
    expect(contrastRatio("#767676", "#FFFFFF")).toBeCloseTo(4.54, 2);
    expect(contrastRatio("#777777", "#ffffff")).toBeCloseTo(4.48, 2);
    expect(contrastRatio("#123456", "#123456")).toBe(1);

    expect(parseHexColor("#0a0B0c")).toEqual({ r: 10, g: 11, b: 12 });
    for (const bad of ["000000", "#000", "#00000G", "#0000000", ""]) {
      expect(parseHexColor(bad)).toBeNull();
      expect(contrastRatio(bad, "#FFFFFF")).toBeNull();
      expect(checkContrast("#000000", bad, "body-text")).toBeNull();
    }

    expect(CONTRAST_THRESHOLDS).toEqual({
      "body-text": 4.5,
      "large-text": 3,
      "ui-component": 3,
      "focus-indicator": 3,
    });
    expect(checkContrast("#767676", "#FFFFFF", "body-text")).toEqual({
      ratio: 4.54,
      threshold: 4.5,
      passes: true,
    });
    // 4.48 fails body text but passes the 3:1 usages
    expect(checkContrast("#777777", "#FFFFFF", "body-text")?.passes).toBe(false);
    expect(checkContrast("#777777", "#FFFFFF", "ui-component")?.passes).toBe(true);
    // the stored ratio is rounded, `passes` is not: just under 3 (2.996) is stored as 3 yet fails
    const near = checkContrast("#949494", "#FFFFFF", "large-text");
    expect(near).toEqual({ ratio: 3.03, threshold: 3, passes: true });
    const under = checkContrast("#959595", "#FFFFFF", "large-text");
    expect(under?.passes).toBe(false);
    expect(under?.ratio).toBe(3);
  });
});
