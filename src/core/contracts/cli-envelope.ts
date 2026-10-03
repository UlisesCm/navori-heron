import { z } from "zod";
import {
  ExitCode,
  FindingSchema,
  HeronModeSchema,
  RunIdSchema,
  type Finding,
  type HeronMode,
  type RunId,
} from "./common.ts";
import { ADAPTER_IDS, type AdapterId } from "./heron-project.ts";
import {
  AgentUsageSummarySchema,
  DirectionProposeDataSchema,
  DirectionSelectDataSchema,
  ResearchAnalyzeDataSchema,
  ResearchBriefDataSchema,
  type AgentUsageSummary,
  type DirectionProposeData,
  type DirectionSelectData,
  type ResearchAnalyzeData,
  type ResearchBriefData,
} from "./agents-data.ts";
import {
  ConflictsAckDataSchema,
  ConflictsListDataSchema,
  IntakeDataSchema,
  type ConflictsAckData,
  type ConflictsListData,
  type IntakeData,
} from "./intake-data.ts";
import {
  BoundArtifactSchema,
  GATE_NAMES,
  HERON_PHASES,
  StaleEntrySchema,
  type BoundArtifact,
  type GateName,
  type HeronPhase,
  type StaleEntry,
} from "./heron-state.ts";
import {
  ModeDecisionSchema,
  StageRefSchema,
  UxSummarySchema,
  type StoredModeDecision,
  type StageRef,
  type UxSummary,
} from "./mode-decision.ts";
import {
  BrandAddDataSchema,
  ReferencesAddDataSchema,
  ReferencesCompareDataSchema,
  ReferencesImportDataSchema,
  ReferencesListDataSchema,
  ReferencesRemoveDataSchema,
  ReferencesShowDataSchema,
  ResearchRenderDataSchema,
  type BrandAddData,
  type ReferencesAddData,
  type ReferencesCompareData,
  type ReferencesImportData,
  type ReferencesListData,
  type ReferencesRemoveData,
  type ReferencesShowData,
  type ResearchRenderData,
} from "./research-data.ts";
import {
  PenpotInspectDataSchema,
  PenpotLinkDataSchema,
  PenpotSyncDataSchema,
  type PenpotInspectData,
  type PenpotLinkData,
  type PenpotSyncData,
} from "./penpot.ts";
import type { DocumentSpec } from "./version.ts";

export const CLI_COMMANDS = [
  "init",
  "status",
  "doctor",
  "gate",
  "references add",
  "references list",
  "references show",
  "references compare",
  "references remove",
  "references import",
  "brand add",
  "research render",
  "intake",
  "conflicts list",
  "conflicts ack",
  "research brief",
  "research analyze",
  "direction propose",
  "direction select",
  "penpot link",
  "penpot doctor",
  "penpot inspect",
  "penpot sync",
] as const;
export type CliCommand = (typeof CLI_COMMANDS)[number];

export type InitData = {
  decision: StoredModeDecision;
  dryRun: boolean;
  written: boolean;
  stateRevision: number | null;
};

export type GateStatus = "not-reached" | "pending" | "approved" | "invalidated" | "rejected";
export type StatusData = {
  adapter: AdapterId;
  navoriMaster: boolean;
  stage: StageRef | null;
  mode: HeronMode; // effective: "full" only if persisted and live are "full"
  persistedMode: HeronMode;
  liveMode: HeronMode;
  phase: HeronPhase;
  stateRevision: number;
  counts: UxSummary | null; // only when effective mode = "full"
  gates: { gate: GateName; status: GateStatus }[]; // GATE_NAMES order
  stale: StaleEntry[];
  inputsChanged: string[]; // repo-relative paths whose presence or sha256 differ from mode.json
  openConflicts: number | null; // null until P4
  agentUsage: AgentUsageSummary | null; // null without a local agent log (DR45)
  allowedCommands: string[];
};

export const DOCTOR_CHECK_IDS = [
  "runtime.bun",
  "target.path",
  "heron.documents",
  "heron.lock",
  "heron.gitignore",
  "harness.detection",
  "agents.config",
  "agents.usage",
  "agents.claude-code",
  "agents.codex-cli",
  "agents.fake",
  "probe.claude-code",
  "probe.codex-cli",
  "probe.fake",
  "penpot.config",
  "penpot.url",
  "penpot.key",
  "penpot.mcp",
  "penpot.plugin",
  "penpot.file",
  "penpot.version",
] as const;
export type DoctorCheckId = (typeof DOCTOR_CHECK_IDS)[number];
export type DoctorCheckStatus = "PASS" | "WARNING" | "FAIL";
export type DoctorCheck = {
  id: DoctorCheckId;
  kind: "dependency" | "workspace";
  status: DoctorCheckStatus;
  message: string;
  remedy: string | null;
  durationMs: number;
};
export type DoctorData = { checks: DoctorCheck[] };

export type GateData = {
  gate: GateName;
  decision: "approved" | "rejected";
  from: HeronPhase;
  to: HeronPhase;
  stateRevision: number;
  artifacts: BoundArtifact[];
};

