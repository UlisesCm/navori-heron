import type {
  AgentInvocation,
  AgentRunStatus,
  AgentUsage,
  FindingIssue,
  RunId,
  Sha256Hex,
} from "../core/contracts/index.ts";
import { canonicalJson } from "../core/contracts/canonical-json.ts";
import { sha256Hex } from "../core/store/hash.ts";
import type { Logger } from "../security/logger.ts";
import { NO_USAGE } from "./cli-adapter.ts";
import { repairPack } from "./context-pack.ts";
import type {
  AgentAttempt,
  AgentProvider,
  AgentRequest,
  ContextPack,
  ProviderServices,
} from "./ports.ts";
import { REPAIR_TEMPLATE } from "./prompts.ts";
import type { AgentTaskSpec } from "./tasks.ts";

/** 1 initial attempt + 2 compact repairs (DR43). */
const MAX_ATTEMPTS = 3;

export type RunTaskInput<T> = {
  spec: AgentTaskSpec<T>;
  provider: AgentProvider;
  model: string | null;
  pack: ContextPack;
  timeoutMs: number;
  /** Domain validation of an output that already passed the schema; each issue feeds the repair. */
  validate: (output: T) => FindingIssue[];
  runId: RunId;
  logger: Logger;
};

export type TaskOutcome<T> =
  | { status: "succeeded"; output: T; outputSha256: Sha256Hex; invocations: AgentInvocation[] }
  | {
      status: Exclude<AgentRunStatus, "succeeded">;
      detail: string;
      issues: FindingIssue[];
      invocations: AgentInvocation[];
    };

const hashText = (text: string): Sha256Hex => sha256Hex(new TextEncoder().encode(text));

/** Compact, secret-free log line of one attempt (the logger redacts again). */
function logAttempt(logger: Logger, runId: RunId, task: string, invocation: AgentInvocation): void {
  logger.event("agent.invocation", {
    runId,
    task,
    attempt: invocation.attempt,
    kind: invocation.kind,
    provider: invocation.provider,
    model: invocation.model.requested,
    status: invocation.status,
    exitCode: invocation.exitCode,
    durationMs: invocation.durationMs,
    inputTokens: invocation.usage.inputTokens,
    outputTokens: invocation.usage.outputTokens,
    cachedInputTokens: invocation.usage.cachedInputTokens,
    costUsd: invocation.usage.costUsd,
    issues: invocation.issues,
    packSha256: invocation.input.sha256,
  });
}

function usageOf(attempt: AgentAttempt): AgentUsage {
  return "usage" in attempt ? attempt.usage : NO_USAGE;
}

/**
 * provider.probe(services, "full") (not ready -> `unavailable`, no attempt) -> attempts 1..3: the first sends the
 * template and the full pack; each repair sends only `shared/repair` plus the repair pack (task facts, previous output,
 * issues; DR10, DR43), never the original pack. Only `invalid-output` and domain-validation issues are repaired;
 * `timeout`, `failed`, `policy-violation` and `unavailable` stop at once. Logs `agent.invocation` after each attempt.
 * Never throws on provider output.
 */
export async function runAgentTask<T>(
  input: RunTaskInput<T>,
  services: ProviderServices,
): Promise<TaskOutcome<T>> {
  const { spec, provider, model, pack, logger } = input;
  const invocations: AgentInvocation[] = [];

  let probe: Awaited<ReturnType<AgentProvider["probe"]>>;
  try {
    probe = await provider.probe(services, "full");
  } catch {
    return { status: "unavailable", detail: "provider probe failed", issues: [], invocations };
  }
  if (probe.status !== "ready") {
    return { status: "unavailable", detail: probe.detail, issues: [], invocations };
  }

  let current: ContextPack = pack;
  let issues: FindingIssue[] = [];
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const repair = attempt > 1;
    const template = repair ? REPAIR_TEMPLATE : spec.template;
    const request: AgentRequest = {
      task: spec.id,
      attempt,
      templateId: template.id,
      system: template.text,
      pack: current,
      outputSchema: spec.output,
      model,
      timeoutMs: input.timeoutMs,
    };
    let result: AgentAttempt;
    try {
      result = await provider.invoke(request, services);
    } catch {
      result = {
        status: "failed",
        detail: "provider threw",
        cliVersion: null,
        exitCode: null,
        signal: null,
        durationMs: 0,
      };
    }

    let outputText: string | null = null;
    let status: AgentRunStatus = result.status;
    let detail = "detail" in result ? result.detail : "";
    issues = [];
    if (result.status === "succeeded") {
      outputText = result.outputText;
      issues = input.validate(result.output as T);
      if (issues.length > 0) {
        status = "invalid-output";
        detail = `${issues.length} validation issue(s)`;
      }
    } else if (result.status === "invalid-output") {
      outputText = result.outputText;
      issues = [{ pointer: "", message: detail }];
    }

    const invocation: AgentInvocation = {
      attempt,
      kind: repair ? "repair" : "initial",
      provider: provider.id,
      cliVersion: result.cliVersion,
      model: {
        requested: model,
        reported: "reportedModels" in result ? [...result.reportedModels] : [],
      },
      template: template.ref,
      input: { sha256: current.sha256, chars: current.chars },
      output:
        outputText === null
          ? null
          : { sha256: hashText(outputText), bytes: new TextEncoder().encode(outputText).length },
      status,
      exitCode: result.exitCode,
      signal: "signal" in result ? result.signal : null,
      durationMs: result.durationMs,
      usage: usageOf(result),
      issues: issues.length,
    };
    invocations.push(invocation);
    logAttempt(logger, input.runId, spec.id, invocation);

    if (status === "succeeded" && result.status === "succeeded") {
      const output = result.output as T;
      return {
        status: "succeeded",
        output,
        outputSha256: hashText(canonicalJson(output)),
        invocations,
      };
    }
    if (status !== "invalid-output" || !spec.repair || attempt === MAX_ATTEMPTS) {
      // `status` is never "succeeded" here (that case returned above); the ternary only narrows the type.
      return { status: status === "succeeded" ? "failed" : status, detail, issues, invocations };
    }
    current = repairPack(pack, outputText, issues);
  }
  /* c8 ignore next: the loop always returns on its last attempt */
  return { status: "failed", detail: "no attempt ran", issues, invocations };
}
