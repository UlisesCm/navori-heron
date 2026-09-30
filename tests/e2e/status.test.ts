import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
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
import { runCliCaptured } from "../helpers/cli.ts";
import { copyFixture, hashTree, patchHarnessState, type FixtureName } from "../helpers/fixtures.ts";

const copies: string[] = [];
async function initialized(name: FixtureName): Promise<string> {
  const root = copyFixture(name);
  copies.push(root);
  expect((await runCliCaptured(["init", root])).code).toBe(ExitCode.Ok);
  return root;
}
afterEach(() => {
  for (const dir of copies.splice(0)) rmSync(dir, { recursive: true, force: true });
});

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
  // Covers: R8, R9, R12
  test("reports mode, phase, gates and counts without writing anything", async () => {
    const root = await initialized("membership-product");
    const before = hashTree(root, { exclude: [] });
    const run = await runCliCaptured(["status", root]);
    expect(run.code).toBe(ExitCode.Ok);
    expect(run.stderr).toBe("");
    expect(run.stdout).toBe(
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
        "Allowed commands: heron init, heron status, heron doctor, heron gate intake approve|reject",
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
    const empty = copyFixture("no-ux");
    copies.push(empty);
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
    const root = copyFixture("no-ux");
    copies.push(root);
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
});
