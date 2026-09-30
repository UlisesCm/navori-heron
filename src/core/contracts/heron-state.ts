import { z } from "zod";
import {
  HeronModeSchema,
  IsoDateTimeSchema,
  RelativeArtifactPathSchema,
  RunIdSchema,
  Sha256HexSchema,
  type HeronMode,
  type IsoDateTime,
  type RelativeArtifactPath,
  type RunId,
  type Sha256Hex,
} from "./common.ts";
import type { DocumentSpec } from "./version.ts";

export const HERON_PHASES = [
  "initialized",
  "intake-ready",
  "researching",
  "research-ready",
  "directions-ready",
  "direction-selected",
  "foundations-ready",
  "representative-screens-ready",
  "system-ready",
  "screens-ready",
  "penpot-synced",
  "validated",
  "exported",
] as const; // array order is the phase order used by phaseIndex
export type HeronPhase = (typeof HERON_PHASES)[number];
/** "direction-selected" .. "exported" (MASTER.md #5–#12). */
export const PRODUCTION_PHASES: readonly HeronPhase[] = HERON_PHASES.slice(
  HERON_PHASES.indexOf("direction-selected"),
);

export const GATE_NAMES = [
  "intake",
  "research",
  "direction",
  "foundations",
  "representative-screens",
  "visual-review",
] as const;
export type GateName = (typeof GATE_NAMES)[number];

export const HERON_EVENT_TYPES = [
  "reference-added",
  "directions-proposed",
  "system-completed",
  "screens-completed",
  "validation-passed",
  "export-written",
  "approve-gate",
  "reject-gate",
  "revise",
] as const;
export type HeronEventType = (typeof HERON_EVENT_TYPES)[number];
export type HeronEvent =
  | {
      type:
        | "reference-added"
        | "directions-proposed"
        | "system-completed"
        | "screens-completed"
        | "validation-passed"
        | "export-written";
    }
  | { type: "approve-gate"; gate: GateName }
  | { type: "reject-gate"; gate: GateName }
  | { type: "revise"; target: HeronPhase };
export type TransitionEventKey =
  | "reference-added"
  | "directions-proposed"
  | "system-completed"
  | "screens-completed"
  | "validation-passed"
  | "export-written"
  | `approve-gate:${GateName}`
  | `reject-gate:${GateName}`
  | `revise:${HeronPhase}`;

export const PRECONDITION_IDS = [
  "intake-context-valid",
  "reference-has-provenance",
  "research-minimum-references",
  "three-valid-directions",
  "direction-selectable",
  "foundations-complete",
  "representative-screens-cover-categories",
  "system-consistent",
  "all-screens-designed",
  "penpot-sync-clean",
  "validation-clean-penpot-disabled",
  "validation-clean",
  "export-verified",
  "gate-rejectable",
  "revise-scope-declared",
  "approvals-valid",
] as const;
export type PreconditionId = (typeof PRECONDITION_IDS)[number];

/** Serializable descriptor of a table row; recorded in history. */
export type Transition = {
  from: HeronPhase;
  event: TransitionEventKey;
  to: HeronPhase;
  precondition: PreconditionId;
  production: boolean; // to ∈ PRODUCTION_PHASES
};

const SIMPLE_EVENTS = [
  "reference-added",
  "directions-proposed",
  "system-completed",
  "screens-completed",
  "validation-passed",
  "export-written",
] as const;

const TransitionEventKeySchema: z.ZodType<TransitionEventKey> = z.union([
  z.enum(SIMPLE_EVENTS),
  z.templateLiteral(["approve-gate:", z.enum(GATE_NAMES)]),
  z.templateLiteral(["reject-gate:", z.enum(GATE_NAMES)]),
  z.templateLiteral(["revise:", z.enum(HERON_PHASES)]),
]);

export const TransitionSchema: z.ZodType<Transition> = z.looseObject({
  from: z.enum(HERON_PHASES),
  event: TransitionEventKeySchema,
  to: z.enum(HERON_PHASES),
  precondition: z.enum(PRECONDITION_IDS),
  production: z.boolean(),
});

export type BoundArtifact = { path: RelativeArtifactPath; sha256: Sha256Hex }; // relative to .heron/
export const BoundArtifactSchema: z.ZodType<BoundArtifact> = z.looseObject({
  path: RelativeArtifactPathSchema,
  sha256: Sha256HexSchema,
});

type GateDecisionBase = {
  gate: GateName;
  decidedBy: string; // non-empty; CLI: OS user name
  decidedAt: IsoDateTime;
  artifacts: BoundArtifact[]; // sorted by path
  stateRevision: number; // revision this decision produced
  runId: RunId;
};
export type GateDecision =
  | (GateDecisionBase & { decision: "approved"; note: string | null })
  | (GateDecisionBase & { decision: "rejected"; reason: string }); // reason non-empty

const gateBase = {
  gate: z.enum(GATE_NAMES),
  decidedBy: z.string().min(1),
  decidedAt: IsoDateTimeSchema,
  artifacts: z.array(BoundArtifactSchema),
  stateRevision: z.number().int().min(1),
  runId: RunIdSchema,
};
export const GateDecisionSchema: z.ZodType<GateDecision> = z.discriminatedUnion("decision", [
  z.looseObject({ ...gateBase, decision: z.literal("approved"), note: z.string().nullable() }),
  z.looseObject({ ...gateBase, decision: z.literal("rejected"), reason: z.string().min(1) }),
]);

export type StaleEntry = {
  path: RelativeArtifactPath;
  reason: string;
  since: number /* stateRevision */;
};
export const StaleEntrySchema: z.ZodType<StaleEntry> = z.looseObject({
  path: RelativeArtifactPathSchema,
  reason: z.string(),
  since: z.number().int().min(1),
});

export type HistoryEntry = {
  stateRevision: number;
  runId: RunId;
  command: string; // non-empty; P1 writes "init", "gate approve", "gate reject"
  heronVersion: string;
  at: IsoDateTime;
  mode: HeronMode;
  transition: Transition | null; // null for init
};
const HistoryEntrySchema: z.ZodType<HistoryEntry> = z.looseObject({
  stateRevision: z.number().int().min(1),
  runId: RunIdSchema,
  command: z.string().min(1),
  heronVersion: z.string(),
  at: IsoDateTimeSchema,
  mode: HeronModeSchema,
  transition: TransitionSchema.nullable(),
});

export type HeronState = {
  kind: "HeronState";
  schemaVersion: 1;
  stateRevision: number; // ≥ 1, +1 per committed command
  mode: HeronMode;
  phase: HeronPhase;
  designRevision: number; // ≥ 0; P1 always 0
  artifacts: BoundArtifact[]; // committed artifacts referenced by this state, sorted by path
  gates: GateDecision[]; // append-only
  stale: StaleEntry[]; // unique by path, sorted by path
  history: HistoryEntry[]; // append-only
};
export const HeronStateSchema: z.ZodType<HeronState> = z.looseObject({
  kind: z.literal("HeronState"),
  schemaVersion: z.literal(1),
  stateRevision: z.number().int().min(1),
  mode: HeronModeSchema,
  phase: z.enum(HERON_PHASES),
  designRevision: z.number().int().min(0),
  artifacts: z.array(BoundArtifactSchema),
  gates: z.array(GateDecisionSchema),
  stale: z.array(StaleEntrySchema),
  history: z.array(HistoryEntrySchema),
});
export const HERON_STATE_DOCUMENT: DocumentSpec<HeronState> = {
  kind: "HeronState",
  schemaVersion: 1,
  schema: HeronStateSchema,
  schemaFile: "heron-state.v1.schema.json",
};
