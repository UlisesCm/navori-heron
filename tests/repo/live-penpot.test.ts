// Covers: R18, R20
import { expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fixedContext } from "../helpers/cli.ts";

const ROOT = join(import.meta.dir, "..", "..");

test("keeps real Penpot connections out of the default test run", () => {
  const ctx = fixedContext();
  expect(() =>
    ctx.penpot.gateway.connect({
      baseUrl: "http://localhost:9001",
      key: "SYNTHETIC",
      timeoutMs: 1,
      clientVersion: "0.1.0",
      redact: (text) => text,
    }),
  ).toThrow("real Penpot connection in a default test");
});

test("keeps the live Penpot probe out of the default test run", async () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as {
    scripts: Record<string, string>;
  };
  expect(pkg.scripts["test:live:penpot"]).toBe("bun tests/live/penpot.live.ts");
  expect(pkg.scripts["test"]).toBe("bun test");
  expect(
    readdirSync(join(ROOT, "tests", "live")).every(
      (name) => !/\.(test|spec)\.[cm]?[jt]sx?$/.test(name),
    ),
  ).toBe(true);
  const source = readFileSync(join(ROOT, "tests/live/penpot.live.ts"), "utf8");
  expect(source).toContain('process.env["HERON_LIVE_PENPOT"] !== "1"');
  // No environment inherited: even an opt-in in the developer shell cannot activate this subprocess.
  const child = Bun.spawn(
    [process.execPath, "--no-env-file", "--config=/dev/null", "tests/live/penpot.live.ts"],
    {
      cwd: ROOT,
      env: {},
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  const [exit, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  expect(exit).toBe(0);
  expect(stdout).toContain("penpot.live: skipped");
  expect(stderr).toBe("");
}, 10_000); // Real subprocess startup, never a real Penpot connection.