export type CliEnvelope = {
  kind: "CliEnvelope";
  schemaVersion: 1;
  command: CliCommand | "unknown";
  ok: boolean; // true iff code = 0
  code: ExitCode;
  data:
    | InitData
    | StatusData
    | DoctorData
    | GateData
    | ReferencesImportData
    | ReferencesAddData
    | ReferencesRemoveData
    | ReferencesCompareData
    | ReferencesListData
    | ReferencesShowData
    | BrandAddData
    | ResearchRenderData
    | IntakeData
    | ConflictsListData
    | ConflictsAckData
    | ResearchBriefData
    | ResearchAnalyzeData
    | DirectionProposeData
    | DirectionSelectData
    | PenpotLinkData
    | PenpotInspectData
    | PenpotSyncData
    | null;
  findings: Finding[];
  runId: RunId;
  durationMs: number;
  next: string[];
};

// Transient output: plain z.object (DP7), unlike the persisted documents.
const InitDataSchema: z.ZodType<InitData> = z.object({
  decision: ModeDecisionSchema,
  dryRun: z.boolean(),
  written: z.boolean(),
  stateRevision: z.number().int().nullable(),
});
const StatusDataSchema: z.ZodType<StatusData> = z.object({
  adapter: z.enum(ADAPTER_IDS),
  navoriMaster: z.boolean(),
  stage: StageRefSchema.nullable(),
  mode: HeronModeSchema,
  persistedMode: HeronModeSchema,
  liveMode: HeronModeSchema,
  phase: z.enum(HERON_PHASES),
  stateRevision: z.number().int(),
  counts: UxSummarySchema.nullable(),
  gates: z.array(
    z.object({
      gate: z.enum(GATE_NAMES),
      status: z.enum(["not-reached", "pending", "approved", "invalidated", "rejected"]),
    }),
  ),
  stale: z.array(StaleEntrySchema),
  inputsChanged: z.array(z.string()),
  openConflicts: z.number().int().nullable(),
  agentUsage: AgentUsageSummarySchema.nullable(),
  allowedCommands: z.array(z.string()),
});
const DoctorDataSchema: z.ZodType<DoctorData> = z.object({
  checks: z.array(
    z.object({
      id: z.enum(DOCTOR_CHECK_IDS),
      kind: z.enum(["dependency", "workspace"]),
      status: z.enum(["PASS", "WARNING", "FAIL"]),
      message: z.string(),
      remedy: z.string().nullable(),
      durationMs: z.number().min(0),
    }),
  ),
});
const GateDataSchema: z.ZodType<GateData> = z.object({
  gate: z.enum(GATE_NAMES),
  decision: z.enum(["approved", "rejected"]),
  from: z.enum(HERON_PHASES),
  to: z.enum(HERON_PHASES),
  stateRevision: z.number().int(),
  artifacts: z.array(BoundArtifactSchema),
});

const ExitCodeSchema: z.ZodType<ExitCode> = z.union([
  z.literal(ExitCode.Ok),
  z.literal(ExitCode.Unexpected),
  z.literal(ExitCode.Usage),
  z.literal(ExitCode.Blocked),
  z.literal(ExitCode.ValidationFailed),
  z.literal(ExitCode.DependencyUnavailable),
  z.literal(ExitCode.LockBusy),
]);

export const CliEnvelopeSchema: z.ZodType<CliEnvelope> = z.object({
  kind: z.literal("CliEnvelope"),
  schemaVersion: z.literal(1),
  command: z.union([z.enum(CLI_COMMANDS), z.literal("unknown")]),
  ok: z.boolean(),
  code: ExitCodeSchema,
  // Larger shapes first so a z.object never matches a narrower payload by stripping keys.
  data: z
    .union([
      PenpotSyncDataSchema,
      PenpotInspectDataSchema,
      PenpotLinkDataSchema,
      DirectionProposeDataSchema,
      ResearchBriefDataSchema,
      ResearchAnalyzeDataSchema,
      DirectionSelectDataSchema,
      ReferencesImportDataSchema,
      ReferencesAddDataSchema,
      ReferencesRemoveDataSchema,
      ReferencesCompareDataSchema,
      ReferencesListDataSchema,
      ReferencesShowDataSchema,
      BrandAddDataSchema,
      ResearchRenderDataSchema,
      IntakeDataSchema,
      ConflictsListDataSchema,
      ConflictsAckDataSchema,
      InitDataSchema,
      StatusDataSchema,
      DoctorDataSchema,
      GateDataSchema,
    ])
    .nullable(),
  findings: z.array(FindingSchema),
  runId: RunIdSchema,
  durationMs: z.number().min(0),
  next: z.array(z.string()),
});
export const CLI_ENVELOPE_DOCUMENT: DocumentSpec<CliEnvelope> = {
  kind: "CliEnvelope",
  schemaVersion: 1,
  schema: CliEnvelopeSchema,
  schemaFile: "cli-envelope.v1.schema.json",
};
