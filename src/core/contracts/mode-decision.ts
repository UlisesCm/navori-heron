import { z } from "zod";
import {
  FindingIssueSchema,
  FindingSchema,
  HeronModeSchema,
  Sha256HexSchema,
  type Finding,
  type FindingIssue,
  type HeronMode,
  type Sha256Hex,
} from "./common.ts";
import {
  ADAPTER_IDS,
  STAGE_SELECTIONS,
  type AdapterId,
  type StageSelection,
} from "./heron-project.ts";
import type { DocumentSpec } from "./version.ts";

export const HARNESS_ARTIFACT_NAMES = [
  "MASTER.md",
  "DECISIONS.md",
  "parts.json",
  "UX.md",
  "ux.json",
  "DIGEST.md",
  "CODEBASE.md",
] as const; // display order of R1
export type HarnessArtifactName = (typeof HARNESS_ARTIFACT_NAMES)[number];

export type DetectedArtifact = {
  name: HarnessArtifactName;
  path: string; // repo-relative POSIX
  present: boolean; // false also when unsafe or too large (a finding explains it)
  sha256: Sha256Hex | null;
};
export type UxFileCheck = {
  path: string;
  present: boolean;
  valid: boolean | null; // null when absent
  sha256: Sha256Hex | null;
  issues: FindingIssue[];
};
export type UxSummary = { surfaces: string[]; screens: number; flows: number; patterns: number };
export type UxJsonCheck = UxFileCheck & { reader: "provisional-1"; summary: UxSummary | null };
export type StageRef = {
  number: number;
  slug: string;
  dir: string;
  state: string;
  selection: StageSelection;
};
export type HarnessDeclaration = { phase: string | null; mode: string | null; ux: string | null }; // raw, tolerant

export type DetectionReport = {
  adapter: AdapterId;
  navoriMaster: boolean;
  specsDir: string | null;
  stage: StageRef | null;
  stageStatus: "selected" | "none" | "unknown" | "not-applicable";
  stageNotice: string | null;
  harness: HarnessDeclaration | null;
  artifacts: DetectedArtifact[];
  uxMarkdown: UxFileCheck;
  uxJson: UxJsonCheck;
  findings: Finding[];
};

const DetectedArtifactSchema: z.ZodType<DetectedArtifact> = z.looseObject({
  name: z.enum(HARNESS_ARTIFACT_NAMES),
  path: z.string(),
  present: z.boolean(),
  sha256: Sha256HexSchema.nullable(),
});
const uxFileShape = {
  path: z.string(),
  present: z.boolean(),
  valid: z.boolean().nullable(),
  sha256: Sha256HexSchema.nullable(),
  issues: z.array(FindingIssueSchema),
};
const UxFileCheckSchema: z.ZodType<UxFileCheck> = z.looseObject(uxFileShape);
export const UxSummarySchema: z.ZodType<UxSummary> = z.looseObject({
  surfaces: z.array(z.string()),
  screens: z.number().int().min(0),
  flows: z.number().int().min(0),
  patterns: z.number().int().min(0),
});
const UxJsonCheckSchema: z.ZodType<UxJsonCheck> = z.looseObject({
  ...uxFileShape,
  reader: z.literal("provisional-1"),
  summary: UxSummarySchema.nullable(),
});
export const StageRefSchema: z.ZodType<StageRef> = z.looseObject({
  number: z.number().int(),
  slug: z.string(),
  dir: z.string(),
  state: z.string(),
  selection: z.enum(STAGE_SELECTIONS),
});
const HarnessDeclarationSchema: z.ZodType<HarnessDeclaration> = z.looseObject({
  phase: z.string().nullable(),
  mode: z.string().nullable(),
  ux: z.string().nullable(),
});

export const DetectionReportSchema: z.ZodType<DetectionReport> = z.looseObject({
  adapter: z.enum(ADAPTER_IDS),
  navoriMaster: z.boolean(),
  specsDir: z.string().nullable(),
  stage: StageRefSchema.nullable(),
  stageStatus: z.enum(["selected", "none", "unknown", "not-applicable"]),
  stageNotice: z.string().nullable(),
  harness: HarnessDeclarationSchema.nullable(),
  artifacts: z.array(DetectedArtifactSchema),
  uxMarkdown: UxFileCheckSchema,
  uxJson: UxJsonCheckSchema,
  findings: z.array(FindingSchema),
});

export const MODE_REASON_CODES = [
  "UX_COMPLETE",
  "UX_FILES_MISSING",
  "UX_INCONSISTENT",
  "UX_CONTRACT_INVALID",
  "UX_DECLARED_MD_ONLY",
  "UX_DECLARATION_MISMATCH",
  "STAGE_UNAVAILABLE",
] as const;
export type ModeReasonCode = (typeof MODE_REASON_CODES)[number];
export type ModeReason = { code: ModeReasonCode; message: string };

export type ModeDecision = {
  kind: "ModeDecision";
  schemaVersion: 1;
  mode: HeronMode;
  reasons: ModeReason[]; // "UX_COMPLETE" alone iff mode = "full"
  findings: Finding[]; // mode-level findings (UX_*), in FINDING_CODES order then by path
  detection: DetectionReport;
};
export const ModeDecisionSchema: z.ZodType<ModeDecision> = z.looseObject({
  kind: z.literal("ModeDecision"),
  schemaVersion: z.literal(1),
  mode: HeronModeSchema,
  reasons: z.array(z.looseObject({ code: z.enum(MODE_REASON_CODES), message: z.string() })),
  findings: z.array(FindingSchema),
  detection: DetectionReportSchema,
});
export const MODE_DECISION_DOCUMENT: DocumentSpec<ModeDecision> = {
  kind: "ModeDecision",
  schemaVersion: 1,
  schema: ModeDecisionSchema,
  schemaFile: "mode-decision.v1.schema.json",
};
