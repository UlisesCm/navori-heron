import {
  GATE_NAMES,
  HERON_PHASES,
  PRODUCTION_PHASES,
  type GateName,
  type HeronEvent,
  type HeronPhase,
  type HeronState,
  type IsoDateTime,
  type PreconditionId,
  type RunId,
  type Transition,
  type TransitionEventKey,
} from "../contracts/index.ts";
import { markStaleAfter } from "./stale.ts";

export type TransitionFacts = Partial<{
  productContextValid: boolean;
  unacknowledgedConflicts: number;
  referenceComplete: boolean;
  referencesWithProvenance: number;
  minReferences: number; // default 5 (D16)
  validDirections: number;
  directionSelected: boolean;
  intakeApprovalValid: boolean;
  foundationsAreas: number;
  tokenOrA11yFails: number;
  representativeCategoriesCovered: boolean;
  orphanComponents: number;
  patternsWithoutScreen: number;
  screensDesigned: number;
  screensTotal: number;
  penpotEnabled: boolean;
  penpotProposalsWritten: number; // direction proposal pages written to Penpot (D23-D26; produced from P12)
  penpotSyncErrors: number;
  penpotFileIdMatches: boolean;
  penpotDrift: number;
  validationFails: number;
  exportVerified: boolean;
  reviseScopeDeclared: boolean;
  boundArtifactCount: number; // files matching GATE_BINDINGS of the event's gate
  invalidatedGates: GateName[];
}>; // an absent fact makes its precondition fail with detail "{fact} is not available"

export type PreconditionResult = { ok: true } | { ok: false; detail: string };
export interface TransitionRule extends Transition {
  readonly description: string;
  readonly check: (facts: TransitionFacts, state: HeronState) => PreconditionResult;
}

export type TransitionRejection =
  | { ok: false; code: "TRANSITION_NOT_ALLOWED"; reason: string }
  | { ok: false; code: "MODE_BLOCKED"; reason: string; rule: TransitionRule }
  | {
      ok: false;
      code: "PRECONDITION_UNMET";
      reason: string;
      rule: TransitionRule;
      precondition: PreconditionId;
    };
export type TransitionCheck = { ok: true; rule: TransitionRule } | TransitionRejection;
export type TransitionMeta = {
  runId: RunId;
  at: IsoDateTime;
  command: string;
  heronVersion: string;
};
export type TransitionOutcome =
  | { ok: true; state: HeronState; transition: Transition }
  | TransitionRejection;

const OK: PreconditionResult = { ok: true };
const unmet = (detail: string): PreconditionResult => ({ ok: false, detail });
const missing = (fact: keyof TransitionFacts): PreconditionResult =>
  unmet(`${fact} is not available`);

/** Returns the first absent fact of `keys`, or null when all are present. */
function firstMissing(facts: TransitionFacts, keys: readonly (keyof TransitionFacts)[]) {
  return keys.find((key) => facts[key] === undefined) ?? null;
}

/** Builds a predicate over facts: absent facts fail with "{fact} is not available". */
function predicate(
  keys: readonly (keyof TransitionFacts)[],
  test: (facts: TransitionFacts) => string | null,
): (facts: TransitionFacts) => PreconditionResult {
  return (facts) => {
    const absent = firstMissing(facts, keys);
    if (absent !== null) return missing(absent);
    const failure = test(facts);
    return failure === null ? OK : unmet(failure);
  };
}

