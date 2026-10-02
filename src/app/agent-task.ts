import { toProviderSchema, type SchemaDialect } from "../agents/json-schema.ts";
import { agentCacheKey } from "../agents/cache.ts";
import { buildContextPack } from "../agents/context-pack.ts";
import { runAgentTask } from "../agents/invoke.ts";
import type { AgentProvider, ContextItem, ProviderServices } from "../agents/ports.ts";
import { providerIdForRole, resolveAgentSettings, type AgentSettings } from "../agents/settings.ts";
import type { AgentTaskSpec } from "../agents/tasks.ts";
import {
  AGENT_RUN_DOCUMENT,
  ExitCode,
  canonicalJson,
  type AgentRun,
  type AgentRunRef,
  type AgentRunStatus,
  type BoundArtifact,
  type Finding,
  type FindingIssue,
  type ReferenceId,
  type RelativeArtifactPath,
  type RunId,
  type Sha256Hex,
} from "../core/contracts/index.ts";
import { openAppendLog, readLogEvents } from "../core/store/append-log.ts";
import { sha256Hex } from "../core/store/hash.ts";
import { buildAgentEnv } from "../security/env.ts";
import { createLogger, type Logger } from "../security/logger.ts";
import { createValueRedactor, type Redactor } from "../security/redact.ts";
import { scanUntrustedText } from "../security/untrusted.ts";
import { summarizeAgentUsage, type AgentUsageSummary } from "./agent-usage.ts";
import type { AppContext } from "./context.ts";
import { failure, makeFinding, type UseCaseResult } from "./result.ts";
import type { Workspace } from "./workspace.ts";

/** Exit code of each non-succeeded task status (design §14). */
export const AGENT_STATUS_EXIT: Readonly<
  Record<Exclude<AgentRunStatus, "succeeded">, Exclude<ExitCode, 0>>
> = {
  "invalid-output": ExitCode.ValidationFailed,
  timeout: ExitCode.DependencyUnavailable,
  failed: ExitCode.DependencyUnavailable,
  "policy-violation": ExitCode.Blocked,
  unavailable: ExitCode.DependencyUnavailable,
};

export type AgentStepInput<T> = {
  workspace: Workspace;
  spec: AgentTaskSpec<T>;
  items: readonly ContextItem[];
  /** `.heron` files the pack was built from. */
  inputs: BoundArtifact[];
  /** References present in the pack. */
  references: ReferenceId[];
  validate: (output: T) => FindingIssue[];
  /** HistoryEntry-style command, e.g. "research brief". */
  command: string;
  /** Last sentence of CONTEXT_PACK_OVER_BUDGET. */
  overBudgetRemedy: string;
  /** The run behind the current document (DR39), or null when there is none. */
  previous: { run: AgentRunRef; documentPath: RelativeArtifactPath } | null;
  force: boolean;
};

/** An AgentRun before the use case knows which documents it wrote. */
export type AgentRunDraft = Omit<AgentRun, "outputs" | "schemas">;

export type AgentStepResult<T> =
  | {
      ok: true;
      reused: false;
      output: T;
      draft: AgentRunDraft;
      findings: Finding[];
    }
  | { ok: true; reused: true; run: AgentRunRef; findings: Finding[] }
  | { ok: false; result: UseCaseResult<never> };

const MAX_DETAIL_CHARS = 500;
const dialectOf = (provider: AgentProvider): SchemaDialect =>
  provider.id === "codex-cli" ? "openai-strict" : "claude";
const byPath = (a: { path: string }, b: { path: string }): number =>
  a.path < b.path ? -1 : a.path > b.path ? 1 : 0;

/** Completes a draft with the documents the use case wrote (sorted, as the contract expects). */
export function finalizeAgentRun(
  draft: AgentRunDraft,
  outputs: BoundArtifact[],
  schemas: AgentRun["schemas"],
): AgentRun {
  return {
    ...draft,
    outputs: outputs.toSorted(byPath),
    schemas: schemas.toSorted((a, b) => (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0)),
  };
}

