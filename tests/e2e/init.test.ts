import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  ExitCode,
  HERON_STATE_DOCUMENT,
  MODE_DECISION_DOCUMENT,
  parseVersionedDocument,
  type CliEnvelope,
  type HeronState,
  type InitData,
  type StoredModeDecision,
} from "../../src/core/contracts/index.ts";
import { acquireLock, DEFAULT_LOCK_OPTIONS } from "../../src/core/store/lock.ts";
import { nodeFs } from "../../src/core/store/fs-port.ts";
import { fixedContext, runCliCaptured } from "../helpers/cli.ts";
import { copyFixture, hashTree, patchHarnessState, type FixtureName } from "../helpers/fixtures.ts";

const copies: string[] = [];
function fixture(name: FixtureName): string {
  const dir = copyFixture(name);
  copies.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of copies.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const READY = "Ready for research.";
const DISABLED = "Full product generation disabled.\nVisual research is available.";

function readState(root: string): HeronState {
  const raw: unknown = JSON.parse(readFileSync(join(root, ".heron", "state.json"), "utf8"));
  return parseVersionedDocument(raw, HERON_STATE_DOCUMENT, "state.json");
}
function readMode(root: string): StoredModeDecision {
  const raw: unknown = JSON.parse(
    readFileSync(join(root, ".heron", "intake", "mode.json"), "utf8"),
  );
  return parseVersionedDocument(raw, MODE_DECISION_DOCUMENT, "mode.json");
}
function uxCounts(root: string): {
  surfaces: string[];
  screens: number;
  flows: number;
  patterns: number;
} {
  const ux = JSON.parse(
    readFileSync(join(root, "specs", "_master", "01-mvp", "ux.json"), "utf8"),
  ) as {
    surfaces: { id: string }[];
    screens: unknown[];
    flows: unknown[];
    patterns: unknown[];
  };
  return {
    surfaces: ux.surfaces.map((s) => s.id),
    screens: ux.screens.length,
    flows: ux.flows.length,
    patterns: ux.patterns.length,
  };
}

describe("heron init", () => {
  // Covers: R1, R2
  test("reports FULL PRODUCT for the membership-product fixture", async () => {
    const root = fixture("membership-product");
    const counts = uxCounts(root);
    const run = await runCliCaptured(["init", root]);
    expect(run.code).toBe(ExitCode.Ok);
    expect(run.stderr).toBe("");
    const expected = [
      "Project detected",
      "Navori Master: yes",
      "Stage: 01-mvp",
      "",
      "MASTER.md: ✓",
      "DECISIONS.md: ✓",
      "parts.json: ✓",
      "UX.md:  ✓",
      "ux.json: ✓",
      "DIGEST.md: ✓",
      "CODEBASE.md: ✓",
      "",
      "Harness UX declaration: md-json",
      "",
      "Mode:",
      "FULL PRODUCT",
      "",
      "Surfaces:",
      ...counts.surfaces.map((id) => `- ${id}`),
      "",
      `Screens: ${counts.screens}`,
      `Flows: ${counts.flows}`,
      `Patterns: ${counts.patterns}`,
      "",
      READY,
      "",
    ].join("\n");
    expect(run.stdout).toBe(expected);
    expect(counts).toEqual({
      surfaces: ["MOBILE", "DASHBOARD", "PARTNER"],
      screens: 6,
      flows: 3,
      patterns: 2,
    });
    const state = readState(root);
    expect(state.mode).toBe("full");
    expect(state.stateRevision).toBe(1);
    expect(state.artifacts.map((a) => a.path)).toEqual(["intake/mode.json", "project.json"]);
    expect(readMode(root).mode).toBe("full");
    expect(readFileSync(join(root, ".heron", ".gitignore"), "utf8")).toContain("/.lock");
  });

  // Covers: R1, R3
  test("reports REFERENCE ONLY for the no-ux fixture", async () => {
    const root = fixture("no-ux");
    const run = await runCliCaptured(["init", root]);
    expect(run.code).toBe(ExitCode.Ok);
    expect(run.stdout).toBe(
      [
        "Project detected",
        "Navori Master: yes",
        "Stage: 01-mvp",
        "",
        "MASTER.md: ✓",
        "DECISIONS.md: ✓",
        "parts.json: ✓",
        "UX.md:  missing",
        "ux.json: missing",
        "DIGEST.md: ✓",
        "CODEBASE.md: ✓",
        "",
        "Mode:",
        "REFERENCE ONLY",
        "",
        DISABLED,
        "",
      ].join("\n"),
    );
    expect(readState(root).mode).toBe("reference-only");
    const dry = await runCliCaptured(["init", "--dry-run", root]);
    expect(dry.code).toBe(ExitCode.Ok);
    expect(dry.stdout).toContain("REFERENCE ONLY");
    expect(dry.stdout.endsWith("Dry run: nothing was written to .heron/\n")).toBe(true);
  });

  // Covers: R4
  test("falls back to reference-only without inferring the missing UX file", async () => {
    const cases: [FixtureName, string, string][] = [
      [
        "ux-only-md",
        "UX_INCONSISTENT: UX.md is present but ux.json is missing (specs/_master/01-mvp/ux.json); Heron will not create or infer it.",
        "ux.json",
      ],
      [
        "ux-only-json",
        "UX_INCONSISTENT: ux.json is present but UX.md is missing (specs/_master/01-mvp/UX.md); Heron will not create or infer it.",
        "UX.md",
      ],
    ];
    for (const [name, line, missing] of cases) {
      const root = fixture(name);
      const before = hashTree(root, { exclude: [".heron"] });
      const run = await runCliCaptured(["init", root]);
      expect(run.code).toBe(ExitCode.Ok);
      expect(run.stdout).toContain(`Mode:\nREFERENCE ONLY\n\n${line}\n\n${DISABLED}`);
      expect(readState(root).mode).toBe("reference-only");
      expect(existsSync(join(root, "specs", "_master", "01-mvp", missing))).toBe(false);
      expect(hashTree(root, { exclude: [".heron"] })).toEqual(before);
    }
  });

  // Covers: R5
  test("treats a schema-invalid ux.json as reference-only and lists the issues", async () => {
    const root = fixture("ux-invalid");
    const run = await runCliCaptured(["init", root]);
    expect(run.code).toBe(ExitCode.Ok);
    expect(run.stdout).toContain(
      "UX_CONTRACT_INVALID: specs/_master/01-mvp/ux.json does not satisfy the provisional UX contract reader (3 issues).",
    );
    const pointers = run.stdout
      .split("\n")
      .filter((line) => line.startsWith("  /"))
      .map((line) => line.slice(2, line.indexOf(":")));
    expect(pointers).toEqual(["/flows/0/screens/1", "/patterns", "/screens/1/surface"]);
    expect(run.stdout).not.toContain("Surfaces:");
    expect(run.stdout).toContain(DISABLED);
    expect(readState(root).mode).toBe("reference-only");
    expect(readMode(root).findings[0]?.issues).toHaveLength(3);
  });

  // Covers: R6
  test("selects stages explicitly or falls back to the last closed stage with a notice", async () => {
    const root = fixture("closed-stage");
    const fallback = await runCliCaptured(["init", "--dry-run", root]);
    expect(fallback.code).toBe(ExitCode.Ok);
    expect(
      fallback.stdout.startsWith(
        "Project detected\nNavori Master: yes\nNo active stage; using last closed: 02-beta\nStage: 02-beta\n",
      ),
    ).toBe(true);
    for (const stage of ["01-alpha", "03-gamma"]) {
      const explicit = await runCliCaptured(["init", "--dry-run", root, "--stage", stage]);
      expect(explicit.code).toBe(ExitCode.Ok);
      expect(explicit.stdout).toContain(`Stage: ${stage}\n`);
      expect(explicit.stdout).not.toContain("No active stage");
    }
    const missing = await runCliCaptured(["init", "--dry-run", root, "--stage", "99-x"]);
    expect(missing.code).toBe(ExitCode.Usage);
    expect(missing.stdout).toBe("");
    expect(missing.stderr).toBe(
      'Stage "99-x" not found in specs/_master/index.json.\nAvailable stages: 01-alpha (cerrada), 02-beta (cerrada), 03-gamma (abandonada)\n',
    );
    const invalid = await runCliCaptured(["init", "--dry-run", root, "--stage", "Bad Stage"]);
    expect(invalid.code).toBe(ExitCode.Usage);
    expect(invalid.stderr).toContain('Invalid stage "Bad Stage"');
    const json = await runCliCaptured(["init", "--dry-run", root, "--json"]);
    const envelope = JSON.parse(json.stdout) as CliEnvelope;
    expect(envelope.findings.map((f) => f.code)).toContain("STAGE_FALLBACK_LAST_CLOSED");

    const noneSelectable = fixture("closed-stage");
    const indexPath = join(noneSelectable, "specs", "_master", "index.json");
    const index = JSON.parse(readFileSync(indexPath, "utf8")) as { stages: { state: string }[] };
    for (const stage of index.stages) stage.state = "abandonada";
    writeFileSync(indexPath, JSON.stringify(index));
    const none = await runCliCaptured(["init", "--dry-run", noneSelectable]);
    expect(none.code).toBe(ExitCode.Usage);
    expect(none.stderr).toContain(
      "No active or closed stage in specs/_master/index.json; pass --stage <NN-slug>.\nAvailable stages: ",
    );

    const gone = await runCliCaptured(["init", join(root, "does-not-exist")]);
    expect(gone.code).toBe(ExitCode.Usage);
    expect(gone.stderr).toContain("Path not found or not a directory:");
  });

  // Covers: R7
  test("reports the harness UX declaration and tolerates unknown phases and modes", async () => {
    const md = fixture("membership-product");
    patchHarnessState(md, "01-mvp", { ux: "md" }, { removeFiles: ["ux.json"] });
    const declaredMd = await runCliCaptured(["init", md]);
    expect(declaredMd.code).toBe(ExitCode.Ok);
    expect(declaredMd.stdout).toContain("Harness UX declaration: md\n\nMode:\nREFERENCE ONLY\n\n");
    expect(declaredMd.stdout).toContain(
      'UX_DECLARED_MD_ONLY: The harness declared ux = "md" (UX.md only) in specs/_master/01-mvp/state.json; Heron requires UX.md and ux.json for full product, so it stays in reference-only.',
    );
    expect(declaredMd.stdout).not.toContain("UX_INCONSISTENT");
    expect(readState(md).mode).toBe("reference-only");

    const mismatch = fixture("membership-product");
    patchHarnessState(mismatch, "01-mvp", { ux: "md-json" }, { removeFiles: ["ux.json"] });
    const declaredBoth = await runCliCaptured(["init", mismatch]);
    expect(declaredBoth.stdout).toContain(
      'UX_DECLARATION_MISMATCH: The harness declares ux = "md-json" in specs/_master/01-mvp/state.json, but ux.json is missing.',
    );
    expect(readState(mismatch).mode).toBe("reference-only");

    const future = fixture("membership-product");
    patchHarnessState(future, "01-mvp", {
      phase: "ux-review",
      mode: "desde-cero-v9",
      futureField: { nested: true },
    });
    const tolerated = await runCliCaptured(["init", future]);
    expect(tolerated.code).toBe(ExitCode.Ok);
    expect(tolerated.stdout).toContain("FULL PRODUCT");
    expect(readState(future).mode).toBe("full");

    const unknown = fixture("membership-product");
    patchHarnessState(unknown, "01-mvp", { ux: "md-json-v2" });
    const ignored = await runCliCaptured(["init", unknown]);
    expect(ignored.code).toBe(ExitCode.Ok);
    expect(ignored.stdout).toContain("Harness UX declaration: md-json-v2\n");
    expect(ignored.stdout).toContain(
      'HARNESS_UNKNOWN_VALUE: specs/_master/01-mvp/state.json declares ux = "md-json-v2", which Heron does not recognize; the declaration is ignored.',
    );
    expect(ignored.stdout).toContain("FULL PRODUCT");
  });

  // Covers: R12
  test("never writes outside .heron/ in the product repo", async () => {
    for (const name of ["membership-product", "no-ux", "ux-invalid", "closed-stage"] as const) {
      const root = fixture(name);
      const before = hashTree(root, { exclude: [".heron"] });
      expect((await runCliCaptured(["init", root])).code).toBe(ExitCode.Ok);
      expect((await runCliCaptured(["status", root])).code).toBe(ExitCode.Ok);
      expect((await runCliCaptured(["init", root])).code).toBe(ExitCode.Ok);
      expect(hashTree(root, { exclude: [".heron"] })).toEqual(before);
      expect(existsSync(join(root, ".heron", "state.json"))).toBe(true);
    }
    const dry = fixture("membership-product");
    expect((await runCliCaptured(["init", "--dry-run", dry])).code).toBe(ExitCode.Ok);
    expect(existsSync(join(dry, ".heron"))).toBe(false);
  });

  // Covers: R10, R12
  test("is idempotent and records a new revision only when the inputs or the mode change", async () => {
    const root = fixture("membership-product");
    const first = await runCliCaptured(["init", root, "--json"]);
    const second = await runCliCaptured(["init", root, "--json"]);
    const a = (JSON.parse(first.stdout) as CliEnvelope).data as InitData;
    const b = (JSON.parse(second.stdout) as CliEnvelope).data as InitData;
    expect([a.written, a.stateRevision]).toEqual([true, 1]);
    expect([b.written, b.stateRevision]).toEqual([false, 1]);
    expect(readState(root).history).toHaveLength(1);

    patchHarnessState(root, "01-mvp", {}, { removeFiles: ["ux.json"] });
    const third = await runCliCaptured(["init", root]);
    expect(third.code).toBe(ExitCode.Ok);
    const state = readState(root);
    expect(state.stateRevision).toBe(2);
    expect(state.mode).toBe("reference-only");
    expect(state.history).toHaveLength(2);
  });

  // Covers: R10
  test("exits 6 when the lock is held and 3 when .heron or its documents are unusable", async () => {
    const root = fixture("no-ux");
    mkdirSync(join(root, ".heron"));
    const { handle } = acquireLock(
      nodeFs,
      join(root, ".heron"),
      {
        runId: "run-20260930T115900Z-aaaaaaaa",
        pid: process.pid,
        hostname: "test-host",
        command: "init",
        acquiredAt: "2026-09-30T11:59:00.000Z",
      },
      {
        ...DEFAULT_LOCK_OPTIONS,
        hostname: "test-host",
        now: () => Date.now(),
        isProcessAlive: () => true,
      },
    );
    const busy = await runCliCaptured(["init", root]);
    expect(busy.code).toBe(ExitCode.LockBusy);
    expect(busy.stderr).toContain(
      '.heron/ is locked by "init" (pid ' +
        process.pid +
        " on test-host, run run-20260930T115900Z-aaaaaaaa, since 2026-09-30T11:59:00.000Z).",
    );
    handle.release();
    expect((await runCliCaptured(["init", root])).code).toBe(ExitCode.Ok);

    const unsupported = readFileSync(join(root, ".heron", "state.json"), "utf8").replace(
      '"schemaVersion": 1',
      '"schemaVersion": 99',
    );
    writeFileSync(join(root, ".heron", "state.json"), unsupported);
    const newer = await runCliCaptured(["init", root]);
    expect(newer.code).toBe(ExitCode.Blocked);
    expect(newer.stderr).toContain("this Heron supports schemaVersion 1");

    const linked = fixture("no-ux");
    const elsewhere = fixture("no-ux");
    symlinkSync(elsewhere, join(linked, ".heron"));
    const unsafe = await runCliCaptured(["init", linked]);
    expect(unsafe.code).toBe(ExitCode.Blocked);
    expect(unsafe.stderr).toBe(".heron/ must be a regular directory inside the repository.\n");
    expect(existsSync(join(elsewhere, "state.json"))).toBe(false);

    const crashed = fixture("no-ux");
    const ctx = fixedContext();
    expect((await runCliCaptured(["init", crashed], ctx)).code).toBe(ExitCode.Ok);
    const stagingRun = join(crashed, ".heron", "staging", "run-20260930T110000Z-deadbeef");
    mkdirSync(stagingRun, { recursive: true });
    writeFileSync(join(stagingRun, "orphan"), "x");
    patchHarnessState(crashed, "01-mvp", { ux: "md" });
    const recovered = await runCliCaptured(["init", crashed], ctx);
    expect(recovered.code).toBe(ExitCode.Ok);
    expect(recovered.stderr).toContain(
      "STAGING_RECOVERED: Removed orphan staging from interrupted run(s): run-20260930T110000Z-deadbeef.",
    );
    expect(existsSync(stagingRun)).toBe(false);
  });

  // Covers: R1
  test("emits exactly one envelope with --json and an error envelope on failure", async () => {
    const root = fixture("membership-product");
    const run = await runCliCaptured(["init", root, "--json"]);
    expect(run.stderr).toBe("");
    const envelope = JSON.parse(run.stdout) as CliEnvelope;
    expect(run.stdout.endsWith("}\n")).toBe(true);
    expect([envelope.command, envelope.ok, envelope.code]).toEqual(["init", true, 0]);
    const failed = await runCliCaptured(["init", root, "--stage", "99-x", "--json"]);
    const error = JSON.parse(failed.stdout) as CliEnvelope;
    expect([error.ok, error.code, error.data]).toEqual([false, 2, null]);
    expect(error.findings[0]?.code).toBe("STAGE_NOT_FOUND");
  });

  // Covers: R13
  test("persists a canonical locale, keeps it on re-init and rejects an invalid tag before writing", async () => {
    const root = fixture("no-ux");
    const before = hashTree(root, { exclude: [] });
    for (const bad of ["not a locale", "", "es_MX"]) {
      const run = await runCliCaptured(["init", root, "--locale", bad]);
      expect({ bad, code: run.code }).toEqual({ bad, code: ExitCode.Usage });
      expect(run.stderr).toBe(
        `Invalid locale "${bad}": expected a BCP 47 tag such as es or en-US.\n`,
      );
      expect(hashTree(root, { exclude: [] })).toEqual(before);
    }
    const dry = await runCliCaptured(["init", root, "--locale", "es-mx", "--dry-run"]);
    expect(dry.code).toBe(ExitCode.Ok);
    expect(hashTree(root, { exclude: [] })).toEqual(before);

    const read = (): { product?: { locale: string }; penpot: unknown } =>
      JSON.parse(readFileSync(join(root, ".heron", "project.json"), "utf8"));
    expect((await runCliCaptured(["init", root, "--locale", "es-mx"])).code).toBe(ExitCode.Ok);
    expect(read().product).toEqual({ locale: "es-MX" });
    const penpot = read().penpot;
    expect((await runCliCaptured(["init", root])).code).toBe(ExitCode.Ok);
    expect(read().product).toEqual({ locale: "es-MX" });
    expect(read().penpot).toEqual(penpot);
    expect((await runCliCaptured(["init", root, "--locale", "en-US"])).code).toBe(ExitCode.Ok);
    expect(read().product).toEqual({ locale: "en-US" });
  });
});
