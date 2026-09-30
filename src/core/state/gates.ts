import {
  GATE_NAMES,
  type BoundArtifact,
  type GateDecision,
  type GateName,
  type GateStatus,
  type HeronState,
  type RelativeArtifactPath,
  type Sha256Hex,
  type Transition,
} from "../contracts/index.ts";
import { compareStrings } from "./stale.ts";
import {
  applyTransition,
  canTransition,
  TRANSITIONS,
  type TransitionFacts,
  type TransitionMeta,
  type TransitionRejection,
} from "./transitions.ts";

/** Glob patterns relative to .heron/ whose files are bound to each gate decision. */
export const GATE_BINDINGS: Readonly<Record<GateName, readonly string[]>> = {
  intake: ["intake/mode.json", "intake/product-context.json", "intake/conflicts.json"],
  research: ["research/references.json", "research/provenance.json"],
  direction: ["research/visual-directions.json"],
  foundations: ["design/foundations/**", "design/tokens/**", "design/DESIGN.md"],
  "representative-screens": ["design/screens/**"],
  "visual-review": ["penpot/sync-state.json"],
};

export type GateApprovalInput = {
  gate: GateName;
  decidedBy: string;
  note: string | null;
  artifacts: BoundArtifact[];
  meta: TransitionMeta;
};
export type GateRejectionInput = {
  gate: GateName;
  decidedBy: string;
  reason: string;
  artifacts: BoundArtifact[];
  meta: TransitionMeta;
};
export type GateOutcome =
  | { ok: true; state: HeronState; decision: GateDecision; transition: Transition }
  | TransitionRejection
  | {
      ok: false;
      code: "IDENTITY_REQUIRED" | "REASON_REQUIRED" | "NO_BOUND_ARTIFACTS";
      reason: string;
    };

const byPath = (a: BoundArtifact, b: BoundArtifact): number => compareStrings(a.path, b.path);

/** Order: decidedBy non-empty -> canTransition(approve-gate:{gate}) -> artifacts.length >= 1 (else NO_BOUND_ARTIFACTS,
 * rendered as finding PRECONDITION_UNMET, exit 3) -> applyTransition. */
export function approveGate(
  state: HeronState,
  input: GateApprovalInput,
  facts: TransitionFacts,
): GateOutcome {
  if (input.decidedBy.trim() === "") {
    return {
      ok: false,
      code: "IDENTITY_REQUIRED",
      reason: "Cannot determine who is deciding the gate (OS user is empty).",
    };
  }
  const event = { type: "approve-gate", gate: input.gate } as const;
  const checked = canTransition(state, event, facts);
  if (!checked.ok) return checked;
  if (input.artifacts.length < 1) {
    return {
      ok: false,
      code: "NO_BOUND_ARTIFACTS",
      reason: `Gate "${input.gate}" has no bound artifacts to review.`,
    };
  }
  const outcome = applyTransition(state, event, facts, input.meta);
  if (!outcome.ok) return outcome;
  const decision: GateDecision = {
    gate: input.gate,
    decision: "approved",
    decidedBy: input.decidedBy,
    decidedAt: input.meta.at,
    artifacts: input.artifacts.toSorted(byPath),
    stateRevision: outcome.state.stateRevision,
    runId: input.meta.runId,
    note: input.note,
  };
  return {
    ok: true,
    state: { ...outcome.state, gates: [...outcome.state.gates, decision] },
    decision,
    transition: outcome.transition,
  };
}

/** reject-gate:{gate}; requires non-empty reason; a regression marks later artifacts stale. */
export function rejectGate(
  state: HeronState,
  input: GateRejectionInput,
  facts: TransitionFacts,
): GateOutcome {
  if (input.decidedBy.trim() === "") {
    return {
      ok: false,
      code: "IDENTITY_REQUIRED",
      reason: "Cannot determine who is deciding the gate (OS user is empty).",
    };
  }
  if (input.reason.trim() === "") {
    return {
      ok: false,
      code: "REASON_REQUIRED",
      reason: `heron gate ${input.gate} reject requires --reason <text>.`,
    };
  }
  const outcome = applyTransition(
    state,
    { type: "reject-gate", gate: input.gate },
    facts,
    input.meta,
  );
  if (!outcome.ok) return outcome;
  const decision: GateDecision = {
    gate: input.gate,
    decision: "rejected",
    decidedBy: input.decidedBy,
    decidedAt: input.meta.at,
    artifacts: input.artifacts.toSorted(byPath),
    stateRevision: outcome.state.stateRevision,
    runId: input.meta.runId,
    reason: input.reason,
  };
  return {
    ok: true,
    state: { ...outcome.state, gates: [...outcome.state.gates, decision] },
    decision,
    transition: outcome.transition,
  };
}

export type ApprovalValidity =
  | { valid: true }
  | { valid: false; changed: RelativeArtifactPath[]; missing: RelativeArtifactPath[] };

/** `current` maps each bound path to its sha256 now; an absent key means the file is missing. */
export function isApprovalValid(
  decision: GateDecision,
  current: ReadonlyMap<RelativeArtifactPath, Sha256Hex>,
): ApprovalValidity {
  const changed: RelativeArtifactPath[] = [];
  const missing: RelativeArtifactPath[] = [];
  for (const artifact of decision.artifacts) {
    const now = current.get(artifact.path);
    if (now === undefined) missing.push(artifact.path);
    else if (now !== artifact.sha256) changed.push(artifact.path);
  }
  return changed.length === 0 && missing.length === 0
    ? { valid: true }
    : { valid: false, changed, missing };
}

export function latestDecision(state: HeronState, gate: GateName): GateDecision | null {
  return state.gates.findLast((decision) => decision.gate === gate) ?? null;
}

/** Gates whose latest decision is an approval that is no longer valid. */
export function invalidatedGates(
  state: HeronState,
  current: ReadonlyMap<RelativeArtifactPath, Sha256Hex>,
): GateName[] {
  return GATE_NAMES.filter((gate) => {
    const decision = latestDecision(state, gate);
    return decision?.decision === "approved" && !isApprovalValid(decision, current).valid;
  });
}

export function gateStatuses(
  state: HeronState,
  current: ReadonlyMap<RelativeArtifactPath, Sha256Hex>,
): Record<GateName, GateStatus> {
  const statusOf = (gate: GateName): GateStatus => {
    const decision = latestDecision(state, gate);
    if (decision?.decision === "rejected") return "rejected";
    if (decision?.decision === "approved") {
      return isApprovalValid(decision, current).valid ? "approved" : "invalidated";
    }
    const reachable = canTransitionRowExists(state, gate);
    return reachable ? "pending" : "not-reached";
  };
  return Object.fromEntries(GATE_NAMES.map((gate) => [gate, statusOf(gate)])) as Record<
    GateName,
    GateStatus
  >;
}

/** True when the table has an approve-gate row for `gate` from the current phase (mode not considered). */
function canTransitionRowExists(state: HeronState, gate: GateName): boolean {
  return TRANSITIONS.some(
    (row) => row.from === state.phase && row.event === `approve-gate:${gate}`,
  );
}
