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
import { BoundArtifactSchema, type BoundArtifact } from "./heron-state.ts";
import { ReferenceIdSchema, type ReferenceId } from "./research.ts";
import { DOCUMENT_KINDS, type DocumentKind, type DocumentSpec } from "./version.ts";

export const AGENT_PROVIDER_IDS = ["claude-code", "codex-cli", "fake"] as const;
export type AgentProviderId = (typeof AGENT_PROVIDER_IDS)[number];
export const AGENT_ROLES = ["creator", "reviewer"] as const;
export type AgentRole = (typeof AGENT_ROLES)[number];
export const AGENT_TASK_IDS = [
  "research-brief",
  "research-analyze",
  "direction-propose",
  "probe",
] as const;
export type AgentTaskId = (typeof AGENT_TASK_IDS)[number];
export const AGENT_RUN_STATUSES = [
  "succeeded",
  "invalid-output",
  "timeout",
  "failed",
  "policy-violation",
  "unavailable",
] as const;
export type AgentRunStatus = (typeof AGENT_RUN_STATUSES)[number];
export const PACK_TRUST_LEVELS = ["heron", "operator", "untrusted"] as const;
export type PackTrust = (typeof PACK_TRUST_LEVELS)[number];
export const PACK_ITEM_KINDS = [
  "task-input",
  "contrast-policy",
  "operator-query",
  "reference",
  "reference-origin",
  "brand-input",
  "brief-query",
  "analysis-note",
  "external-text",
  "previous-output",
  "validation-issues",
] as const;
export type PackItemKind = (typeof PACK_ITEM_KINDS)[number];
/** Never starts with "-" because the model name reaches the agent's argv. */
export const MODEL_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,99}$/;

/** Shape of project.json "agents" (hand-edited, every key optional). Validated lazily (DR21), not by HeronProjectSchema. */
export type AgentSettingsInput = {
  roles?:
    | { creator?: AgentProviderId | undefined; reviewer?: AgentProviderId | undefined }
    | undefined;
  models?:
    | {
        "claude-code"?: string | undefined;
        "codex-cli"?: string | undefined;
        fake?: string | undefined;
      }
    | undefined;
  timeoutMs?: number | undefined; // int 1_000..3_600_000 (default 600_000)
  contextBudgetChars?: number | undefined; // int 10_000..1_000_000 (default 120_000)
  warnTokensPerDay?: number | undefined; // int >= 1_000; absent = no soft-budget warning (DR45)
};
const ModelNameSchema = z.string().regex(MODEL_NAME_PATTERN);
export const AgentSettingsInputSchema: z.ZodType<AgentSettingsInput> = z.looseObject({
  roles: z
    .looseObject({
      creator: z.enum(AGENT_PROVIDER_IDS).optional(),
      reviewer: z.enum(AGENT_PROVIDER_IDS).optional(),
    })
    .optional(),
  models: z
    .looseObject({
      "claude-code": ModelNameSchema.optional(),
      "codex-cli": ModelNameSchema.optional(),
      fake: ModelNameSchema.optional(),
    })
    .optional(),
  timeoutMs: z.number().int().min(1_000).max(3_600_000).optional(),
  contextBudgetChars: z.number().int().min(10_000).max(1_000_000).optional(),
  warnTokensPerDay: z.number().int().min(1_000).optional(),
});

export type TemplateRef = { id: string; version: number; sha256: Sha256Hex };
const TemplateRefSchema: z.ZodType<TemplateRef> = z.looseObject({
  id: z.string().min(1),
  version: z.number().int().min(1),
  sha256: Sha256HexSchema,
});

/**
 * Token counts are null when the provider does not report them (DR45).
 * `inputTokens` is the TOTAL input processed by the invocation (fresh + cache write + cache read);
 * `cachedInputTokens` is the subset read from cache. Adapters normalize provider semantics to this.
 */
export type AgentUsage = {
  inputTokens: number | null;
  outputTokens: number | null;
  cachedInputTokens: number | null;
  costUsd: number | null;
  costIsEstimate: boolean;
};
export const AgentUsageSchema: z.ZodType<AgentUsage> = z.looseObject({
  inputTokens: z.number().int().min(0).nullable(),
  outputTokens: z.number().int().min(0).nullable(),
  cachedInputTokens: z.number().int().min(0).nullable(),
  costUsd: z.number().min(0).nullable(),
  costIsEstimate: z.boolean(),
});

export type PackItemRef = {
  kind: PackItemKind;
  id: string;
  trust: PackTrust;
  sha256: Sha256Hex;
  chars: number;
};
export type PackTrim = {
  id: string;
  action: "truncated" | "dropped";
  originalChars: number;
  keptChars: number;
};
export type AgentInvocation = {
  attempt: number;
  kind: "initial" | "repair";
  provider: AgentProviderId;
  cliVersion: string | null;
  model: { requested: string | null; reported: string[] };
  template: TemplateRef;
  input: { sha256: Sha256Hex; chars: number };
  output: { sha256: Sha256Hex; bytes: number } | null;
  status: AgentRunStatus;
  exitCode: number | null;
  signal: string | null;
  durationMs: number;
  usage: AgentUsage;
  issues: number;
};