const FACT_CHECKS: Partial<Record<PreconditionId, (facts: TransitionFacts) => PreconditionResult>> =
  {
    "intake-context-valid": predicate(["productContextValid", "unacknowledgedConflicts"], (f) =>
      f.productContextValid === true && f.unacknowledgedConflicts === 0
        ? null
        : "the product context is invalid or has unacknowledged conflicts",
    ),
    "reference-has-provenance": predicate(["referenceComplete"], (f) =>
      f.referenceComplete === true ? null : "the reference lacks provenance",
    ),
    "research-minimum-references": predicate(["referencesWithProvenance"], (f) => {
      const min = f.minReferences ?? 5;
      return (f.referencesWithProvenance ?? 0) >= min
        ? null
        : `at least ${min} references with provenance are required`;
    }),
    "three-valid-directions": predicate(["validDirections"], (f) =>
      f.validDirections === 3 ? null : "exactly 3 valid directions are required",
    ),
    "direction-selectable": (f) => {
      const absent = firstMissing(f, ["intakeApprovalValid", "directionSelected", "penpotEnabled"]);
      if (absent !== null) return missing(absent);
      if (f.intakeApprovalValid !== true) return unmet("the intake approval is not valid");
      if (f.directionSelected !== true) return unmet("no direction is selected");
      if (f.penpotEnabled !== true || f.penpotProposalsWritten !== 3) {
        return unmet(
          "PENPOT_REQUIRED_FOR_DIRECTION: the 3 direction proposals must be written to Penpot",
        );
      }
      return OK;
    },
    "foundations-complete": predicate(["foundationsAreas", "tokenOrA11yFails"], (f) =>
      f.foundationsAreas === 14 && f.tokenOrA11yFails === 0
        ? null
        : "14 foundation areas without token or accessibility failures are required",
    ),
    "representative-screens-cover-categories": predicate(
      ["representativeCategoriesCovered"],
      (f) =>
        f.representativeCategoriesCovered === true
          ? null
          : "the representative screens do not cover all categories",
    ),
    "system-consistent": predicate(["orphanComponents", "patternsWithoutScreen"], (f) =>
      f.orphanComponents === 0 && f.patternsWithoutScreen === 0
        ? null
        : "there are orphan components or patterns without a screen",
    ),
    "all-screens-designed": predicate(["screensDesigned", "screensTotal"], (f) =>
      (f.screensTotal ?? 0) > 0 && f.screensDesigned === f.screensTotal
        ? null
        : "not every screen is designed",
    ),
    "penpot-sync-clean": predicate(
      ["penpotEnabled", "penpotSyncErrors", "penpotFileIdMatches", "penpotDrift"],
      (f) =>
        f.penpotEnabled === true &&
        f.penpotSyncErrors === 0 &&
        f.penpotFileIdMatches === true &&
        f.penpotDrift === 0
          ? null
          : "the Penpot sync is not clean",
    ),
    "validation-clean-penpot-disabled": predicate(["penpotEnabled", "validationFails"], (f) =>
      f.penpotEnabled === false && f.validationFails === 0
        ? null
        : "Penpot must be disabled and validation must have no failures",
    ),
    "validation-clean": predicate(["validationFails"], (f) =>
      f.validationFails === 0 ? null : "validation has failures",
    ),
    "export-verified": predicate(["exportVerified"], (f) =>
      f.exportVerified === true ? null : "the export is not verified",
    ),
    "revise-scope-declared": predicate(["reviseScopeDeclared"], (f) =>
      f.reviseScopeDeclared === true ? null : "the revision scope is not declared",
    ),
  };

/** Index of a phase in HERON_PHASES order. */
export function phaseIndex(phase: HeronPhase): number {
  return HERON_PHASES.indexOf(phase);
}

export function isProductionPhase(phase: HeronPhase): boolean {
  return PRODUCTION_PHASES.includes(phase);
}

export function eventKey(event: HeronEvent): TransitionEventKey {
  switch (event.type) {
    case "approve-gate":
    case "reject-gate":
      return `${event.type}:${event.gate}`;
    case "revise":
      return `revise:${event.target}`;
    default:
      return event.type;
  }
}

function parseEventKey(key: TransitionEventKey): HeronEvent {
  const [kind, arg] = key.split(":");
  const gate = GATE_NAMES.find((name) => name === arg);
  const phase = HERON_PHASES.find((name) => name === arg);
  if (kind === "approve-gate" && gate !== undefined) return { type: "approve-gate", gate };
  if (kind === "reject-gate" && gate !== undefined) return { type: "reject-gate", gate };
  if (kind === "revise" && phase !== undefined) return { type: "revise", target: phase };
  return { type: key as Exclude<HeronEvent["type"], "approve-gate" | "reject-gate" | "revise"> };
}

/** Latest recorded decision of a gate (local copy of gates.latestDecision to avoid a cycle). */
function latestDecisionOf(state: HeronState, gate: GateName) {
  return state.gates.findLast((decision) => decision.gate === gate) ?? null;
}

const APPROVE_FROM = new Set<string>(); // `${from}|${gate}` of every approve-gate row, filled while building

function rule(
  from: HeronPhase,
  event: TransitionEventKey,
  to: HeronPhase,
  precondition: PreconditionId,
  check: TransitionRule["check"],
): TransitionRule {
  return {
    from,
    event,
    to,
    precondition,
    production: isProductionPhase(to),
    description: `${event} from ${from} -> ${to} (${precondition})`,
    check,
  };
}

function factRule(
  from: HeronPhase,
  event: TransitionEventKey,
  to: HeronPhase,
  precondition: PreconditionId,
): TransitionRule {
  const check = FACT_CHECKS[precondition];
  if (check === undefined) throw new Error(`No fact check for ${precondition}`);
  return rule(from, event, to, precondition, (facts) => check(facts));
}

