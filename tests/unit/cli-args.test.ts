import { describe, expect, test } from "bun:test";
import { USAGE_TEXT, commandFor, parseCliArgs } from "../../src/cli/args.ts";
import { UsageError, type CommandSpec, type ParsedCommand } from "../../src/cli/command.ts";
import { COMMANDS } from "../../src/cli/commands/index.ts";
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

  // Covers: R2
  test("derives the usage text, parsing and lookup from the command registry", () => {
    expect(COMMANDS.map((spec) => spec.name)).toEqual([
      "init",
      "status",
      "doctor",
      "gate",
      "references",
    ]);
    expect(USAGE_TEXT).toBe(
      [
        "Usage: heron <command> [options]",
        "",
        "Commands:",
        "  init [path] [--stage <NN-slug>] [--dry-run] [--json]",
        "      Detect the product context, decide the mode and write .heron/",
        "  status [path] [--json]",
        "      Show mode, stage, phase, gates and stale artifacts",
        "  doctor [path] [--json]",
        "      Check the local environment and the .heron/ workspace",
        "  gate <gate> approve|reject [path] [--note <text>] [--reason <text>] [--yes] [--json]",
        "      Record a human gate decision bound to artifact hashes",
        "  references add [path] --source <kind> [--origin <text>] [--url <url>] [--file <path>] [--screenshot]",
        "      [--allow-local] --reason <text> --study <text>... --do-not-copy <text>... --influence <text>...",
        "      [--crop <x,y,w,h=note>]... [--json]",
        "      Record a visual reference with complete provenance",
        "  references list [path] [--all] [--json]",
        "      List references (removed ones too with --all)",
        "  references show <REF-n> [path] [--json]",
        "      Show one reference with its provenance, crops and security findings",
        "  references compare <REF-n> <REF-n> [<REF-n> <REF-n>] [path] [--json]",
        "      Compare 2 to 4 references side by side",
        "  references remove <REF-n> [path] [--reason <text>] [--json]",
        "      Remove a reference (kept as removed in references.json)",
        "  references import <file.json> [path] [--allow-local] [--json]",
        "      Import a ReferenceBatch file, all or nothing",
        "",
        "Gates: intake, research, direction, foundations, representative-screens, visual-review",
        "Reference sources: manual, url, image, design-md",
        "",
        "Options:",
        "  -h, --help     Show this help",
        "  -v, --version  Show the Heron version",
        "",
      ].join("\n"),
    );
    expect(commandFor("gate").name).toBe("gate");
    expect(() => commandFor("gate", [])).toThrow('Command "gate" is not registered.');

    // A command registered in a custom list is parsed and found without touching args.ts.
    const probe: CommandSpec = {
      name: "status",
      usage: [],
      parse: (_args, json): ParsedCommand => ({ command: "status", path: "probe", json }),
      handle: async () => 0,
    };
    expect(parseCliArgs(["--json", "status"], [probe])).toEqual({
      command: "status",
      path: "probe",
      json: true,
    });
    const unknown = parseCliArgs(["init"], [probe]);
    expect(unknown instanceof UsageError && unknown.message).toBe('Unknown command "init".');
    const misplaced = parseCliArgs(["--stage", "init"]);
    expect(misplaced instanceof UsageError).toBe(true);
    expect(parseCliArgs(["--json"])).toEqual({ command: "help" });
  });

  // Covers: R2, R8
  test("parses the references command group", () => {
    const add = parseCliArgs([
      "references",
      "add",
      "p",
      "--source",
      "image",
      "--file",
      "a.png",
      "--screenshot",
      "--origin",
      "o",
      "--reason",
      "r",
      "--study",
      "s1",
      "--study",
      "s2",
      "--do-not-copy",
      "d",
      "--influence",
      "i",
      "--crop",
      "1,2,3,4=top = bar",
      "--crop",
      "0,0,5,5=x",
    ]);
    expect(add).toEqual({
      command: "references",
      action: "add",
      path: "p",
      json: false,
      reference: {
        source: "image",
        origin: "o",
        reason: "r",
        studies: ["s1", "s2"],
        doNotCopy: ["d"],
        influences: ["i"],
        file: "a.png",
        url: null,
        screenshot: true,
        allowLocal: false,
        crops: [
          { x: 1, y: 2, width: 3, height: 4, note: "top = bar" },
          { x: 0, y: 0, width: 5, height: 5, note: "x" },
        ],
      },
    });
    expect(parseCliArgs(["references", "list", "--all"])).toEqual({
      command: "references",
      action: "list",
      path: ".",
      includeRemoved: true,
      json: false,
    });
    expect(parseCliArgs(["references", "compare", "REF-2", "p", "REF-1", "--json"])).toEqual({
      command: "references",
      action: "compare",
      path: "p",
      ids: ["REF-2", "REF-1"],
      json: true,
    });
    expect(parseCliArgs(["references", "remove", "REF-3", "--reason", "dup"])).toEqual({
      command: "references",
      action: "remove",
      path: ".",
      id: "REF-3",
      reason: "dup",
      json: false,
    });
    expect(parseCliArgs(["references", "show", "REF-1", "q"])).toMatchObject({
      action: "show",
      id: "REF-1",
      path: "q",
    });
    expect(parseCliArgs(["references", "import", "b.json", "--allow-local"])).toMatchObject({
      action: "import",
      file: "b.json",
      allowLocal: true,
    });

    const invalid: string[][] = [
      ["references"],
      ["references", "bogus"],
      ["references", "add", "--crop", "1,2,3,4"],
      ["references", "add", "--crop", "-1,2,3,4=n"],
      ["references", "add", "--crop", "a,2,3,4=n"],
      ["references", "add", "a", "b"],
      ["references", "compare", "REF-1"],
      ["references", "compare", "REF-1", "REF-1"],
      ["references", "compare", "REF-1", "REF-2", "REF-3", "REF-4", "REF-5"],
      ["references", "compare", "REF-1", "REF-2", "a", "b"],
      ["references", "show"],
      ["references", "show", "1"],
      ["references", "show", "REF-1", "--reason", "x"],
      ["references", "remove", "REF-1", "a", "b"],
      ["references", "import"],
      ["references", "list", "--bogus"],
    ];
    for (const argv of invalid) {
      expect({ argv, usage: parseCliArgs(argv) instanceof UsageError }).toEqual({
        argv,
        usage: true,
      });
    }
    const unknown = parseCliArgs(["references", "bogus"]);
    expect(unknown instanceof UsageError && unknown.message).toBe(
      'Unknown references command "bogus". Expected: add, list, show, compare, remove, import.',
    );
  });
});
