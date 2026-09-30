// Covers: R8
import { describe, expect, test } from "bun:test";
import {
  GATE_NAMES,
  HERON_PHASES,
  type GateName,
  type HeronEvent,
  type HeronMode,
  type HeronPhase,
  type HeronState,
} from "../../src/core/contracts/index.ts";
import {
  TRANSITIONS,
  allowedEvents,
  applyTransition,
  canTransition,
  eventKey,
  type TransitionFacts,
  type TransitionMeta,
  type TransitionRule,
} from "../../src/core/state/transitions.ts";

const HASH = "a".repeat(64);
const meta: TransitionMeta = {
  runId: "run-20260930T120000Z-3f9a1c2b",
  at: "2026-09-30T12:00:00.000Z",
  command: "gate approve",
  heronVersion: "0.0.0",
};

function stateAt(phase: HeronPhase, mode: HeronMode, approved: GateName[] = []): HeronState {
  return {
    kind: "HeronState",
    schemaVersion: 1,
    stateRevision: 3,
    mode,
    phase,
    designRevision: 0,
    artifacts: [],
    gates: approved.map((gate) => ({
      gate,
      decision: "approved" as const,
      decidedBy: "ana",
      decidedAt: meta.at,
      artifacts: [{ path: "intake/mode.json", sha256: HASH }],
      stateRevision: 2,
      runId: meta.runId,
      note: null,
    })),
    stale: [],
    history: [],
  };
}

/** Facts that satisfy every precondition. */
const SATISFIED: TransitionFacts = {
  productContextValid: true,
  unacknowledgedConflicts: 0,
  referenceComplete: true,
  referencesWithProvenance: 5,
  validDirections: 3,
  directionSelected: true,
  intakeApprovalValid: true,
  foundationsAreas: 14,
  tokenOrA11yFails: 0,
  representativeCategoriesCovered: true,
  orphanComponents: 0,
  patternsWithoutScreen: 0,
  screensDesigned: 4,
  screensTotal: 4,
  penpotEnabled: true,
  penpotProposalsWritten: 3,
  penpotSyncErrors: 0,
  penpotFileIdMatches: true,
  penpotDrift: 0,
  validationFails: 0,
  exportVerified: true,
  reviseScopeDeclared: true,
  boundArtifactCount: 1,
  invalidatedGates: [],
};

function eventOf(row: TransitionRule): HeronEvent {
  const [kind, arg] = row.event.split(":");
  if (kind === "approve-gate" || kind === "reject-gate") {
    return { type: kind, gate: GATE_NAMES.find((g) => g === arg) as GateName };
  }
  if (kind === "revise") return { type: "revise", target: HERON_PHASES.find((p) => p === arg)! };
  return { type: row.event } as HeronEvent;
}

/** Facts making the row's own precondition pass; penpot disabled variant for the pre-Penpot rows. */
function factsFor(row: TransitionRule): TransitionFacts {
  return row.precondition === "validation-clean-penpot-disabled"
    ? { ...SATISFIED, penpotEnabled: false }
    : SATISFIED;
}

function approvedFor(row: TransitionRule): GateName[] {
  const gate = row.event.startsWith("reject-gate:") ? row.event.slice(12) : null;
  const found = GATE_NAMES.find((g) => g === gate);
  return found === undefined ? [] : [found];
}

