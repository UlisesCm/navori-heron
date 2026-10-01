import type { ContrastResult, PalettePairUsage } from "../core/contracts/index.ts";

/** Minimum ratios by usage (RNF-9; WCAG 2.2 SC 1.4.3 and 1.4.11). */
export const CONTRAST_THRESHOLDS: Readonly<Record<PalettePairUsage, number>> = {
  "body-text": 4.5,
  "large-text": 3,
  "ui-component": 3,
  "focus-indicator": 3,
};

export type Rgb = { r: number; g: number; b: number };

const HEX_RE = /^#([0-9A-Fa-f]{2})([0-9A-Fa-f]{2})([0-9A-Fa-f]{2})$/;

/** "#RRGGBB" or "#rrggbb" to 0-255 channels; null for any other text. */
export function parseHexColor(hex: string): Rgb | null {
  const match = HEX_RE.exec(hex);
  if (match === null) return null;
  const [, r, g, b] = match;
  return { r: parseInt(r!, 16), g: parseInt(g!, 16), b: parseInt(b!, 16) };
}

const linear = (channel: number): number => {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};

/** WCAG 2.2 relative luminance of an sRGB color (0-255 channels). */
export function relativeLuminance(rgb: Rgb): number {
  return 0.2126 * linear(rgb.r) + 0.7152 * linear(rgb.g) + 0.0722 * linear(rgb.b);
}

/** Unrounded WCAG contrast ratio (1..21); null when either color is not "#RRGGBB". */
export function contrastRatio(foregroundHex: string, backgroundHex: string): number | null {
  const fg = parseHexColor(foregroundHex);
  const bg = parseHexColor(backgroundHex);
  if (fg === null || bg === null) return null;
  const a = relativeLuminance(fg);
  const b = relativeLuminance(bg);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/** DR11: `passes` uses the unrounded ratio (4.499 fails 4.5); `ratio` is stored with 2 decimals, half-up. */
export function checkContrast(
  foregroundHex: string,
  backgroundHex: string,
  usage: PalettePairUsage,
): ContrastResult | null {
  const ratio = contrastRatio(foregroundHex, backgroundHex);
  if (ratio === null) return null;
  const threshold = CONTRAST_THRESHOLDS[usage];
  return { ratio: Math.round(ratio * 100) / 100, threshold, passes: ratio >= threshold };
}
