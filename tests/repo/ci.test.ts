// Covers: R16
import { describe, expect, test } from "bun:test";

const root = new URL("../../", import.meta.url);

describe("ci workflow", () => {
  test("ci workflow runs the quality gate on pull requests and main", async () => {
    const yml = await Bun.file(new URL(".github/workflows/ci.yml", root)).text();
    const pkg = (await Bun.file(new URL("package.json", root)).json()) as {
      scripts: Record<string, string>;
    };
    expect(yml).toMatch(/^on:\n {2}pull_request:\n {2}push:\n {4}branches: \[main\]$/m);
    expect(yml).toContain("bun install --frozen-lockfile");
    expect(yml).toContain("bun run check");
    expect(pkg.scripts["check"]).toBeString();
    // the wall-clock p95 suite (RNF-1) is its own mandatory CI step after `check`, not part of it
    expect(yml.indexOf("bun run test:perf")).toBeGreaterThan(yml.indexOf("bun run check"));
    expect(pkg.scripts["test:perf"]).toContain("tests/perf");
    expect(pkg.scripts["check"]).not.toContain("test:perf");
    // every `uses:` is pinned by a full 40-hex commit SHA
    const uses = [...yml.matchAll(/uses:\s*(\S+)/g)].map((m) => m[1] ?? "");
    expect(uses.length).toBeGreaterThan(0);
    for (const u of uses) expect(u).toMatch(/@[0-9a-f]{40}$/);
  });
});
