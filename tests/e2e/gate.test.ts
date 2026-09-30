import { describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { collectTransitionFacts } from "../../src/app/gate.ts";
import {
  ExitCode,
  HERON_STATE_DOCUMENT,
  type CliEnvelope,
  type GateData,
  type HeronState,
} from "../../src/core/contracts/index.ts";
import { openFileStore } from "../../src/core/store/file-store.ts";
import { nodeFs } from "../../src/core/store/fs-port.ts";
import { fixedContext, runCliCaptured } from "../helpers/cli.ts";
import { e2eSetup } from "../helpers/e2e.ts";
import { hashTree } from "../helpers/fixtures.ts";

const { fresh, initialized } = e2eSetup();

function setPhase(root: string, phase: string): void {
  const path = join(root, ".heron", "state.json");
  writeFileSync(
    path,
    readFileSync(path, "utf8").replace('"phase": "initialized"', `"phase": "${phase}"`),
  );
}

function readState(root: string): HeronState {
  const store = openFileStore(nodeFs, root, { create: false });
  const state = store.readDocument("state.json", HERON_STATE_DOCUMENT);
  if (state === null) throw new Error("state.json missing");
  return state;
}

const REJECT = ["gate", "intake", "reject", "--reason", "needs more context"];

describe("heron gate", () => {
  // Covers: R8, R9
  test("gate approval requires confirmation, identity and full mode", async () => {
    // P1.A7. Full mode + intake: the precondition fails closed because nothing produces the product context yet.
    const full = await initialized("membership-product");
    const before = hashTree(full, { exclude: [] });
    const unmet = await runCliCaptured(["gate", "intake", "approve", "--yes", full]);
    expect(unmet.code).toBe(ExitCode.Blocked);
    expect(unmet.stderr).toContain(
      'Precondition "intake-context-valid" is not met for "approve-gate:intake" from phase "initialized": productContextValid is not available.',
    );

    // Full mode + direction (no Penpot facts in P1): precondition fails, nothing written.
    setPhase(full, "directions-ready");
    const afterPhase = hashTree(full, { exclude: [] });
    const direction = await runCliCaptured(["gate", "direction", "approve", "--yes", full]);
    expect(direction.code).toBe(ExitCode.Blocked);
    expect(direction.stderr).toContain('Precondition "direction-selectable" is not met');
    expect(hashTree(full, { exclude: [] })).toEqual(afterPhase);
    expect(before).not.toEqual(afterPhase);

    // Reference-only + production gate: MODE_BLOCKED with the cause from describeModeBlock.
    const ref = await initialized("no-ux");
    setPhase(ref, "directions-ready");
    const blocked = await runCliCaptured(["gate", "direction", "approve", "--yes", ref]);
    expect(blocked.code).toBe(ExitCode.Blocked);
    expect(blocked.stderr).toContain(
      "approve-gate:direction requires FULL PRODUCT mode; current mode is REFERENCE ONLY (",
    );
    expect(blocked.stderr).toContain(").");

    // Confirmation: neither TTY nor --yes, or a denied prompt -> exit 2 and nothing written.
    const root = await initialized("membership-product");
    const snapshot = hashTree(root, { exclude: [] });
    const noTty = await runCliCaptured([...REJECT, root]);
    expect(noTty.code).toBe(ExitCode.Usage);
    expect(noTty.stderr).toBe("Gate decisions need an interactive terminal or --yes.\n");
    const questions: string[] = [];
    const denied = await runCliCaptured(
      [...REJECT, root],
      fixedContext({
        isTTY: true,
        confirm: async (question) => {
          questions.push(question);
          return false;
        },
      }),
    );
    expect(denied.code).toBe(ExitCode.Usage);
    expect(denied.stderr).toBe("Gate decision cancelled; nothing was written.\n");
    expect(questions).toEqual(['Reject gate "intake" bound to 1 artifact(s)? [y/N] ']);
    expect(hashTree(root, { exclude: [] })).toEqual(snapshot);

    // Identity: empty OS user -> exit 2.
    const anonymous = await runCliCaptured(
      [...REJECT, "--yes", root],
      fixedContext({ identity: { current: () => "  " } }),
    );
    expect(anonymous.code).toBe(ExitCode.Usage);
    expect(anonymous.stderr).toBe(
      "Cannot determine who is deciding the gate (OS user is empty).\n",
    );

    // Reason: a rejection without --reason -> exit 2.
    const noReason = await runCliCaptured(["gate", "intake", "reject", "--yes", root]);
    expect(noReason.code).toBe(ExitCode.Usage);
    expect(noReason.stderr).toBe("heron gate intake reject requires --reason <text>.\n");
    expect(hashTree(root, { exclude: [] })).toEqual(snapshot);
  });

  // Covers: R9, R10
  test("records a confirmed rejection bound to the artifact hashes and commits only state.json", async () => {
    const root = await initialized("membership-product");
    const before = hashTree(root, { exclude: [] });
    const run = await runCliCaptured(
      [...REJECT, root],
      fixedContext({ isTTY: true, confirm: async () => true }),
    );
    expect(run.code).toBe(ExitCode.Ok);
    expect(run.stderr).toBe("");
    expect(run.stdout).toBe(
      [
        'Gate "intake" rejected by tester.',
        "Bound artifacts: 1",
        "Phase: initialized -> initialized",
        "State revision: 2",
        "",
      ].join("\n"),
    );
    const after = hashTree(root, { exclude: [] });
    const changed = [...after.keys()].filter((path) => after.get(path) !== before.get(path));
    expect(changed).toEqual([".heron/state.json"]);
    const state = readState(root);
    const decision = state.gates.at(-1);
    expect(decision).toMatchObject({
      gate: "intake",
      decision: "rejected",
      decidedBy: "tester",
      reason: "needs more context",
      stateRevision: 2,
    });
    expect(decision?.artifacts.map((artifact) => artifact.path)).toEqual(["intake/mode.json"]);
    expect(state.history.at(-1)?.command).toBe("gate");

    const status = await runCliCaptured(["status", root]);
    expect(status.stdout).toContain("- intake: rejected");
  });

  // Covers: R9
  test("emits one envelope with --json and exits with the mapped code", async () => {
    const root = await initialized("membership-product");
    const ok = await runCliCaptured([...REJECT, "--yes", "--json", root]);
    expect(ok.code).toBe(ExitCode.Ok);
    const envelope = JSON.parse(ok.stdout) as CliEnvelope;
    expect(envelope.command).toBe("gate");
    expect(envelope.ok).toBe(true);
    expect((envelope.data as GateData).decision).toBe("rejected");

    const blocked = await runCliCaptured(["gate", "intake", "approve", "--yes", "--json", root]);
    expect(blocked.code).toBe(ExitCode.Blocked);
    const failed = JSON.parse(blocked.stdout) as CliEnvelope;
    expect(failed.ok).toBe(false);
    expect(failed.findings[0]?.code).toBe("PRECONDITION_UNMET");
  });

  // Covers: R11
  test("fails with exit 3 before init and exit 6 while another command holds the lock", async () => {
    const empty = fresh("no-ux");
    const missing = await runCliCaptured([...REJECT, "--yes", empty]);
    expect(missing.code).toBe(ExitCode.Blocked);
    expect(missing.stderr).toBe(`.heron/state.json not found. Run: heron init ${empty}\n`);
    const gone = await runCliCaptured([...REJECT, "--yes", join(empty, "nope")]);
    expect(gone.code).toBe(ExitCode.Usage);

    const root = await initialized("no-ux");
    writeFileSync(
      join(root, ".heron", ".lock"),
      JSON.stringify({
        runId: "run-20260930T110000Z-deadbeef",
        pid: process.pid,
        hostname: "test-host",
        command: "init",
        acquiredAt: "2026-09-30T11:00:00.000Z",
      }),
    );
    const busy = await runCliCaptured([...REJECT, "--yes", root]);
    expect(busy.code).toBe(ExitCode.LockBusy);
    expect(busy.stderr).toContain('.heron/ is locked by "init"');
  });

  // Covers: R9
  test("collectTransitionFacts always supplies invalidatedGates and counts the bound files", async () => {
    const root = await initialized("membership-product");
    const store = openFileStore(nodeFs, root, { create: false });
    const state = readState(root);
    const withGate = collectTransitionFacts(store, state, "intake", nodeFs);
    expect(withGate).toEqual({
      invalidatedGates: [],
      intakeApprovalValid: false,
      boundArtifactCount: 1,
    });
    const without = collectTransitionFacts(store, state, null, nodeFs);
    expect(without.invalidatedGates).toEqual([]);
    expect(without.boundArtifactCount).toBeUndefined();
    expect(collectTransitionFacts(store, state, "foundations", nodeFs).boundArtifactCount).toBe(0);

    // `dir/**` bindings walk nested directories and never follow symlinks.
    const foundations = join(root, ".heron", "design", "foundations");
    mkdirSync(join(foundations, "color"), { recursive: true });
    writeFileSync(join(foundations, "color", "palette.md"), "palette");
    writeFileSync(join(foundations, "type.md"), "type");
    symlinkSync(join(root, "specs"), join(foundations, "link"));
    expect(collectTransitionFacts(store, state, "foundations", nodeFs).boundArtifactCount).toBe(2);
  });
});
