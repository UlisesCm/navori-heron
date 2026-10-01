import { z } from "zod";
import {
  AGENT_PROVIDER_IDS,
  AGENT_ROLES,
  AGENT_TASK_IDS,
  AgentUsageSchema,
  type AgentProviderId,
  type AgentRole,
  type AgentTaskId,
  type AgentUsage,
} from "./agents.ts";
import {
  DirectionSelectionSchema,
  ResearchAnalysisSchema,
  ResearchBriefSchema,
  VisualDirectionsSchema,
  type DirectionSelection,
  type ResearchAnalysis,
  type ResearchBrief,
  type VisualDirections,
} from "./directions.ts";
import {
  RelativeArtifactPathSchema,
  RunIdSchema,
  type RelativeArtifactPath,
  type RunId,
} from "./common.ts";
import { HERON_PHASES, type HeronPhase } from "./heron-state.ts";
import { ReferenceIdSchema, type ReferenceId } from "./research.ts";

export type AgentRunSummary = {
  runId: RunId;
  task: AgentTaskId;
  provider: AgentProviderId;
  role: AgentRole;
  attempts: number; // 0 when reused
  durationMs: number;
  model: string | null;
  path: RelativeArtifactPath;
  reused: boolean; // DR39
  usage: AgentUsage; // summed over attempts
};
export type AgentUsageTotals = {
  invocations: number;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  costUsd: number | null;
};
export type AgentUsageSummary = {
  today: AgentUsageTotals;
  window: AgentUsageTotals & { days: number };
  softBudget: number | null;
  overBudget: boolean; // DR45
};
export type ResearchBriefData = {
  brief: ResearchBrief;
  run: AgentRunSummary;
  written: RelativeArtifactPath[];
  stateRevision: number;
};
export type ResearchAnalyzeData = {
  analyzed: ReferenceId[];
  fresh: ReferenceId[];
  pending: ReferenceId[]; // over PACK_LIMITS
  analysis: ResearchAnalysis | null;
  run: AgentRunSummary | null;
  written: RelativeArtifactPath[];
  stateRevision: number;
};
export type DirectionProposeData = {
  directions: VisualDirections;
  run: AgentRunSummary;
  phase: { from: HeronPhase; to: HeronPhase };
  written: RelativeArtifactPath[];
  stateRevision: number;
};
export type DirectionSelectData = {
  selection: DirectionSelection;
  name: string;
  phase: HeronPhase;
  written: RelativeArtifactPath[];
  stateRevision: number;
};

// Transient CLI output: plain z.object (DP7).
const revision = z.number().int().min(0);
const paths = z.array(RelativeArtifactPathSchema);
const count = z.number().int().min(0);

export const AgentRunSummarySchema: z.ZodType<AgentRunSummary> = z.object({
  runId: RunIdSchema,
  task: z.enum(AGENT_TASK_IDS),
  provider: z.enum(AGENT_PROVIDER_IDS),
  role: z.enum(AGENT_ROLES),
  attempts: count,
  durationMs: z.number().min(0),
  model: z.string().nullable(),
  path: RelativeArtifactPathSchema,
  reused: z.boolean(),
  usage: AgentUsageSchema,
});
const AgentUsageTotalsShape = {
  invocations: count,
  inputTokens: count,
  outputTokens: count,
  cachedInputTokens: count,
  costUsd: z.number().min(0).nullable(),
};
export const AgentUsageSummarySchema: z.ZodType<AgentUsageSummary> = z.object({
  today: z.object(AgentUsageTotalsShape),
  window: z.object({ ...AgentUsageTotalsShape, days: z.number().int().min(1) }),
  softBudget: z.number().int().min(1).nullable(),
  overBudget: z.boolean(),
});
export const ResearchBriefDataSchema: z.ZodType<ResearchBriefData> = z.object({
  brief: ResearchBriefSchema,
  run: AgentRunSummarySchema,
  written: paths,
  stateRevision: revision,
});
export const ResearchAnalyzeDataSchema: z.ZodType<ResearchAnalyzeData> = z.object({
  analyzed: z.array(ReferenceIdSchema),
  fresh: z.array(ReferenceIdSchema),
  pending: z.array(ReferenceIdSchema),
  analysis: ResearchAnalysisSchema.nullable(),
  run: AgentRunSummarySchema.nullable(),
  written: paths,
  stateRevision: revision,
});
export const DirectionProposeDataSchema: z.ZodType<DirectionProposeData> = z.object({
  directions: VisualDirectionsSchema,
  run: AgentRunSummarySchema,
  phase: z.object({ from: z.enum(HERON_PHASES), to: z.enum(HERON_PHASES) }),
  written: paths,
  stateRevision: revision,
});
export const DirectionSelectDataSchema: z.ZodType<DirectionSelectData> = z.object({
  selection: DirectionSelectionSchema,
  name: z.string(),
  phase: z.enum(HERON_PHASES),
  written: paths,
  stateRevision: revision,
});
