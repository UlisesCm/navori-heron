import { canonicalJson, type AgentUsage } from "../../../core/contracts/index.ts";
import { toProviderSchema } from "../../json-schema.ts";
import type {
  AgentAttempt,
  AgentProvider,
  AgentRequest,
  ContextPack,
  LineVerdict,
  ProbeLevel,
  ProcessOutcome,
  ProviderProbe,
  ProviderServices,
} from "../../ports.ts";
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

const COMMAND = "codex";
const MINIMUM_VERSION = "0.159.2";
const SCHEMA_FILE = "schema.json";
const LAST_MESSAGE_FILE = "last-message.json";

/** Features switched off in every run (DR6). `unified_exec` cannot be switched off in 0.159.2: the monitor is the control. */
export const CODEX_DISABLED_FEATURES: readonly string[] = [
  "shell_tool",
  "browser_use",
  "browser_use_external",
  "computer_use",
  "apps",
  "plugins",
  "hooks",
  "multi_agent",
  "image_generation",
  "view_image",
];

/** Isolation flags every invocation carries (DR6): read-only sandbox, no session, no user config, no web search. */
export const CODEX_FIXED_ARGS: readonly string[] = [
  "exec",
  "--sandbox",
  "read-only",
  "--ephemeral",
  "--skip-git-repo-check",
  "--ignore-user-config",
  "--ignore-rules",
  "--json",
  "--color",
  "never",
  ...CODEX_DISABLED_FEATURES.flatMap((feature) => ["--disable", feature]),
  "-c",
  'web_search="disabled"',
];

/** The only event types `--json` may emit (DR7); anything else stops the process. */
export const CODEX_ALLOWED_EVENT_TYPES: readonly string[] = [
  "thread.started",
  "turn.started",
  "turn.completed",
  "turn.failed",
  "item.started",
  "item.updated",
  "item.completed",
  "error",
];

/** The only item types allowed inside `item.*` events (DR7); tool items (commands, MCP, web search, file changes) are not. */
export const CODEX_ALLOWED_ITEM_TYPES: readonly string[] = ["agent_message", "reasoning"];

/** Flags `codex exec --help` must list for a "full" probe to be ready (DR35.d). */
const CODEX_REQUIRED_FLAGS: readonly string[] = [
  ...new Set(CODEX_FIXED_ARGS.filter((arg) => arg.startsWith("--"))),
  "--output-schema",
];

/** Argv as an array (never a shell string); the template and pack travel by stdin (`-`). */
export function codexArgv(input: {
  schemaFile: string;
  lastMessageFile: string;
  model: string | null;
}): string[] {
  assertModelName(input.model);
  return [
    ...CODEX_FIXED_ARGS,
    "--output-schema",
    input.schemaFile,
    "-o",
    input.lastMessageFile,
    ...(input.model === null ? [] : ["-m", input.model]),
    "-",
  ];
}

/** Codex has no `--system-prompt`: the template leads the stdin as a user-level block (DR29, DR41). */
export function codexPrompt(system: string, pack: ContextPack): string {
  return `<heron-instructions>\n${system}\n</heron-instructions>\n\n${pack.text}`;
}

const TOKEN_RE = /^[a-z_.]{1,40}$/;
/** A type name safe to surface: lowercase, dots and underscores only; anything else is "unknown". */
const tokenOf = (value: unknown): string =>
  typeof value === "string" && TOKEN_RE.test(value) ? value : "unknown";

type Classified = { verdict: LineVerdict; event: Record<string, unknown> | null };

/** Allowlist check of one stdout line; the line itself never leaves this function (only a sanitized type token). */
function classify(line: string): Classified {
  if (line.trim() === "") return { verdict: "continue", event: null };
  let event: Record<string, unknown> | null = null;
  try {
    event = record(JSON.parse(line));
  } catch {
    event = null;
  }
  const type = event?.["type"];
  if (event === null || typeof type !== "string") {
    return { verdict: { stop: "unknown" }, event: null };
  }
  if (!CODEX_ALLOWED_EVENT_TYPES.includes(type)) {
    return { verdict: { stop: tokenOf(type) }, event: null };
  }
  if (type.startsWith("item.")) {
    const itemType = record(event["item"])?.["type"];
    if (typeof itemType !== "string" || !CODEX_ALLOWED_ITEM_TYPES.includes(itemType)) {
      return { verdict: { stop: `item.${tokenOf(itemType)}`.slice(0, 40) }, event: null };
    }
  }
  return { verdict: "continue", event };
}

/** Pure monitor (DR7): "continue" for allowed events and items, `{ stop: token }` for anything else; never returns the line. */
export function codexLineVerdict(line: string): LineVerdict {
  return classify(line).verdict;
}

const PROBE_SPEC = {
  command: COMMAND,
  minimum: MINIMUM_VERSION,
  authArgs: ["login", "status"],
  helpArgs: ["exec", "--help"],
  requiredFlags: CODEX_REQUIRED_FLAGS,
} as const;