describe("transition table", () => {
  test("blocks production transitions in reference-only and rejects pairs outside the table", () => {
    // 108 unique rows by (from, event)
    expect(TRANSITIONS.length).toBe(108);
    const keys = new Set(TRANSITIONS.map((r) => `${r.from}|${r.event}`));
    expect(keys.size).toBe(108);
    expect(TRANSITIONS.filter((r) => r.event.startsWith("reject-gate:")).length).toBe(52);
    expect(TRANSITIONS.filter((r) => r.event.startsWith("revise:")).length).toBe(28);

    // every one of the 13 x 31 combinations: in table -> not TRANSITION_NOT_ALLOWED, else rejected
    const allEvents: HeronEvent[] = [
      { type: "reference-added" },
      { type: "directions-proposed" },
      { type: "system-completed" },
      { type: "screens-completed" },
      { type: "validation-passed" },
      { type: "export-written" },
      ...GATE_NAMES.flatMap((gate) => [
        { type: "approve-gate", gate } as const,
        { type: "reject-gate", gate } as const,
      ]),
      ...HERON_PHASES.map((target) => ({ type: "revise", target }) as const),
    ];
    expect(allEvents.length).toBe(31);
    let outside = 0;
    for (const phase of HERON_PHASES) {
      for (const event of allEvents) {
        const inTable = keys.has(`${phase}|${eventKey(event)}`);
        const result = canTransition(stateAt(phase, "full"), event, SATISFIED);
        if (!inTable) {
          outside += 1;
          expect(result.ok).toBe(false);
          if (!result.ok) {
            expect(result.code).toBe("TRANSITION_NOT_ALLOWED");
            expect(result.reason).toBe(
              `No transition for "${eventKey(event)}" from phase "${phase}".`,
            );
          }
        }
      }
    }
    expect(outside).toBe(13 * 31 - 108);

    for (const row of TRANSITIONS) {
      const event = eventOf(row);
      const approved = approvedFor(row);
      const facts = factsFor(row);
      // full mode with satisfied facts passes
      const full = canTransition(stateAt(row.from, "full", approved), event, facts);
      expect(full.ok).toBe(true);
      // reference-only: production rows are blocked without evaluating the precondition
      const ref = canTransition(stateAt(row.from, "reference-only", approved), event, facts);
      if (row.production) {
        expect(ref.ok).toBe(false);
        if (!ref.ok) expect(ref.code).toBe("MODE_BLOCKED");
        const refEmpty = canTransition(stateAt(row.from, "reference-only"), event, {});
        if (!refEmpty.ok) expect(refEmpty.code).toBe("MODE_BLOCKED");
      } else {
        expect(ref.ok).toBe(true);
      }
      // every row checks something real: empty facts and no approvals fail
      const empty = canTransition(stateAt(row.from, "full"), event, {});
      expect(empty.ok).toBe(false);
    }
  });

  test("direction-selectable requires Penpot proposals (D26)", () => {
    const row = TRANSITIONS.find(
      (r) => r.from === "directions-ready" && r.event === "approve-gate:direction",
    );
    expect(row?.production).toBe(true);
    const event: HeronEvent = { type: "approve-gate", gate: "direction" };
    const state = stateAt("directions-ready", "full");
    for (const penpot of [{ penpotEnabled: false }, { penpotProposalsWritten: 2 }]) {
      const result = canTransition(state, event, { ...SATISFIED, ...penpot });
      expect(result.ok).toBe(false);
      if (!result.ok && result.code === "PRECONDITION_UNMET") {
        expect(result.precondition).toBe("direction-selectable");
        expect(result.reason).toContain("PENPOT_REQUIRED_FOR_DIRECTION");
      }
    }
  });

  test("approvals guard blocks production rows when another gate is invalidated", () => {
    const state = stateAt("direction-selected", "full");
    const event: HeronEvent = { type: "approve-gate", gate: "foundations" };
    const blocked = canTransition(state, event, { ...SATISFIED, invalidatedGates: ["intake"] });
    expect(blocked.ok).toBe(false);
    if (!blocked.ok && blocked.code === "PRECONDITION_UNMET") {
      expect(blocked.precondition).toBe("approvals-valid");
    }
    // the event's own gate is excluded from the guard
    expect(
      canTransition(state, event, { ...SATISFIED, invalidatedGates: ["foundations"] }).ok,
    ).toBe(true);
    // absent invalidatedGates fails closed
    const { invalidatedGates: _omit, ...without } = SATISFIED;
    expect(canTransition(state, event, without).ok).toBe(false);
  });

  test("applyTransition advances the phase, appends history and marks stale on regression", () => {
    const base = stateAt("foundations-ready", "full", ["foundations"]);
    const state: HeronState = {
      ...base,
      artifacts: [
        { path: "design/foundations/colors.json", sha256: HASH },
        { path: "design/screens/home.json", sha256: HASH },
      ],
    };
    const forward = applyTransition(
      stateAt("initialized", "full"),
      { type: "approve-gate", gate: "intake" },
      SATISFIED,
      meta,
    );
    expect(forward.ok).toBe(true);
    if (forward.ok) {
      expect(forward.state.phase).toBe("intake-ready");
      expect(forward.state.stateRevision).toBe(4);
      expect(forward.state.history.at(-1)?.transition).toEqual(forward.transition);
    }
    const input = structuredClone(state);
    const back = applyTransition(
      state,
      { type: "revise", target: "direction-selected" },
      SATISFIED,
      meta,
    );
    expect(state).toEqual(input);
    expect(back.ok).toBe(true);
    if (back.ok) {
      expect(back.state.phase).toBe("direction-selected");
      expect(back.state.stale.map((s) => s.path)).toEqual([
        "design/foundations/colors.json",
        "design/screens/home.json",
      ]);
    }
    const rejected = applyTransition(
      state,
      { type: "revise", target: "direction-selected" },
      {},
      meta,
    );
    expect(rejected.ok).toBe(false);
  });

  test("allowedEvents lists rows passing the mode guard", () => {
    const full = allowedEvents(stateAt("directions-ready", "full")).map(eventKey);
    const ref = allowedEvents(stateAt("directions-ready", "reference-only")).map(eventKey);
    expect(full).toContain("approve-gate:direction");
    expect(ref).not.toContain("approve-gate:direction");
    expect(ref).toContain("approve-gate:intake");
    expect(full).toContain("reject-gate:intake");
  });
});