/** DR39: the stored run still describes the current document (same key, run file present, document untouched). */
function canReuse<T>(input: AgentStepInput<T>, key: Sha256Hex): AgentRunRef | null {
  const { previous, workspace } = input;
  if (input.force || previous === null || previous.run.cacheKey !== key) return null;
  try {
    const run = workspace.store.readDocument(previous.run.path, AGENT_RUN_DOCUMENT);
    const document = workspace.store.readBytes(previous.documentPath);
    if (run === null || document === null) return null;
    const recorded = run.outputs.find((output) => output.path === previous.documentPath);
    return recorded?.sha256 === sha256Hex(document) ? previous.run : null;
  } catch {
    return null;
  }
}

/** Every string leaf of a JSON value with its RFC 6901 pointer. */
function stringLeaves(value: unknown, pointer = ""): { pointer: string; text: string }[] {
  if (typeof value === "string") return [{ pointer, text: value }];
  if (Array.isArray(value)) {
    return value.flatMap((entry, index) => stringLeaves(entry, `${pointer}/${index}`));
  }
  if (typeof value === "object" && value !== null) {
    return Object.entries(value).flatMap(([key, entry]) =>
      stringLeaves(entry, `${pointer}/${key.replaceAll("~", "~0").replaceAll("/", "~1")}`),
    );
  }
  return [];
}

function suspiciousFindings(
  output: unknown,
  logger: Logger,
  runId: RunId,
  task: string,
): Finding[] {
  const findings: Finding[] = [];
  for (const { pointer, text } of stringLeaves(output)) {
    const seen = new Set<string>();
    for (const found of scanUntrustedText(text).findings) {
      if (seen.has(found.rule)) continue;
      seen.add(found.rule);
      logger.event("security.finding", {
        runId,
        task,
        rule: found.rule,
        pointer,
      });
      findings.push(
        makeFinding(
          "AGENT_OUTPUT_SUSPICIOUS",
          "warning",
          `Agent output has instruction-shaped text (${found.rule}) at ${pointer === "" ? "/" : pointer}; it is stored as inferred data and re-enters later packs as delimited data.`,
        ),
      );
    }
  }
  return findings;
}

/** Only today's log matters for the soft budget (DR45), so only today's file is read. */
function usageSummary(
  ctx: AppContext,
  workspace: Workspace,
  settings: AgentSettings,
): AgentUsageSummary {
  const now = ctx.clock.now();
  return summarizeAgentUsage(readLogEvents(ctx.fs, workspace.store.heronDir, now), now, {
    windowDays: 1,
    softBudget: settings.warnTokensPerDay,
  });
}

function budgetWarning(summary: AgentUsageSummary): Finding[] {
  if (!summary.overBudget || summary.softBudget === null) return [];
  const used = summary.today.inputTokens + summary.today.outputTokens;
  return [
    makeFinding(
      "AGENT_BUDGET_WARNING",
      "warning",
      `Agent usage today is ${used} tokens (input + output), over the soft budget of ${summary.softBudget} (agents.warnTokensPerDay); nothing is blocked.`,
    ),
  ];
}

function failureFor(
  status: Exclude<AgentRunStatus, "succeeded">,
  label: string,
  detail: string,
  issues: FindingIssue[],
  attempts: number,
  timeoutMs: number,
  redactor: Redactor,
): UseCaseResult<never> {
  const safe = redactor.redact(detail).text.slice(0, MAX_DETAIL_CHARS);
  const code = AGENT_STATUS_EXIT[status];
  switch (status) {
    case "unavailable":
      return failure(
        code,
        makeFinding(
          "AGENT_UNAVAILABLE",
          "error",
          `${label} is not available: ${safe}. Install it and sign in, or pick another provider in project.json "agents" (docs/agent-providers.md).`,
        ),
      );
    case "failed":
      return failure(
        code,
        makeFinding("AGENT_FAILED", "error", `${label} failed: ${safe}. Nothing was written.`),
      );
    case "timeout":
      return failure(
        code,
        makeFinding(
          "AGENT_TIMEOUT",
          "error",
          `${label} did not finish within ${timeoutMs} ms (attempt ${attempts}); its process group was stopped. Nothing was written.`,
        ),
      );
    case "policy-violation":
      return failure(
        code,
        makeFinding(
          "AGENT_POLICY_VIOLATION",
          "error",
          `${label} emitted a disallowed event (${safe}); the run was stopped and nothing was written.`,
        ),
      );
    case "invalid-output": {
      const finding = makeFinding(
        "AGENT_OUTPUT_INVALID",
        "error",
        `${label} returned output that failed validation after ${attempts} attempt(s) (${issues.length} issue(s)); nothing was written.`,
      );
      const sorted = issues.toSorted((a, b) =>
        a.pointer === b.pointer ? (a.message < b.message ? -1 : 1) : a.pointer < b.pointer ? -1 : 1,
      );
      return failure(code, { ...finding, issues: sorted });
    }
  }
}

