import { describe, expect, test } from "bun:test";
import { USAGE_TEXT, UsageError, parseCliArgs } from "../../src/cli/args.ts";
import { runCliCaptured } from "../helpers/cli.ts";

describe("parseCliArgs", () => {
  // Covers: R6
  test("parses init, status and gate with defaults and options", () => {
    expect(parseCliArgs(["init"])).toEqual({
      command: "init",
      path: ".",
      stage: null,
      dryRun: false,
      json: false,
    });
    expect(parseCliArgs(["init", "../p", "--stage", "02-beta", "--dry-run", "--json"])).toEqual({
      command: "init",
      path: "../p",
      stage: "02-beta",
      dryRun: true,
      json: true,
    });
    expect(parseCliArgs(["status", "--json"])).toEqual({
      command: "status",
      path: ".",
      json: true,
    });
    expect(parseCliArgs(["doctor", "x"])).toEqual({ command: "doctor", path: "x", json: false });
    expect(
      parseCliArgs(["gate", "intake", "reject", "p", "--reason", "no", "--note", "n", "--yes"]),
    ).toEqual({
      command: "gate",
      path: "p",
      gate: "intake",
      decision: "reject",
      note: "n",
      reason: "no",
      yes: true,
      json: false,
    });
  });

  // Covers: R6
  test("maps help and version flags and an empty argv", () => {
    expect(parseCliArgs([])).toEqual({ command: "help" });
    expect(parseCliArgs(["-h"])).toEqual({ command: "help" });
    expect(parseCliArgs(["init", "--help"])).toEqual({ command: "help" });
    expect(parseCliArgs(["-v"])).toEqual({ command: "version" });
    expect(parseCliArgs(["--version"])).toEqual({ command: "version" });
  });

  // Covers: R6
  test("rejects unknown options, commands, gates and extra positionals as usage errors", () => {
    const invalid: string[][] = [
      ["init", "--bogus"],
      ["init", "--stage"],
      ["bogus"],
      ["init", "a", "b"],
      ["status", "--dry-run"],
      ["status", "--stage", "01-mvp"],
      ["gate", "nope", "approve"],
      ["gate", "intake", "maybe"],
      ["gate", "intake"],
      ["gate"],
      ["gate", "intake", "approve", "p", "extra"],
      ["doctor", "--yes"],
    ];
    for (const argv of invalid) {
      const parsed = parseCliArgs(argv);
      expect(parsed instanceof UsageError).toBe(true);
    }
    const json = parseCliArgs(["bogus", "--json"]);
    expect(json instanceof UsageError && json.json).toBe(true);
  });

  // Covers: R6
  test("exits 2 with the usage text for invalid usage and 0 for help", async () => {
    const bad = await runCliCaptured(["init", "--bogus"]);
    expect(bad.code).toBe(2);
    expect(bad.stdout).toBe("");
    expect(bad.stderr).toContain(USAGE_TEXT.trimEnd());
    const asJson = await runCliCaptured(["bogus", "--json"]);
    expect(asJson.code).toBe(2);
    expect(asJson.stderr).toBe("");
    const envelope = JSON.parse(asJson.stdout) as {
      ok: boolean;
      code: number;
      findings: { code: string }[];
    };
    expect(envelope.ok).toBe(false);
    expect(envelope.code).toBe(2);
    expect(envelope.findings[0]?.code).toBe("USAGE");
    const help = await runCliCaptured(["--help"]);
    expect(help).toEqual({ code: 0, stdout: USAGE_TEXT, stderr: "" });
    const version = await runCliCaptured(["--version"]);
    expect(version.code).toBe(0);
    expect(version.stdout).toMatch(/^\d+\.\d+\.\d+\n$/);
  });
});
