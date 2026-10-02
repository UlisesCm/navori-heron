import { canonicalJson, type AgentUsage } from "../../../core/contracts/index.ts";
import { toProviderSchema } from "../../json-schema.ts";
import type {
  AgentAttempt,
  AgentProvider,
  AgentRequest,
  ProbeLevel,
  ProcessOutcome,
  ProviderProbe,
  ProviderServices,
} from "../../ports.ts";
import { AGENT_TASKS } from "../../tasks.ts";
import {
  assertModelName,
  childEnv,
  count,
  MAX_OUTPUT_BYTES,
  NO_USAGE,
  OUTPUT_TEXT_CAP,
  preflightFailure,
  probeCli,
  record,
  schemaIssues,
  unfence,
  unfinishedAttempt,
} from "../../cli-adapter.ts";

const COMMAND = "claude";
const MINIMUM_VERSION = "2.1.259";

/** Isolation flags every invocation carries (DR6): tool-less, no MCP, no session persistence, no prompts, no user settings. */
export const CLAUDE_FIXED_ARGS: readonly string[] = [
  "-p",
  "--output-format",
  "json",
  "--tools",
  "",
  "--disallowedTools",
  "mcp__*",
  "--strict-mcp-config",
  "--no-session-persistence",
  "--safe-mode",
  "--restricted",
  "--permission-mode",
  "dontAsk",
  "--permission-prompts",
  "none",
];

/** Flags `claude --help` must list for a "full" probe to be ready (DR35.d); `-p` is listed as `--print`. */
export const CLAUDE_REQUIRED_FLAGS: readonly string[] = [
  "--print",
  ...CLAUDE_FIXED_ARGS.filter((arg) => arg.startsWith("--")),
  "--json-schema",
  "--system-prompt",
];

/** Argv as an array (never a shell string); the pack travels by stdin, never as an argument. Never `--bare`. */
export function claudeArgv(input: {
  schemaJson: string;
  system: string;
  model: string | null;
}): string[] {
  assertModelName(input.model);
  return [
    ...CLAUDE_FIXED_ARGS,
    "--json-schema",
    input.schemaJson,
    "--system-prompt",
    input.system,
    ...(input.model === null ? [] : ["--model", input.model]),
  ];
}

const PROBE_SPEC = {
  command: COMMAND,
  minimum: MINIMUM_VERSION,
  authArgs: ["auth", "status"],
  helpArgs: ["--help"],
  requiredFlags: CLAUDE_REQUIRED_FLAGS,
} as const;

const probe = (services: ProviderServices, level: ProbeLevel): Promise<ProviderProbe> =>
  probeCli(PROBE_SPEC, services, level);

function usageOf(envelope: Record<string, unknown>): AgentUsage {
  const usage = record(envelope["usage"]);
  const cost = envelope["total_cost_usd"];
  return {
    inputTokens: count(usage?.["input_tokens"]),
    outputTokens: count(usage?.["output_tokens"]),
    cachedInputTokens: count(usage?.["cache_read_input_tokens"]),
    costUsd: typeof cost === "number" && Number.isFinite(cost) && cost >= 0 ? cost : null,
    costIsEstimate: true,
  };
}

/** Maps one finished `claude -p --output-format json` run to an attempt; never throws on hostile output. */
function toAttempt(outcome: ProcessOutcome, request: AgentRequest): AgentAttempt {
  const unfinished = unfinishedAttempt(outcome, COMMAND, request);
  if (unfinished !== null) return unfinished;
  if (outcome.kind === "stopped") {
    return {
      status: "failed",
      detail: outcome.reason,
      cliVersion: null,
      exitCode: null,
      signal: null,
      durationMs: outcome.durationMs,
    };
  }
  if (outcome.kind !== "exited") return preflightFailure(COMMAND);
  const common = { cliVersion: null, exitCode: outcome.exitCode, durationMs: outcome.durationMs };
  let envelope: Record<string, unknown> | null = null;
  try {
    envelope = record(JSON.parse(outcome.stdout));
  } catch {
    envelope = null;
  }
  const subtype = typeof envelope?.["subtype"] === "string" ? envelope["subtype"] : null;
  if (envelope?.["is_error"] === true || (subtype !== null && subtype.startsWith("error"))) {
    return {
      ...common,
      signal: outcome.signal,
      status: "failed",
      detail: `claude reported an error${subtype === null ? "" : ` (${subtype})`}`,
    };
  }
  if (outcome.exitCode !== 0) {
    return {
      ...common,
      signal: outcome.signal,
      status: "failed",
      detail: `claude exited with ${outcome.exitCode ?? outcome.signal ?? "unknown status"}: ${outcome.stderrTail}`,
    };
  }
  const usage = envelope === null ? NO_USAGE : usageOf(envelope);
  const reportedModels = Object.keys(record(envelope?.["modelUsage"]) ?? {}).toSorted();
  const invalid = (detail: string, outputText: string | null): AgentAttempt => ({
    ...common,
    status: "invalid-output",
    detail,
    outputText: outputText === null ? null : outputText.slice(0, OUTPUT_TEXT_CAP),
    reportedModels,
    usage,
  });
  if (envelope === null) return invalid("claude stdout is not a JSON envelope", outcome.stdout);

  let candidate: unknown = envelope["structured_output"];
  let outputText: string | null = null;
  if (candidate === undefined || candidate === null) {
    const result = envelope["result"];
    if (typeof result !== "string") return invalid("claude returned no output", null);
    outputText = result;
    try {
      candidate = JSON.parse(unfence(result));
    } catch {
      return invalid("claude result is not JSON", result);
    }
  } else {
    outputText = JSON.stringify(candidate);
  }
  const parsed = request.outputSchema.safeParse(candidate);
  if (!parsed.success) {
    return invalid(schemaIssues(parsed.error), outputText);
  }
  return {
    ...common,
    status: "succeeded",
    output: parsed.data,
    outputText,
    reportedModels,
    usage,
  };
}

async function invoke(request: AgentRequest, services: ProviderServices): Promise<AgentAttempt> {
  let temp: ReturnType<ProviderServices["temp"]["create"]> | null = null;
  try {
    temp = services.temp.create("heron-agent-cwd");
    const schemaJson = canonicalJson(toProviderSchema(request.outputSchema, "claude"));
    const outcome = await services.runner.run({
      command: COMMAND,
      args: claudeArgv({ schemaJson, system: request.system, model: request.model }),
      cwd: temp.path,
      env: childEnv(services, {
        CLAUDE_CODE_MAX_OUTPUT_TOKENS: String(AGENT_TASKS[request.task].maxOutputTokens),
      }),
      stdin: request.pack.text,
      timeoutMs: request.timeoutMs,
      killGraceMs: services.killGraceMs,
      maxOutputBytes: MAX_OUTPUT_BYTES,
      captureStdout: true,
    });
    return toAttempt(outcome, request);
  } catch {
    return preflightFailure(COMMAND);
  } finally {
    temp?.dispose();
  }
}

export const claudeCodeProvider: AgentProvider = {
  id: "claude-code",
  label: "Claude Code",
  minimumVersion: MINIMUM_VERSION,
  probe,
  invoke,
};