type Row = readonly [HeronPhase, TransitionEventKey, HeronPhase, PreconditionId];
const FORWARD_ROWS: readonly Row[] = [
  ["initialized", "approve-gate:intake", "intake-ready", "intake-context-valid"],
  ["researching", "approve-gate:intake", "researching", "intake-context-valid"],
  ["research-ready", "approve-gate:intake", "research-ready", "intake-context-valid"],
  ["directions-ready", "approve-gate:intake", "directions-ready", "intake-context-valid"],
  ["initialized", "reference-added", "researching", "reference-has-provenance"],
  ["intake-ready", "reference-added", "researching", "reference-has-provenance"],
  ["researching", "reference-added", "researching", "reference-has-provenance"],
  ["research-ready", "reference-added", "researching", "reference-has-provenance"],
  ["directions-ready", "reference-added", "researching", "reference-has-provenance"],
  ["researching", "approve-gate:research", "research-ready", "research-minimum-references"],
  ["research-ready", "directions-proposed", "directions-ready", "three-valid-directions"],
  ["directions-ready", "directions-proposed", "directions-ready", "three-valid-directions"],
  ["directions-ready", "approve-gate:direction", "direction-selected", "direction-selectable"],
  ["direction-selected", "approve-gate:foundations", "foundations-ready", "foundations-complete"],
  [
    "foundations-ready",
    "approve-gate:representative-screens",
    "representative-screens-ready",
    "representative-screens-cover-categories",
  ],
  ["representative-screens-ready", "system-completed", "system-ready", "system-consistent"],
  ["system-ready", "screens-completed", "screens-ready", "all-screens-designed"],
  ["screens-ready", "approve-gate:visual-review", "penpot-synced", "penpot-sync-clean"],
  ["screens-ready", "validation-passed", "validated", "validation-clean-penpot-disabled"],
  ["penpot-synced", "validation-passed", "validated", "validation-clean"],
  ["validated", "export-written", "exported", "export-verified"],
  ["exported", "export-written", "exported", "export-verified"],
  // Re-approval rows (A1-A6): approving again from the phase the gate already produced.
  ["intake-ready", "approve-gate:intake", "intake-ready", "intake-context-valid"],
  ["research-ready", "approve-gate:research", "research-ready", "research-minimum-references"],
  ["direction-selected", "approve-gate:direction", "direction-selected", "direction-selectable"],
  ["foundations-ready", "approve-gate:foundations", "foundations-ready", "foundations-complete"],
  [
    "representative-screens-ready",
    "approve-gate:representative-screens",
    "representative-screens-ready",
    "representative-screens-cover-categories",
  ],
  ["penpot-synced", "approve-gate:visual-review", "penpot-synced", "penpot-sync-clean"],
];

/** Phase where each gate is pending (loop target) and where a rejection revokes to. */
const REJECTION_SPEC: Readonly<
  Record<
    GateName,
    { pending: HeronPhase; revokeTo: HeronPhase; extraLoops?: readonly HeronPhase[] }
  >
> = {
  intake: {
    pending: "initialized",
    revokeTo: "directions-ready",
    extraLoops: ["researching", "research-ready", "directions-ready"],
  },
  research: { pending: "researching", revokeTo: "researching" },
  direction: { pending: "directions-ready", revokeTo: "directions-ready" },
  foundations: { pending: "direction-selected", revokeTo: "direction-selected" },
  "representative-screens": { pending: "foundations-ready", revokeTo: "foundations-ready" },
  "visual-review": { pending: "screens-ready", revokeTo: "screens-ready" },
};

function rejectionTarget(gate: GateName, from: HeronPhase): HeronPhase {
  const spec = REJECTION_SPEC[gate];
  if (gate === "intake" && from === "intake-ready") return "initialized";
  if (spec.extraLoops?.includes(from) === true || from === spec.pending) return from;
  return spec.revokeTo;
}

/** Phases where `gate` is pending or may already be approved. */
function rejectionPhases(gate: GateName): HeronPhase[] {
  if (gate === "intake") return [...HERON_PHASES];
  const start = phaseIndex(REJECTION_SPEC[gate].pending);
  return HERON_PHASES.slice(start);
}

function gateRejectable(gate: GateName, from: HeronPhase): TransitionRule["check"] {
  return (facts, state) => {
    if (latestDecisionOf(state, gate)?.decision === "approved") return OK;
    if (!APPROVE_FROM.has(`${from}|${gate}`)) return unmet(`gate "${gate}" is not approved`);
    if (facts.boundArtifactCount === undefined) return missing("boundArtifactCount");
    return facts.boundArtifactCount > 0
      ? OK
      : unmet(`gate "${gate}" has no bound artifacts to review`);
  };
}

