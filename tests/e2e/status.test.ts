import { describe, expect, test } from "bun:test";
import { readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { rejectionToFinding } from "../../src/app/result.ts";
import {
  ExitCode,
  type CliEnvelope,
  type InitData,
  type StatusData,
} from "../../src/core/contracts/index.ts";
import { createInitialState } from "../../src/core/state/lifecycle.ts";
import { canTransition } from "../../src/core/state/transitions.ts";
import { DEFAULT_RESEARCH_SETTINGS } from "../../src/research/ports.ts";
import { fixedContext, runCliCaptured } from "../helpers/cli.ts";
import { e2eSetup } from "../helpers/e2e.ts";
import { hashTree, patchHarnessState } from "../helpers/fixtures.ts";
import { makePng, referenceArgs } from "../helpers/research.ts";

const { fresh, initialized } = e2eSetup();

// P1/P2 are a fixed prefix; later specs only append commands after `heron research render`.
const ALLOWED_COMMANDS_PREFIX =
  "Allowed commands: heron init, heron status, heron doctor, heron gate intake approve|reject, heron references add|import, heron references list|show|compare|remove, heron brand add, heron research render";

const GATES_AT_INITIALIZED = [
  "Gates:",
  "- intake: pending",
  "- research: not-reached",
  "- direction: not-reached",
  "- foundations: not-reached",
  "- representative-screens: not-reached",
  "- visual-review: not-reached",
];

describe("heron status", () => {
  // Covers: R8, R9, R12, R14, R18
  test("reports mode, phase, gates and counts without writing anything", async () => {
    const root = await initialized("membership-product");
    const before = hashTree(root, { exclude: [] });
    const run = await runCliCaptured(["status", root]);
    expect(run.code).toBe(ExitCode.Ok);
    expect(run.stderr).toBe("");
    const lines = run.stdout.split("\n");
    const allowed = lines.filter((line) => line.startsWith("Allowed commands: "));
    expect(allowed).toHaveLength(1);
    expect(allowed[0]?.startsWith(ALLOWED_COMMANDS_PREFIX)).toBe(true);
    expect(lines.filter((line) => !line.startsWith("Allowed commands: ")).join("\n")).toBe(
      [
        "Stage: 01-mvp",
        "Navori Master: yes",
        "Mode: FULL PRODUCT",
        "Phase: initialized",
        "State revision: 1",
        "",
        "Screens: 6",
        "Flows: 3",
        "Patterns: 2",
        "",
        ...GATES_AT_INITIALIZED,
        "",
        "Stale artifacts: none",
        "Open conflicts: not tracked yet",
        "",
      ].join("\n"),
    );
    expect(hashTree(root, { exclude: [] })).toEqual(before);

    const json = await runCliCaptured(["status", root, "--json"]);
    const envelope = JSON.parse(json.stdout) as CliEnvelope;
    const data = envelope.data as StatusData;
    expect([envelope.command, envelope.ok, data.mode, data.inputsChanged]).toEqual([
      "status",
      true,
      "full",
      [],
    ]);
    expect(hashTree(root, { exclude: [] })).toEqual(before);
  });

  // Covers: R8, R9
  test("omits the counts and names the cause in reference-only", async () => {
    const root = await initialized("no-ux");
    const run = await runCliCaptured(["status", root]);
    expect(run.code).toBe(ExitCode.Ok);
    expect(run.stdout).toContain(
      "Mode: REFERENCE ONLY\nProduction blocked: UX.md and ux.json are missing\nPhase: initialized\n",
    );
    expect(run.stdout).not.toContain("Screens:");
    expect(run.stdout).not.toContain("MODE_BLOCKED");
  });

  // Covers: R8, R12
  test("detects changed inputs and blocks production when UX disappears after init", async () => {
    const root = await initialized("membership-product");
    const before = hashTree(root, { exclude: [] });
    unlinkSync(join(root, "specs", "_master", "01-mvp", "ux.json"));
    patchHarnessState(root, "01-mvp", { ux: "md" });
    const edited = hashTree(root, { exclude: [] });
    const run = await runCliCaptured(["status", root]);
    expect(run.code).toBe(ExitCode.Ok);
    expect(run.stdout).toContain(
      "Mode: REFERENCE ONLY (persisted: FULL PRODUCT)\nProduction blocked: ",
    );
    expect(run.stdout).not.toContain("Screens:");
    expect(run.stdout).toContain(
      "INPUTS_CHANGED: Inputs changed since the last heron init: specs/_master/01-mvp/ux.json",
    );
    expect(run.stdout).toContain(`Run: heron init ${root}`);
    expect(run.stdout).toContain("Phase: initialized");
    expect(hashTree(root, { exclude: [] })).toEqual(edited);
    expect(edited).not.toEqual(before);

    const json = JSON.parse(
      (await runCliCaptured(["status", root, "--json"])).stdout,
    ) as CliEnvelope;
    const data = json.data as StatusData;
    expect([data.mode, data.persistedMode, data.liveMode]).toEqual([
      "reference-only",
      "full",
      "reference-only",
    ]);
    expect(data.counts).toBeNull();
    expect(data.inputsChanged).toContain("specs/_master/01-mvp/ux.json");
  });

  // Covers: R11, R12
  test("fails with exit 3 when the workspace is missing, corrupt or from a newer Heron", async () => {
    const empty = fresh("no-ux");
    const missing = await runCliCaptured(["status", empty]);
    expect(missing.code).toBe(ExitCode.Blocked);
    expect(missing.stderr).toBe(`.heron/state.json not found. Run: heron init ${empty}\n`);

    const gone = await runCliCaptured(["status", join(empty, "nope")]);
    expect(gone.code).toBe(ExitCode.Usage);

    const root = await initialized("no-ux");
    const statePath = join(root, ".heron", "state.json");
    const original = readFileSync(statePath, "utf8");
    writeFileSync(statePath, original.replace('"schemaVersion": 1', '"schemaVersion": 7'));
    const newer = await runCliCaptured(["status", root]);
    expect(newer.code).toBe(ExitCode.Blocked);
    expect(newer.stderr).toContain("this Heron supports schemaVersion 1");

    writeFileSync(statePath, "{ not json");
    const corrupt = await runCliCaptured(["status", root]);
    expect(corrupt.code).toBe(ExitCode.Blocked);
    expect(corrupt.stderr).toContain(
      "state.json is not a valid HeronState document (1 issue(s)); restore it from Git.",
    );

    writeFileSync(statePath, original);
    unlinkSync(join(root, ".heron", "project.json"));
    const partial = await runCliCaptured(["status", root, "--json"]);
    const envelope = JSON.parse(partial.stdout) as CliEnvelope;
    expect([partial.code, envelope.findings[0]?.code]).toEqual([
      ExitCode.Blocked,
      "DOCUMENT_INVALID",
    ]);
  });

  // Covers: R8
  test("appends the mode-block cause to a MODE_BLOCKED rejection", async () => {
    const root = fresh("no-ux");
    const run = await runCliCaptured(["init", root, "--json"]);
    const { decision } = (JSON.parse(run.stdout) as CliEnvelope).data as InitData;
    const base = createInitialState({
      mode: "reference-only",
      artifacts: [],
      meta: {
        runId: "run-20260930T120000Z-00000001",
        at: "2026-09-30T12:00:00.000Z",
        command: "init",
        heronVersion: "0.0.0",
      },
    });
    const state = { ...base, phase: "directions-ready" as const };
    const rejected = canTransition(state, { type: "approve-gate", gate: "direction" }, {});
    if (rejected.ok) throw new Error("expected a rejection");
    expect(rejected.code).toBe("MODE_BLOCKED");
    const finding = rejectionToFinding(rejected, decision);
    expect(finding.code).toBe("MODE_BLOCKED");
    expect(finding.message).toBe(
      "approve-gate:direction requires FULL PRODUCT mode; current mode is REFERENCE ONLY (UX.md and ux.json are missing).",
    );
    const other = canTransition(state, { type: "validation-passed" }, {});
    if (other.ok) throw new Error("expected a rejection");
    expect(rejectionToFinding(other, decision).message).toBe(other.reason);
  });

  // Covers: R16
  test("warns when research assets exceed the size threshold", async () => {
    const root = await initialized("no-ux");
    writeFileSync(join(root, "shot.png"), await makePng(30, 30));
    const added = await runCliCaptured(
      referenceArgs(root, ["source"], ["--source", "image", "--file", "shot.png"]),
      fixedContext({ cwd: root }),
    );
    expect(added.code).toBe(ExitCode.Ok);
    const quiet = await runCliCaptured(["status", root]);
    expect(quiet.stdout).not.toContain("ASSETS_LARGE");
    expect(quiet.stdout).toContain("heron references add|import");

    const tight = fixedContext({
      research: { ...DEFAULT_RESEARCH_SETTINGS, assetWarningBytes: 1 },
    });
    const warned = await runCliCaptured(["status", root], tight);
    expect(warned.code).toBe(ExitCode.Ok);
    expect(warned.stdout).toMatch(
      /ASSETS_LARGE: Images in \.heron\/ use 0\.0 MiB \(threshold 0\.0 MiB\); every reference image is versioned in Git \(D15\)\./,
    );
    const json = await runCliCaptured(["status", root, "--json"], tight);
    const envelope = JSON.parse(json.stdout) as CliEnvelope;
    expect(envelope.findings.map((finding) => [finding.code, finding.severity])).toContainEqual([
      "ASSETS_LARGE",
      "warning",
    ]);
  }, 30_000);

  // Covers: R14
  test("reports open conflicts and a stale product context", async () => {
    const root = await initialized("conflict");
    const untracked = await runCliCaptured(["status", root]);
    expect(untracked.stdout).toContain("Open conflicts: not tracked yet");
    expect(untracked.stdout).not.toContain("PRODUCT_CONTEXT_STALE");
    expect(untracked.stdout).toContain("heron intake, heron conflicts list|ack");

    await runCliCaptured(["intake", root]);
    const open = await runCliCaptured(["status", root]);
    expect(open.stdout).toContain("Open conflicts: 1");
    expect(open.stdout).toContain(`Run: heron conflicts ack CONFLICT-001 ${root} --note <text>`);
    expect(open.stdout).not.toContain("PRODUCT_CONTEXT_STALE");

    await runCliCaptured(["conflicts", "ack", "CONFLICT-001", "--note", "ok", "--yes", root]);
    expect((await runCliCaptured(["status", root])).stdout).toContain("Open conflicts: 0");

    const master = join(root, "specs", "_master", "01-mvp", "MASTER.md");
    writeFileSync(
      master,
      readFileSync(master, "utf8").replace("Members can browse benefits.", "Members browse perks."),
    );
    const before = hashTree(root, { exclude: [] });
    const stale = await runCliCaptured(["status", root]);
    expect(stale.code).toBe(ExitCode.Ok);
    expect(stale.stdout).toContain(
      `PRODUCT_CONTEXT_STALE: The product context is out of date: its sources, the mode or the Heron extractor changed since the last heron intake. Run: heron intake ${root}`,
    );
    expect(hashTree(root, { exclude: [] })).toEqual(before);
    await runCliCaptured(["intake", root]);
    expect((await runCliCaptured(["status", root])).stdout).not.toContain("PRODUCT_CONTEXT_STALE");
  });

  // Covers: R14
  test("does not report stale when an unused or non-contributing source changes", async () => {
    const root = await initialized("membership-product");
    await runCliCaptured(["intake", root]);
    expect((await runCliCaptured(["gate", "intake", "approve", "--yes", root])).code).toBe(
      ExitCode.Ok,
    );
    for (const name of ["CODEBASE.md", "DIGEST.md"]) {
      const path = join(root, "specs", "_master", "01-mvp", "context", name);
      writeFileSync(path, `${readFileSync(path, "utf8")}\nA note with no role for any element.\n`);
    }
    const run = await runCliCaptured(["status", root]);
    expect(run.code).toBe(ExitCode.Ok);
    expect(run.stdout).not.toContain("PRODUCT_CONTEXT_STALE");
    expect(run.stdout).not.toContain("GATE_APPROVAL_INVALIDATED");
    expect(run.stdout).toContain("- intake: approved");
  });
});