/** Persisted run record (`runs/<runId>.json`); only succeeded runs are written (DR15). No `direction` in P3 (DR32). */
export type AgentRun = {
  kind: "AgentRun";
  schemaVersion: 1;
  runId: RunId;
  task: AgentTaskId;
  command: string;
  role: AgentRole;
  provider: AgentProviderId;
  cacheKey: Sha256Hex; // agentCacheKey (DR39)
  startedAt: IsoDateTime;
  heronVersion: string;
  mode: HeronMode;
  outputSchema: { task: AgentTaskId; dialect: "claude" | "openai-strict"; sha256: Sha256Hex };
  pack: {
    sha256: Sha256Hex;
    chars: number;
    budget: number;
    items: PackItemRef[];
    trimmed: PackTrim[];
  };
  inputs: BoundArtifact[]; // .heron files the pack was built from, sorted by path
  references: ReferenceId[]; // references present in the pack
  schemas: { kind: DocumentKind; schemaVersion: number }[]; // documents read and written
  outputs: BoundArtifact[]; // documents written by this run (not the run file)
  status: "succeeded";
  invocations: AgentInvocation[]; // 1..3
};

const PackItemRefSchema: z.ZodType<PackItemRef> = z.looseObject({
  kind: z.enum(PACK_ITEM_KINDS),
  id: z.string().min(1),
  trust: z.enum(PACK_TRUST_LEVELS),
  sha256: Sha256HexSchema,
  chars: z.number().int().min(0),
});
const PackTrimSchema: z.ZodType<PackTrim> = z.looseObject({
  id: z.string().min(1),
  action: z.enum(["truncated", "dropped"]),
  originalChars: z.number().int().min(0),
  keptChars: z.number().int().min(0),
});
const AgentInvocationSchema: z.ZodType<AgentInvocation> = z.looseObject({
  attempt: z.number().int().min(1),
  kind: z.enum(["initial", "repair"]),
  provider: z.enum(AGENT_PROVIDER_IDS),
  cliVersion: z.string().nullable(),
  model: z.looseObject({ requested: z.string().nullable(), reported: z.array(z.string()) }),
  template: TemplateRefSchema,
  input: z.looseObject({ sha256: Sha256HexSchema, chars: z.number().int().min(0) }),
  output: z.looseObject({ sha256: Sha256HexSchema, bytes: z.number().int().min(0) }).nullable(),
  status: z.enum(AGENT_RUN_STATUSES),
  exitCode: z.number().int().nullable(),
  signal: z.string().nullable(),
  durationMs: z.number().min(0),
  usage: AgentUsageSchema,
  issues: z.number().int().min(0),
});

export const AgentRunSchema: z.ZodType<AgentRun> = z.looseObject({
  kind: z.literal("AgentRun"),
  schemaVersion: z.literal(1),
  runId: RunIdSchema,
  task: z.enum(AGENT_TASK_IDS),
  command: z.string().min(1),
  role: z.enum(AGENT_ROLES),
  provider: z.enum(AGENT_PROVIDER_IDS),
  cacheKey: Sha256HexSchema,
  startedAt: IsoDateTimeSchema,
  heronVersion: z.string().min(1),
  mode: HeronModeSchema,
  outputSchema: z.looseObject({
    task: z.enum(AGENT_TASK_IDS),
    dialect: z.enum(["claude", "openai-strict"]),
    sha256: Sha256HexSchema,
  }),
  pack: z.looseObject({
    sha256: Sha256HexSchema,
    chars: z.number().int().min(0),
    budget: z.number().int().min(1),
    items: z.array(PackItemRefSchema),
    trimmed: z.array(PackTrimSchema),
  }),
  inputs: z.array(BoundArtifactSchema),
  references: z.array(ReferenceIdSchema),
  schemas: z.array(
    z.looseObject({ kind: z.enum(DOCUMENT_KINDS), schemaVersion: z.number().int().min(1) }),
  ),
  outputs: z.array(BoundArtifactSchema),
  status: z.literal("succeeded"),
  invocations: z.array(AgentInvocationSchema).min(1).max(3),
});
export const AGENT_RUN_DOCUMENT: DocumentSpec<AgentRun> = {
  kind: "AgentRun",
  schemaVersion: 1,
  schema: AgentRunSchema,
  schemaFile: "agent-run.v1.schema.json",
};

/** Pointer from a derived document to the run that produced it; `path` is `runs/<runId>.json`. */
export type AgentRunRef = {
  runId: RunId;
  path: RelativeArtifactPath;
  provider: AgentProviderId;
  template: TemplateRef;
  cacheKey: Sha256Hex;
};
export const AgentRunRefSchema: z.ZodType<AgentRunRef> = z.looseObject({
  runId: RunIdSchema,
  path: RelativeArtifactPathSchema,
  provider: z.enum(AGENT_PROVIDER_IDS),
  template: TemplateRefSchema,
  cacheKey: Sha256HexSchema,
});