const probe = (services: ProviderServices, level: ProbeLevel): Promise<ProviderProbe> =>
  probeCli(PROBE_SPEC, services, level);

const sum = (a: number | null, b: number | null): number | null =>
  a === null ? b : b === null ? a : a + b;

/** Token counters of the `turn.completed` events seen so far (DR45); fields the CLI omits stay null. */
function addUsage(total: AgentUsage, event: Record<string, unknown>): AgentUsage {
  const usage = record(event["usage"]);
  return {
    ...total,
    inputTokens: sum(total.inputTokens, count(usage?.["input_tokens"])),
    outputTokens: sum(total.outputTokens, count(usage?.["output_tokens"])),
    cachedInputTokens: sum(total.cachedInputTokens, count(usage?.["cached_input_tokens"])),
  };
}

/** What the stdout monitor observed: usage and whether Codex reported a failed turn or an error event. */
type Observed = { usage: AgentUsage; reportedFailure: boolean };

/** Maps one finished `codex exec --json` run to an attempt; never throws on hostile output. */
function toAttempt(
  outcome: ProcessOutcome,
  request: AgentRequest,
  observed: Observed,
  readLastMessage: () => string | null,
): AgentAttempt {
  const unfinished = unfinishedAttempt(outcome, COMMAND, request);
  if (unfinished !== null) return unfinished;
  if (outcome.kind === "stopped") {
    return {
      status: "policy-violation",
      detail: `codex emitted a disallowed event or item type (${outcome.reason}); the process was stopped`,
      cliVersion: null,
      exitCode: null,
      signal: null,
      durationMs: outcome.durationMs,
    };
  }
  if (outcome.kind !== "exited") return preflightFailure(COMMAND);
  const common = { cliVersion: null, exitCode: outcome.exitCode, durationMs: outcome.durationMs };
  const failed = (detail: string): AgentAttempt => ({
    ...common,
    signal: outcome.signal,
    status: "failed",
    detail,
  });
  if (outcome.exitCode !== 0) {
    return failed(
      `codex exited with ${outcome.exitCode ?? outcome.signal ?? "unknown status"}: ${outcome.stderrTail}`,
    );
  }
  if (observed.reportedFailure) return failed("codex reported a failed turn or an error event");
  const { usage } = observed;
  const invalid = (detail: string, outputText: string | null): AgentAttempt => ({
    ...common,
    status: "invalid-output",
    detail,
    outputText: outputText === null ? null : outputText.slice(0, OUTPUT_TEXT_CAP),
    reportedModels: [],
    usage,
  });
  const text = readLastMessage();
  if (text === null) return invalid("codex wrote no last message", null);
  let candidate: unknown;
  try {
    candidate = JSON.parse(unfence(text));
  } catch {
    return invalid("codex last message is not JSON", text);
  }
  const parsed = request.outputSchema.safeParse(candidate);
  if (!parsed.success) return invalid(schemaIssues(parsed.error), text);
  return {
    ...common,
    status: "succeeded",
    output: parsed.data,
    outputText: text,
    reportedModels: [], // Codex's documented events carry no model name (DR36)
    usage,
  };
}

async function invoke(request: AgentRequest, services: ProviderServices): Promise<AgentAttempt> {
  const temps: ReturnType<ProviderServices["temp"]["create"]>[] = [];
  try {
    const cwd = services.temp.create("heron-agent-cwd");
    temps.push(cwd);
    const io = services.temp.create("heron-agent-io");
    temps.push(io);
    const schemaFile = io.writeFile(
      SCHEMA_FILE,
      canonicalJson(toProviderSchema(request.outputSchema, "openai-strict")),
    );
    const args = codexArgv({
      schemaFile,
      lastMessageFile: `${io.path}/${LAST_MESSAGE_FILE}`,
      model: request.model,
    });
    const observed: Observed = { usage: NO_USAGE, reportedFailure: false };
    const outcome = await services.runner.run({
      command: COMMAND,
      args,
      cwd: cwd.path,
      env: childEnv(services),
      stdin: codexPrompt(request.system, request.pack),
      timeoutMs: request.timeoutMs,
      killGraceMs: services.killGraceMs,
      maxOutputBytes: MAX_OUTPUT_BYTES,
      captureStdout: false,
      onStdoutLine: (line) => {
        const { verdict, event } = classify(line);
        const type = event?.["type"];
        if (type === "turn.completed" && event !== null) {
          observed.usage = addUsage(observed.usage, event);
        } else if (type === "turn.failed" || type === "error") {
          observed.reportedFailure = true;
        }
        return verdict;
      },
    });
    return toAttempt(outcome, request, observed, () => io.readFile(LAST_MESSAGE_FILE));
  } catch {
    return preflightFailure(COMMAND);
  } finally {
    for (const temp of temps) temp.dispose();
  }
}

export const codexCliProvider: AgentProvider = {
  id: "codex-cli",
  label: "Codex CLI",
  minimumVersion: MINIMUM_VERSION,
  probe,
  invoke,
};
