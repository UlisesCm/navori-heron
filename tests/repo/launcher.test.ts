// Covers: R22
import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pkg from "../../package.json" with { type: "json" };

const launcher = new URL("../../bin/heron.ts", import.meta.url).pathname;
const scratch = realpathSync(mkdtempSync(join(tmpdir(), "heron-launcher-")));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

describe("launcher", () => {
  test("shebang ignores the cwd's bunfig.toml and .env", async () => {
    const first = (await Bun.file(launcher).text()).split("\n")[0];
    expect(first).toBe("#!/usr/bin/env -S bun --no-env-file --config=/dev/null");
    expect(pkg.scripts.heron).toBe("bun --no-env-file --config=/dev/null bin/heron.ts");
  });

  test("starts heron without the working directory's .env or bunfig.toml", () => {
    // an untrusted repo: the bunfig preload writes a marker
    const marker = join(scratch, "marker");
    writeFileSync(
      join(scratch, "pre.ts"),
      `require("node:fs").writeFileSync(${JSON.stringify(marker)}, "x");\n`,
    );
    writeFileSync(join(scratch, "bunfig.toml"), 'preload = ["./pre.ts"]\n');
    writeFileSync(join(scratch, ".env"), "HERON_SENTINEL=leaked\n");
    // control: plain bun in that cwd does run the preload, so the probe is meaningful
    Bun.spawnSync(["bun", "-e", "0"], { cwd: scratch });
    expect(existsSync(marker)).toBe(true);
    rmSync(marker);
    // the launcher, exec'd through its shebang as `heron` would be
    const run = Bun.spawnSync([launcher, "--version"], { cwd: scratch });
    expect(run.exitCode).toBe(0);
    expect(run.stdout.toString()).toBe(`${pkg.version}\n`);
    expect(run.stderr.toString()).toBe("");
    expect(existsSync(marker)).toBe(false);
  }, 30_000); // Real executable startup and a control process that intentionally runs the fixture preload.

  test("does not load a hostile cwd's .env into process.env", async () => {
    writeFileSync(join(scratch, ".env"), "HERON_SENTINEL=leaked\n");
    writeFileSync(
      join(scratch, "probe.ts"),
      "console.log(process.env.HERON_SENTINEL ?? 'absent');\n",
    );
    const printed = (args: string[]): string =>
      Bun.spawnSync(["bun", ...args, join(scratch, "probe.ts")], {
        cwd: scratch,
        env: { PATH: process.env["PATH"] ?? "" },
      })
        .stdout.toString()
        .trim();
    expect(printed([])).toBe("leaked"); // control
    // the flags are the ones in the launcher's shebang
    const first = (await Bun.file(launcher).text()).split("\n")[0] ?? "";
    const flags = first.replace("#!/usr/bin/env -S bun", "").trim().split(/\s+/);
    expect(printed(flags)).toBe("absent");
  }, 30_000);
});
