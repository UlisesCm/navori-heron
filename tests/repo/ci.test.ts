// Covers: R16
import { describe, expect, test } from "bun:test";

const root = new URL("../../", import.meta.url);

/** Text of one top-level job of the workflow (from `  <name>:` to the next job or EOF). */
function job(yml: string, name: string): string {
  const start = yml.indexOf(`\n  ${name}:\n`);
  expect(start).toBeGreaterThan(-1);
  const rest = yml.slice(start + 1);
  const next = rest.slice(1).search(/\n {2}[a-z][\w-]*:\n/);
  return next === -1 ? rest : rest.slice(0, next + 1);
}

describe("ci workflow", () => {
  test("ci workflow runs the quality gate on pull requests and main", async () => {
    const yml = await Bun.file(new URL(".github/workflows/ci.yml", root)).text();
    const pkg = (await Bun.file(new URL("package.json", root)).json()) as {
      scripts: Record<string, string>;
    };
    expect(yml).toMatch(
      /^on:\n {2}pull_request:\n {4}branches: \[develop, main\]\n {2}push:\n {4}branches: \[main\]$/m,
    );
    // the full gate runs only for main (PR to main or push to main), step by step
    const check = job(yml, "check");
    expect(check).toContain("github.event_name == 'push' || github.base_ref == 'main'");
    expect(check).toContain("bun install --frozen-lockfile");
    const order = [
      "bun run format:check",
      "bun run lint",
      "bun run typecheck",
      "bun run test:coverage",
      "bun run test:perf",
    ].map((step) => check.indexOf(step));
    expect(order.every((i) => i > -1)).toBe(true);
    expect(order.toSorted((a, b) => a - b)).toEqual(order);
    // the wall-clock p95 suite (RNF-1) is its own mandatory CI step, not part of `check`
    expect(pkg.scripts["test:perf"]).toContain("tests/perf");
    expect(pkg.scripts["check"]).not.toContain("test:perf");
    // PRs to develop run ONLY the dup + security scans, with the former hooks' configuration
    for (const name of ["jscpd", "semgrep"]) {
      expect(job(yml, name)).toContain(
        "github.event_name == 'pull_request' && github.base_ref == 'develop'",
      );
    }
    const jscpd = job(yml, "jscpd");
    expect(jscpd).toMatch(/bunx jscpd@\d+\.\d+\.\d+ /);
    expect(jscpd).toContain("--min-tokens 100");
    expect(jscpd).toContain("--min-lines 10");
    expect(jscpd).toContain("--fail-on-new-clones 0");
    const semgrep = job(yml, "semgrep");
    expect(semgrep).toMatch(/image: semgrep\/semgrep:\d+\.\d+\.\d+@sha256:[0-9a-f]{64}/);
    expect(semgrep).toContain("--config=p/default");
    expect(semgrep).toContain("--error");
    expect(semgrep).toContain("--metrics=off");
    for (const gate of ["format:check", "lint", "typecheck", "test:coverage", "test:perf"]) {
      expect(jscpd + semgrep).not.toContain(`bun run ${gate}`);
    }
    // every `uses:` is pinned by a full 40-hex commit SHA
    const uses = [...yml.matchAll(/uses:\s*(\S+)/g)].map((m) => m[1] ?? "");
    expect(uses.length).toBeGreaterThan(0);
    for (const u of uses) expect(u).toMatch(/@[0-9a-f]{40}$/);
  });

  test("pre-commit gate is fast: no coverage, perf, jscpd or semgrep", async () => {
    const pkg = (await Bun.file(new URL("package.json", root)).json()) as {
      scripts: Record<string, string>;
    };
    const cfg = (await Bun.file(new URL("navori.config.json", root)).json()) as {
      qualityGate: { fast: string; full: string };
      plugins: Record<string, { enabled: boolean }>;
    };
    expect(cfg.qualityGate.fast).toBe("bun run check:fast");
    expect(cfg.qualityGate.full).toBe("bun run check");
    const fast = pkg.scripts["check:fast"] ?? "";
    expect(fast.split(" && ")).toEqual([
      "bun run format:check",
      "bun run lint",
      "bun run typecheck",
      "bun run test:staged",
    ]);
    expect(fast).not.toMatch(/coverage|perf|jscpd|semgrep/);
    // jscpd and semgrep run in CI, not as PreToolUse hooks
    expect(cfg.plugins["jscpd"]?.enabled).toBe(false);
    expect(cfg.plugins["semgrep"]?.enabled).toBe(false);
    const settings = await Bun.file(new URL(".claude/settings.json", root)).text();
    expect(settings).not.toMatch(/check-jscpd|check-semgrep/);
  });
});
