import { readFileSync } from "node:fs";

export type CoverageRule = { prefix: string; lines: number; functions: number };

/** src/core/contracts/, src/core/state/, src/core/store/, src/security/, src/research/, src/tokens/ and src/agents/ at 0.9 lines and functions.
 * The global 0.8 lives in bunfig.toml. */
export const COVERAGE_RULES: readonly CoverageRule[] = [
  { prefix: "src/core/contracts/", lines: 0.9, functions: 0.9 },
  { prefix: "src/core/state/", lines: 0.9, functions: 0.9 },
  { prefix: "src/core/store/", lines: 0.9, functions: 0.9 },
  { prefix: "src/security/", lines: 0.9, functions: 0.9 },
  { prefix: "src/research/", lines: 0.9, functions: 0.9 },
  { prefix: "src/tokens/", lines: 0.9, functions: 0.9 },
  { prefix: "src/agents/", lines: 0.9, functions: 0.9 },
];

export type LcovFile = {
  path: string;
  linesFound: number;
  linesHit: number;
  functionsFound: number;
  functionsHit: number;
};

export type CoverageReport = {
  ok: boolean;
  rules: { rule: CoverageRule; lines: number; functions: number; ok: boolean }[];
  /** src/**\/*.ts with runtime code absent from lcov. */
  neverLoaded: string[];
};

const toPosix = (path: string): string => path.replaceAll("\\", "/").replace(/^\.\//, "");

/** Parses lcov text (SF/LF/LH/FNF/FNH records) into one entry per source file. */
export function parseLcov(lcov: string): LcovFile[] {
  const files: LcovFile[] = [];
  let current: LcovFile | null = null;
  for (const raw of lcov.split("\n")) {
    const line = raw.trim();
    if (line.startsWith("SF:")) {
      current = {
        path: toPosix(line.slice(3)),
        linesFound: 0,
        linesHit: 0,
        functionsFound: 0,
        functionsHit: 0,
      };
    } else if (current !== null) {
      const value = Number(line.slice(line.indexOf(":") + 1));
      if (line.startsWith("LF:")) current.linesFound = value;
      else if (line.startsWith("LH:")) current.linesHit = value;
      else if (line.startsWith("FNF:")) current.functionsFound = value;
      else if (line.startsWith("FNH:")) current.functionsHit = value;
      else if (line === "end_of_record") {
        files.push(current);
        current = null;
      }
    }
  }
  return files;
}

const ratio = (hit: number, found: number): number => (found === 0 ? 1 : hit / found);

/** runtimeSources: src/**\/*.ts whose Bun.Transpiler output is non-empty. Ratios sum LF/LH and FNF/FNH per prefix;
 * a prefix with 0 found counts as 1.0. */
export function evaluateCoverage(
  files: readonly LcovFile[],
  runtimeSources: readonly string[],
  rules: readonly CoverageRule[],
): CoverageReport {
  const results = rules.map((rule) => {
    const scoped = files.filter((file) => file.path.startsWith(rule.prefix));
    const sum = (pick: (file: LcovFile) => number): number =>
      scoped.reduce((total, file) => total + pick(file), 0);
    const lines = ratio(
      sum((f) => f.linesHit),
      sum((f) => f.linesFound),
    );
    const functions = ratio(
      sum((f) => f.functionsHit),
      sum((f) => f.functionsFound),
    );
    return { rule, lines, functions, ok: lines >= rule.lines && functions >= rule.functions };
  });
  const loaded = new Set(files.map((file) => file.path));
  const neverLoaded = runtimeSources
    .map(toPosix)
    .filter((path) => !loaded.has(path))
    .toSorted();
  return {
    ok: neverLoaded.length === 0 && results.every((r) => r.ok),
    rules: results,
    neverLoaded,
  };
}

/** src/**\/*.ts (repo-relative) whose transpiled output is non-empty, i.e. files with runtime code. */
export function listRuntimeSources(root: string): string[] {
  const transpiler = new Bun.Transpiler({ loader: "ts" });
  const out: string[] = [];
  for (const file of new Bun.Glob("src/**/*.ts").scanSync({ cwd: root, onlyFiles: true })) {
    const source = readFileSync(`${root}/${file}`, "utf8");
    if (transpiler.transformSync(source).trim() !== "") out.push(toPosix(file));
  }
  return out.toSorted();
}

const pct = (value: number): string => `${(value * 100).toFixed(1)}%`;

if (import.meta.main) {
  const root = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
  const report = evaluateCoverage(
    parseLcov(readFileSync(`${root}/coverage/lcov.info`, "utf8")),
    listRuntimeSources(root),
    COVERAGE_RULES,
  );
  for (const r of report.rules) {
    console.log(
      `${r.ok ? "ok  " : "FAIL"} ${r.rule.prefix} lines ${pct(r.lines)} (min ${pct(r.rule.lines)}) functions ${pct(r.functions)} (min ${pct(r.rule.functions)})`,
    );
  }
  for (const path of report.neverLoaded) console.log(`FAIL never loaded by any test: ${path}`);
  process.exit(report.ok ? 0 : 1);
}