/**
 * One agent task of a command, outside the write lock (DR1): resolveAgentSettings(project.agents) (AGENT_CONFIG_INVALID,
 * exit 2) -> role provider (AGENT_UNAVAILABLE when not registered) -> allowlisted child env (AGENT_ENV_IGNORED) ->
 * context pack (CONTEXT_PACK_OVER_BUDGET, exit 2) -> cache key (DR39); an unchanged, untouched previous run is reused
 * and nothing is sent -> else runAgentTask with a redacted `.heron/logs/` logger -> failure, or the validated output
 * with value redaction (SECRET_REDACTED), second-order scan (AGENT_OUTPUT_SUSPICIOUS) and the soft budget warning
 * (AGENT_BUDGET_WARNING, never blocking). Writes only the log; the use case persists the run in its own commit.
 */
export async function executeAgentStep<T>(
  ctx: AppContext,
  input: AgentStepInput<T>,
  runId: RunId,
): Promise<AgentStepResult<T>> {
  const { workspace, spec } = input;
  const resolved = resolveAgentSettings(workspace.project.agents);
  if (!resolved.ok) {
    const finding = makeFinding(
      "AGENT_CONFIG_INVALID",
      "error",
      `.heron/project.json "agents" is invalid (${resolved.issues.length} issue(s)); see docs/agent-providers.md.`,
      [".heron/project.json"],
    );
    return {
      ok: false,
      result: failure(ExitCode.Usage, { ...finding, issues: resolved.issues }),
    };
  }
  const settings = resolved.settings;
  const providerId = providerIdForRole(settings, spec.role);
  const provider = ctx.agents.providers[providerId];
  if (provider === undefined) {
    return {
      ok: false,
      result: failure(
        AGENT_STATUS_EXIT.unavailable,
        makeFinding(
          "AGENT_UNAVAILABLE",
          "error",
          `${providerId} is not available: no provider is registered for it. Pick another provider in project.json "agents" (docs/agent-providers.md).`,
        ),
      ),
    };
  }

  const findings: Finding[] = [];
  const agentEnv = buildAgentEnv(ctx.env);
  if (agentEnv.ignored.length > 0) {
    findings.push(
      makeFinding(
        "AGENT_ENV_IGNORED",
        "info",
        `${agentEnv.ignored.join(", ")} is set; it is not passed to the agent, which uses its own login (docs/agent-providers.md).`,
      ),
    );
  }

  const built = buildContextPack({
    task: spec.id,
    budget: settings.contextBudgetChars,
    allowed: spec.allowedItems,
    items: input.items,
  });
  if (!built.ok) {
    return {
      ok: false,
      result: failure(
        ExitCode.Usage,
        makeFinding(
          "CONTEXT_PACK_OVER_BUDGET",
          "error",
          `The context pack needs ${built.chars} characters after trimming; the budget is ${built.budget}. ${input.overBudgetRemedy}`,
        ),
      ),
    };
  }
  const pack = built.pack;
  if (pack.trimmed.length > 0) {
    findings.push(
      makeFinding(
        "CONTEXT_PACK_TRIMMED",
        "warning",
        `The context pack exceeded ${pack.budget} characters; trimmed: ${pack.trimmed.map((trim) => `${trim.id} (${trim.action})`).join(", ")}`,
      ),
    );
  }

  const model = settings.models[providerId] ?? null;
  const dialect = dialectOf(provider);
  const schema = {
    task: spec.id,
    dialect,
    sha256: sha256Hex(
      new TextEncoder().encode(canonicalJson(toProviderSchema(spec.output, dialect))),
    ),
  };
  const cacheKey = agentCacheKey({
    task: spec.id,
    template: spec.template.ref,
    schema: { dialect, sha256: schema.sha256 },
    provider: providerId,
    model,
    packSha256: pack.sha256,
  });

  const reused = canReuse(input, cacheKey);
  if (reused !== null) {
    findings.push(
      makeFinding(
        "AGENT_RUN_REUSED",
        "info",
        `Inputs, template, schema, provider and model are unchanged; reused run ${reused.runId} and sent nothing (pass --force to ask again).`,
      ),
      ...budgetWarning(usageSummary(ctx, workspace, settings)),
    );
    return { ok: true, reused: true, run: reused, findings };
  }

  const redactor = createValueRedactor(ctx.env);
  const startedAt = ctx.clock.now();
  const logger = createLogger(
    [
      openAppendLog(ctx.fs, workspace.store.heronDir, startedAt, {
        retentionDays: ctx.logRetentionDays,
      }),
    ],
    redactor,
    ctx.clock,
  );
  const services: ProviderServices = {
    runner: ctx.agents.runner,
    temp: ctx.agents.temp,
    env: agentEnv.env,
    probeTimeoutMs: ctx.agents.probeTimeoutMs,
    killGraceMs: ctx.agents.killGraceMs,
  };
  const outcome = await runAgentTask(
    {
      spec,
      provider,
      model,
      pack,
      timeoutMs: settings.timeoutMs,
      validate: input.validate,
      runId,
      logger,
    },
    services,
  );
  if (outcome.status !== "succeeded") {
    const result = failureFor(
      outcome.status,
      provider.label,
      outcome.detail,
      outcome.issues,
      outcome.invocations.length,
      settings.timeoutMs,
      redactor,
    );
    return {
      ok: false,
      result: { ...result, findings: [...findings, ...result.findings] },
    };
  }

  // DR23: value redaction on the validated JSON before anything is written, then the second-order scan.
  let output = outcome.output;
  const redacted = redactor.redact(JSON.stringify(output));
  if (redacted.count > 0) {
    try {
      output = JSON.parse(redacted.text) as T;
    } catch {
      return {
        ok: false,
        result: failureFor(
          "invalid-output",
          provider.label,
          "redacted output is not valid JSON",
          [{ pointer: "", message: "redacted output is not valid JSON" }],
          outcome.invocations.length,
          settings.timeoutMs,
          redactor,
        ),
      };
    }
    findings.push(
      makeFinding(
        "SECRET_REDACTED",
        "warning",
        `A loaded secret value appeared in the agent output and was replaced with [REDACTED] before writing (${redacted.count} occurrence(s)).`,
      ),
    );
  }
  findings.push(...suspiciousFindings(output, logger, runId, spec.id));
  findings.push(...budgetWarning(usageSummary(ctx, workspace, settings)));

  const draft: AgentRunDraft = {
    kind: "AgentRun",
    schemaVersion: 1,
    runId,
    task: spec.id,
    command: input.command,
    role: spec.role,
    provider: providerId,
    cacheKey,
    startedAt: startedAt.toISOString(),
    heronVersion: ctx.heronVersion,
    mode: workspace.mode,
    outputSchema: schema,
    pack: {
      sha256: pack.sha256,
      chars: pack.chars,
      budget: pack.budget,
      items: pack.refs,
      trimmed: pack.trimmed,
    },
    inputs: input.inputs.toSorted(byPath),
    references: input.references.toSorted(),
    status: "succeeded",
    invocations: outcome.invocations,
  };
  return { ok: true, reused: false, output, draft, findings };
}
