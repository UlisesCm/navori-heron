// Covers: R16
import { describe, expect, test } from "bun:test";
import {
  COVERAGE_RULES,
  evaluateCoverage,
  parseLcov,
  type LcovFile,
} from "../../scripts/check-coverage.ts";

const file = (path: string, hit: number, found: number): LcovFile => ({
  path,
  linesFound: found,
  linesHit: hit,
  functionsFound: found,
  functionsHit: hit,
});

const healthy: LcovFile[] = [
  file("src/core/contracts/a.ts", 10, 10),
  file("src/core/state/b.ts", 10, 10),
  file("src/core/store/c.ts", 10, 10),
  file("src/security/d.ts", 10, 10),
  file("src/research/e.ts", 10, 10),
];

describe("evaluateCoverage", () => {
  test("fails a path under 90 percent and files never loaded", () => {
    const sources = healthy.map((f) => f.path);
    expect(evaluateCoverage(healthy, sources, COVERAGE_RULES).ok).toBe(true);

    const low = [file("src/core/contracts/a.ts", 8, 10), ...healthy.slice(1)];
    const lowReport = evaluateCoverage(low, sources, COVERAGE_RULES);
    expect(lowReport.ok).toBe(false);
    expect(lowReport.rules.map((r) => r.ok)).toEqual([false, true, true, true, true]);

    // exactly 90 percent passes; function ratio alone can fail
    const edge = [file("src/core/contracts/a.ts", 9, 10), ...healthy.slice(1)];
    expect(evaluateCoverage(edge, sources, COVERAGE_RULES).ok).toBe(true);
    // the new P2 prefixes are held to the same 90 percent
    for (const [index, prefix] of [
      [3, "src/security/"],
      [4, "src/research/"],
    ] as const) {
      const lowNew = healthy.map((f) => (f.path.startsWith(prefix) ? file(f.path, 8, 10) : f));
      const report = evaluateCoverage(lowNew, sources, COVERAGE_RULES);
      expect(report.rules.map((r) => r.rule.prefix)).toContain(prefix);
      expect(report.rules[index]?.ok).toBe(false);
      expect(report.ok).toBe(false);
    }
    const fnLow = [{ ...healthy[0]!, functionsHit: 1 }, ...healthy.slice(1)];
    expect(evaluateCoverage(fnLow, sources, COVERAGE_RULES).ok).toBe(false);

    const missing = evaluateCoverage(healthy, [...sources, "src/app/never.ts"], COVERAGE_RULES);
    expect(missing.ok).toBe(false);
    expect(missing.neverLoaded).toEqual(["src/app/never.ts"]);

    // a prefix with nothing found counts as 1.0
    expect(evaluateCoverage([], [], COVERAGE_RULES).ok).toBe(true);
  });

  test("parses lcov records and sums per prefix", () => {
    const lcov = [
      "SF:src/core/state/x.ts",
      "FNF:2",
      "FNH:1",
      "LF:10",
      "LH:9",
      "end_of_record",
      "SF:src/core/state/y.ts",
      "FNF:2",
      "FNH:2",
      "LF:10",
      "LH:10",
      "end_of_record",
      "",
    ].join("\n");
    const files = parseLcov(lcov);
    expect(files).toHaveLength(2);
    expect(files[0]).toEqual({
      path: "src/core/state/x.ts",
      linesFound: 10,
      linesHit: 9,
      functionsFound: 2,
      functionsHit: 1,
    });
    const report = evaluateCoverage(files, [], COVERAGE_RULES);
    expect(report.rules[1]?.lines).toBeCloseTo(0.95);
    expect(report.rules[1]?.functions).toBeCloseTo(0.75);
    expect(report.ok).toBe(false);
  });
});
