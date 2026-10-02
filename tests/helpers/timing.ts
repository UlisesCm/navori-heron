const MIN_BASELINE_MS = 10;

/**
 * Maximum accepted growth ratio for a 16x larger input. Linear work gives ~16, quadratic ~256;
 * 64 is the geometric middle (4x of margin on each side), so scheduler noise under heavy
 * machine load (which can inflate a single sample by 2-3x) cannot flip the verdict.
 */
export const GROWTH_LIMIT_16X = 64;

/**
 * Growth ratio t(large) / t(small), load-independent. Runs are interleaved
 * (small, large, small, large, ...) so a load spike hits both sides alike, and each side
 * takes the minimum over `reps` runs. The small side is floored at 10 ms: that can only
 * lower the ratio of a fast linear run, while a quadratic `large` stays far above the limit.
 * Use inputs 16x apart and compare against {@link GROWTH_LIMIT_16X}.
 */
export function growthRatio(
  small: () => void,
  large: () => void,
  reps = 5,
): { ratio: number; smallMs: number; largeMs: number } {
  let smallMs = Number.POSITIVE_INFINITY;
  let largeMs = Number.POSITIVE_INFINITY;
  for (let i = 0; i < reps; i++) {
    let started = performance.now();
    small();
    smallMs = Math.min(smallMs, performance.now() - started);
    started = performance.now();
    large();
    largeMs = Math.min(largeMs, performance.now() - started);
  }
  return { ratio: largeMs / Math.max(smallMs, MIN_BASELINE_MS), smallMs, largeMs };
}
