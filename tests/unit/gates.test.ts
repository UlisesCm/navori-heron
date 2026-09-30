// Covers: R8, R9
import { describe, expect, test } from "bun:test";
import {
  type BoundArtifact,
  type HeronState,
  type RelativeArtifactPath,
  type Sha256Hex,
} from "../../src/core/contracts/index.ts";
import {
  GATE_BINDINGS,
  approveGate,
  gateStatuses,
  invalidatedGates,
  isApprovalValid,
  latestDecision,
  rejectGate,
} from "../../src/core/state/gates.ts";
import { createInitialState } from "../../src/core/state/lifecycle.ts";
import type { TransitionFacts, TransitionMeta } from "../../src/core/state/transitions.ts";

const H1 = "1".repeat(64);
const H2 = "2".repeat(64);
const meta: TransitionMeta = {
  runId: "run-20260930T120000Z-3f9a1c2b",
  at: "2026-09-30T12:00:00.000Z",
  command: "gate approve",
  heronVersion: "0.0.0",
};
const facts: TransitionFacts = {
  productContextValid: true,
  unacknowledgedConflicts: 0,
  boundArtifactCount: 1,
};
const bound: BoundArtifact[] = [
  { path: "intake/product-context.json", sha256: H2 },
  { path: "intake/mode.json", sha256: H1 },
];

function approvedState(): HeronState {
  const initial = createInitialState({ mode: "full", artifacts: [], meta });
  const out = approveGate(
    initial,
    { gate: "intake", decidedBy: "ana", note: null, artifacts: bound, meta },
    facts,
  );
  if (!out.ok) throw new Error(out.reason);
  return out.state;
}

describe("gate approvals", () => {
  test("invalidates an approval when a bound artifact hash changes", () => {
    const state = approvedState();
    const decision = latestDecision(state, "intake");
    expect(decision?.decision).toBe("approved");
    if (decision === null) return;
    const same = new Map<RelativeArtifactPath, Sha256Hex>([
      ["intake/mode.json", H1],
      ["intake/product-context.json", H2],
    ]);
    expect(isApprovalValid(decision, same)).toEqual({ valid: true });
    expect(invalidatedGates(state, same)).toEqual([]);
    expect(gateStatuses(state, same).intake).toBe("approved");

    const changed = new Map(same).set("intake/mode.json", H2);
    expect(isApprovalValid(decision, changed)).toEqual({
      valid: false,
      changed: ["intake/mode.json"],
      missing: [],
    });
    expect(invalidatedGates(state, changed)).toEqual(["intake"]);
    expect(gateStatuses(state, changed).intake).toBe("invalidated");

    const gone = new Map(same);
    gone.delete("intake/product-context.json");
    expect(isApprovalValid(decision, gone)).toEqual({
      valid: false,
      changed: [],
      missing: ["intake/product-context.json"],
    });
  });

  test("approveGate records a sorted decision bound to the new revision", () => {
    const state = approvedState();
    const decision = latestDecision(state, "intake");
    expect(state.phase).toBe("intake-ready");
    expect(state.stateRevision).toBe(2);
    expect(decision?.stateRevision).toBe(2);
    expect(decision?.artifacts.map((a) => a.path)).toEqual([
      "intake/mode.json",
      "intake/product-context.json",
    ]);
  });

  test("approveGate validates identity, transition and bound artifacts in order", () => {
    const initial = createInitialState({ mode: "full", artifacts: [], meta });
    const input = { gate: "intake", decidedBy: "ana", note: null, artifacts: bound, meta } as const;
    const noId = approveGate(initial, { ...input, decidedBy: " " }, facts);
    expect(noId.ok === false && noId.code).toBe("IDENTITY_REQUIRED");
    const notAllowed = approveGate(initial, { ...input, gate: "research" }, facts);
    expect(notAllowed.ok === false && notAllowed.code).toBe("TRANSITION_NOT_ALLOWED");
    const unmet = approveGate(initial, input, {});
    expect(unmet.ok === false && unmet.code).toBe("PRECONDITION_UNMET");
    const none = approveGate(initial, { ...input, artifacts: [] }, facts);
    expect(none.ok === false && none.code).toBe("NO_BOUND_ARTIFACTS");
  });

  test("rejectGate requires a reason and loops a pending gate without stale", () => {
    const initial = createInitialState({ mode: "full", artifacts: [], meta });
    const input = { gate: "intake", decidedBy: "ana", reason: "", artifacts: bound, meta } as const;
    const noReason = rejectGate(initial, input, facts);
    expect(noReason.ok === false && noReason.code).toBe("REASON_REQUIRED");
    const noId = rejectGate(initial, { ...input, decidedBy: "", reason: "x" }, facts);
    expect(noId.ok === false && noId.code).toBe("IDENTITY_REQUIRED");
    const ok = rejectGate(initial, { ...input, reason: "needs work" }, facts);
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.state.phase).toBe("initialized");
      expect(ok.decision.decision).toBe("rejected");
      expect(gateStatuses(ok.state, new Map()).intake).toBe("rejected");
    }
  });

  test("rejecting an approved gate regresses the phase and marks later artifacts stale", () => {
    const approved = approvedState();
    const withArtifacts: HeronState = {
      ...approved,
      artifacts: [
        { path: "intake/mode.json", sha256: H1 },
        { path: "intake/product-context.json", sha256: H2 },
      ],
    };
    const out = rejectGate(
      withArtifacts,
      { gate: "intake", decidedBy: "ana", reason: "redo", artifacts: [], meta },
      {},
    );
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.state.phase).toBe("initialized");
      expect(out.state.stale.map((s) => s.path)).toEqual(["intake/product-context.json"]);
    }
  });

  test("gateStatuses marks reachable gates pending and the rest not-reached", () => {
    const initial = createInitialState({ mode: "full", artifacts: [], meta });
    const statuses = gateStatuses(initial, new Map());
    expect(statuses.intake).toBe("pending");
    expect(statuses.research).toBe("not-reached");
    expect(statuses["visual-review"]).toBe("not-reached");
  });

  test("GATE_BINDINGS covers every gate", () => {
    expect(Object.keys(GATE_BINDINGS).length).toBe(6);
    expect(GATE_BINDINGS.direction).toEqual(["research/visual-directions.json"]);
  });
});
