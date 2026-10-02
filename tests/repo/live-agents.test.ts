import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { ProcessSpec } from "../../src/agents/ports.ts";
import { fixedContext } from "../helpers/cli.ts";

const ROOT = join(import.meta.dir, "..", "..");
const spec: ProcessSpec = {
  command: "claude",
  args: [],
  cwd: ROOT,
  env: {},
  stdin: null,
  timeoutMs: 1_000,
  killGraceMs: 100,
  maxOutputBytes: 1_000,
  captureStdout: true,
};

describe("live agents", () => {
  test("keeps real agent CLIs out of the default test run", () => {
    // Covers: R1
    const ctx = fixedContext();
    expect(() => ctx.agents.runner.run(spec)).toThrow("refusingRunner");
    expect(Object.keys(ctx.agents.providers)).toEqual(["fake"]);
    expect(ctx.env).toEqual({});

    // The live probe lives outside bun's `*.test.ts` glob and is opt-in by variable and script.
    const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts["test:live"]).toBe("bun tests/live/agents.live.ts");
    expect(pkg.scripts["test"]).toBe("bun test");
    const live = readdirSync(join(ROOT, "tests", "live"));
    expect(live.every((name) => !/\.(test|spec)\.[cm]?[jt]sx?$/.test(name))).toBe(true);
    expect(readFileSync(join(ROOT, "tests", "live", "agents.live.ts"), "utf8")).toContain(
      'process.env["HERON_LIVE_AGENTS"] !== "1"',
    );
  });
});
