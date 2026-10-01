import { canonicalJson, type AgentUsage } from "../../../core/contracts/index.ts";
import { buildAgentEnv } from "../../../security/env.ts";
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

const COMMAND = "claude";
const MINIMUM_VERSION = "2.1.259";
const MAX_OUTPUT_BYTES = 10 * 1024 * 1024;
const PROBE_OUTPUT_BYTES = 1024 * 1024;
const OUTPUT_TEXT_CAP = 32_000;

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
  return [
    ...CLAUDE_FIXED_ARGS,
    "--json-schema",
    input.schemaJson,
    "--system-prompt",
    input.system,
    ...(input.model === null ? [] : ["--model", input.model]),
  ];
}

const SEMVER_RE = /(\d+)\.(\d+)\.(\d+)/;

function parseSemver(text: string): [number, number, number] | null {
  const match = SEMVER_RE.exec(text);
  return match === null ? null : [Number(match[1]), Number(match[2]), Number(match[3])];
}

function isBelow(version: readonly number[], minimum: readonly number[]): boolean {
  for (let i = 0; i < 3; i += 1) {
    const diff = (version[i] ?? 0) - (minimum[i] ?? 0);
    if (diff !== 0) return diff < 0;
  }
  return false;
}

/** The agent child's environment: the allowlist again over `services.env` (never `process.env`) plus DR42's output cap. */
function childEnv(services: ProviderServices, maxOutputTokens?: number): Record<string, string> {
  const env = buildAgentEnv(services.env).env;
  return maxOutputTokens === undefined
    ? env
    : { ...env, CLAUDE_CODE_MAX_OUTPUT_TOKENS: String(maxOutputTokens) };
}

const record = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
const count = (value: unknown): number | null =>
  typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;

/** Runs one probe command in a throwaway empty cwd. */
async function probeRun(
  services: ProviderServices,
  args: readonly string[],
  captureStdout: boolean,
): Promise<ProcessOutcome> {
  const temp = services.temp.create("heron-agent-cwd");
  try {
    return await services.runner.run({
      command: COMMAND,
      args,
      cwd: temp.path,
      env: childEnv(services),
      stdin: null,
      timeoutMs: services.probeTimeoutMs,
      killGraceMs: services.killGraceMs,
      maxOutputBytes: PROBE_OUTPUT_BYTES,
      captureStdout,
    });
  } finally {
    temp.dispose();
  }
}

const fail = (
  status: "missing" | "outdated" | "unsupported" | "logged-out" | "error",
  cliVersion: string | null,
  detail: string,
): ProviderProbe => ({ status, cliVersion, minimum: MINIMUM_VERSION, detail });

async function probe(services: ProviderServices, level: ProbeLevel): Promise<ProviderProbe> {
  try {
    const version = await probeRun(services, ["--version"], true);
    if (version.kind === "not-found") return fail("missing", null, "claude is not on PATH");
    if (version.kind !== "exited" || version.exitCode !== 0) {
      return fail("error", null, "claude --version did not complete");
    }
    const parsed = parseSemver(version.stdout);
    if (parsed === null) return fail("error", null, "claude --version printed no version");
    const cliVersion = parsed.join(".");
    if (isBelow(parsed, parseSemver(MINIMUM_VERSION) ?? [0, 0, 0])) {
      return fail("outdated", cliVersion, `claude ${cliVersion} is older than ${MINIMUM_VERSION}`);
    }
    // exit code only: stdout of `auth status` is discarded, credentials are never read
    const auth = await probeRun(services, ["auth", "status"], false);
    if (auth.kind !== "exited")
      return fail("error", cliVersion, "claude auth status did not complete");
    if (auth.exitCode !== 0) return fail("logged-out", cliVersion, "claude has no active session");
    if (level === "full") {
      const help = await probeRun(services, ["--help"], true);
      if (help.kind !== "exited" || help.exitCode !== 0) {
        return fail("error", cliVersion, "claude --help did not complete");
      }
      const missing = CLAUDE_REQUIRED_FLAGS.find((flag) => !help.stdout.includes(flag));
      if (missing !== undefined) return fail("unsupported", cliVersion, `missing ${missing}`);
    }
    return { status: "ready", cliVersion, minimum: MINIMUM_VERSION };
  } catch {
    return fail("error", null, "probe failed");
  }
}

/** Removes one surrounding ``` fence (with optional language tag), leaving other text intact. */
function unfence(text: string): string {
  const trimmed = text.trim();
  if (!trimmed.startsWith("```") || !trimmed.endsWith("```") || trimmed.length < 6) return trimmed;
  const body = trimmed.slice(3, -3);
  const newline = body.indexOf("\n");
  return (newline === -1 ? body : body.slice(newline + 1)).trim();
}

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

const NO_USAGE: AgentUsage = {
  inputTokens: null,
  outputTokens: null,
  cachedInputTokens: null,
  costUsd: null,
  costIsEstimate: true,
};

/** Maps one finished `claude -p --output-format json` run to an attempt; never throws on hostile output. */
function toAttempt(outcome: ProcessOutcome, request: AgentRequest): AgentAttempt {
  const base = { cliVersion: null, exitCode: null, signal: null, durationMs: 0 };
  if (outcome.kind === "not-found") {
    return { ...base, status: "unavailable", detail: "claude is not on PATH" };
  }
  if (outcome.kind === "timeout") {
    return {
      ...base,
      status: "timeout",
      detail: `claude exceeded ${request.timeoutMs} ms`,
      durationMs: outcome.durationMs,
    };
  }
  if (outcome.kind === "output-too-large") {
    return {
      ...base,
      status: "failed",
      detail: "claude output exceeded 10 MiB",
      durationMs: outcome.durationMs,
    };
  }
  if (outcome.kind === "stopped") {
    return { ...base, status: "failed", detail: outcome.reason, durationMs: outcome.durationMs };
  }
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
    const issues = parsed.error.issues
      .slice(0, 5)
      .map((issue) => `${issue.path.join(".") || "<root>"}: ${issue.message}`)
      .join("; ");
    return invalid(`output does not match the schema: ${issues}`.slice(0, 500), outputText);
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
      env: childEnv(services, AGENT_TASKS[request.task].maxOutputTokens),
      stdin: request.pack.text,
      timeoutMs: request.timeoutMs,
      killGraceMs: services.killGraceMs,
      maxOutputBytes: MAX_OUTPUT_BYTES,
      captureStdout: true,
    });
    return toAttempt(outcome, request);
  } catch {
    return {
      status: "failed",
      detail: "claude invocation failed before the process ran",
      cliVersion: null,
      exitCode: null,
      signal: null,
      durationMs: 0,
    };
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