function buildTransitions(): readonly TransitionRule[] {
  APPROVE_FROM.clear();
  const rows: TransitionRule[] = FORWARD_ROWS.map(([from, event, to, pre]) =>
    factRule(from, event, to, pre),
  );
  for (const [from, event] of FORWARD_ROWS) {
    if (event.startsWith("approve-gate:")) APPROVE_FROM.add(`${from}|${event.slice(13)}`);
  }
  for (const gate of GATE_NAMES) {
    for (const from of rejectionPhases(gate)) {
      rows.push(
        rule(
          from,
          `reject-gate:${gate}`,
          rejectionTarget(gate, from),
          "gate-rejectable",
          gateRejectable(gate, from),
        ),
      );
    }
  }
  const firstRevisable = phaseIndex("foundations-ready");
  const firstTarget = phaseIndex("direction-selected");
  for (const from of HERON_PHASES.slice(firstRevisable)) {
    for (const target of HERON_PHASES.slice(firstTarget, phaseIndex(from))) {
      rows.push(factRule(from, `revise:${target}`, target, "revise-scope-declared"));
    }
  }
  return rows;
}

export const TRANSITIONS: readonly TransitionRule[] = buildTransitions();

const ROW_INDEX: ReadonlyMap<string, TransitionRule> = new Map(
  TRANSITIONS.map((row) => [`${row.from}|${row.event}`, row]),
);

function findRule(phase: HeronPhase, key: TransitionEventKey): TransitionRule | undefined {
  return ROW_INDEX.get(`${phase}|${key}`);
}

function isRejectOrRevise(row: TransitionRule): boolean {
  return row.event.startsWith("reject-gate:") || row.event.startsWith("revise:");
}

/** Gate targeted by an approve/reject event key, or null. */
function eventGate(key: TransitionEventKey): GateName | null {
  const arg = key.split(":")[1];
  return GATE_NAMES.find((name) => name === arg) ?? null;
}

/**
 * Check order (DP10): (1) row exists; (2) mode guard for production rows;
 * (3) approvals guard for production rows other than reject/revise; (4) row precondition.
 */
export function canTransition(
  state: HeronState,
  event: HeronEvent,
  facts: TransitionFacts,
): TransitionCheck {
  const key = eventKey(event);
  const found = findRule(state.phase, key);
  if (found === undefined) {
    return {
      ok: false,
      code: "TRANSITION_NOT_ALLOWED",
      reason: `No transition for "${key}" from phase "${state.phase}".`,
    };
  }
  if (found.production && state.mode === "reference-only") {
    return {
      ok: false,
      code: "MODE_BLOCKED",
      reason: `${key} requires FULL PRODUCT mode; current mode is REFERENCE ONLY.`,
      rule: found,
    };
  }
  const unmetResult = (id: PreconditionId, detail: string): TransitionRejection => ({
    ok: false,
    code: "PRECONDITION_UNMET",
    reason: `Precondition "${id}" is not met for "${key}" from phase "${state.phase}": ${detail}.`,
    rule: found,
    precondition: id,
  });
  if (found.production && !isRejectOrRevise(found)) {
    if (facts.invalidatedGates === undefined) {
      return unmetResult("approvals-valid", "invalidatedGates is not available");
    }
    const own = eventGate(key);
    const stale = facts.invalidatedGates.filter((gate) => gate !== own);
    if (stale.length > 0) {
      return unmetResult("approvals-valid", `approvals no longer valid: ${stale.join(", ")}`);
    }
  }
  const result = found.check(facts, state);
  if (!result.ok) return unmetResult(found.precondition, result.detail);
  return { ok: true, rule: found };
}

/** On success: phase = rule.to, stateRevision + 1, history entry appended; if phaseIndex(to) < phaseIndex(from),
 * markStaleAfter(state, to, reason) is applied. Never mutates its input. */
export function applyTransition(
  state: HeronState,
  event: HeronEvent,
  facts: TransitionFacts,
  meta: TransitionMeta,
): TransitionOutcome {
  const checked = canTransition(state, event, facts);
  if (!checked.ok) return checked;
  const { rule: row } = checked;
  const transition: Transition = {
    from: row.from,
    event: row.event,
    to: row.to,
    precondition: row.precondition,
    production: row.production,
  };
  const stateRevision = state.stateRevision + 1;
  let next: HeronState = {
    ...state,
    phase: row.to,
    stateRevision,
    history: [
      ...state.history,
      {
        stateRevision,
        runId: meta.runId,
        command: meta.command,
        heronVersion: meta.heronVersion,
        at: meta.at,
        mode: state.mode,
        transition,
      },
    ],
  };
  if (phaseIndex(row.to) < phaseIndex(row.from)) {
    next = markStaleAfter(
      next,
      row.to,
      `Phase regressed from "${row.from}" to "${row.to}" by ${row.event}.`,
    );
  }
  return { ok: true, state: next, transition };
}

/** Events whose row exists from state.phase and passes the mode guard (preconditions not evaluated). */
export function allowedEvents(state: HeronState): HeronEvent[] {
  return TRANSITIONS.filter(
    (row) => row.from === state.phase && !(row.production && state.mode === "reference-only"),
  ).map((row) => parseEventKey(row.event));
}
