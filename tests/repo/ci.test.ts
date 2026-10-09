// Covers: R16
import { describe, expect, test } from "bun:test";

const root = new URL("../../", import.meta.url);

type GatePackage = {
  scripts: Record<string, string>;
  devDependencies: Record<string, string>;
  "simple-git-hooks": { "pre-commit": string };
};

describe("ci workflow", () => {
  test("ci workflow runs the same quality gate on pull requests and main", async () => {
    const yml = await Bun.file(new URL(".github/workflows/ci.yml", root)).text();
    const pkg = (await Bun.file(new URL("package.json", root)).json()) as GatePackage;
    expect(yml).toMatch(
      /^on:\n {2}pull_request:\n {4}branches: \[develop, main\]\n {2}push:\n {4}branches: \[main\]$/m,
    );
    expect(yml).toContain("bun install --frozen-lockfile");
    expect(yml).toContain("bun run check");
    expect(yml).not.toMatch(/semgrep|bunx jscpd|test:coverage|test:perf|github\.base_ref/);
    expect(pkg.scripts["check"]).toBe(
      "bun run format:check && bun run lint && bun run typecheck && bun run check:duplicates && bun run check:ast",
    );
    expect(pkg.devDependencies["jscpd"]).toMatch(/^\d+\.\d+\.\d+$/);
    expect(pkg.devDependencies["@ast-grep/cli"]).toMatch(/^\d+\.\d+\.\d+$/);
    const uses = [...yml.matchAll(/uses:\s*(\S+)/g)].map((match) => match[1] ?? "");
    expect(uses.length).toBeGreaterThan(0);
    for (const action of uses) expect(action).toMatch(/@[0-9a-f]{40}$/);
  });

  test("native pre-commit owns the gate without harness scanner hooks", async () => {
    const pkg = (await Bun.file(new URL("package.json", root)).json()) as GatePackage;
    expect(pkg["simple-git-hooks"]["pre-commit"]).toBe("bun run check");
    expect(pkg.scripts["check:fast"]).toBe("bun run check");
    for (const engine of ["claude", "codex"]) {
      const path = engine === "claude" ? ".claude/settings.json" : ".codex/config.toml";
      const file = Bun.file(new URL(path, root));
      if (!(await file.exists())) continue;
      const settings = await file.text();
      expect(settings).not.toMatch(/check-jscpd|check-semgrep|quality-gate-pre-commit/);
    }
    const config = (await Bun.file(new URL("navori.config.json", root)).json()) as {
      qualityGate?: unknown;
      plugins: Record<string, unknown>;
    };
    expect(config.qualityGate).toBeUndefined();
    expect(config.plugins["jscpd"]).toBeUndefined();
    expect(config.plugins["semgrep"]).toBeUndefined();
  });
});
