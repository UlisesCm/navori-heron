/**
 * Manual live probe, the exit criterion of spec 0003 Lote 6 (T11): `HERON_LIVE_AGENTS=1 bun run test:live`.
 * It launches the user's real `claude` and `codex` CLIs (subscription session, a handful of tiny calls), so it is
 * outside `bun test`'s default glob (`*.test.ts`) and does nothing without the variable. It prints a concise report
 * and exits 1 when any check fails; a failure means DR6/DR7/DR13/DR45 must be corrected before T12.
 */
import { join } from "node:path";
import { claudeArgv, claudeCodeProvider } from "../../src/agents/adapters/claude-code/index.ts";
import {
  codexArgv,
  codexCliProvider,
  codexLineVerdict,
} from "../../src/agents/adapters/codex-cli/index.ts";
import { toProviderSchema } from "../../src/agents/json-schema.ts";
import { bunProcessRunner } from "../../src/agents/process/bun-runner.ts";
import type {
  AgentProvider,
  AgentRequest,
  ProcessOutcome,
  ProviderServices,
} from "../../src/agents/ports.ts";
import { AGENT_TASKS } from "../../src/agents/tasks.ts";
import { canonicalJson } from "../../src/core/contracts/index.ts";
import { nodeTempDirs } from "../../src/core/store/temp-dir.ts";
import { buildAgentEnv } from "../../src/security/env.ts";

if (process.env["HERON_LIVE_AGENTS"] !== "1") {
  console.log("agents.live: skipped (set HERON_LIVE_AGENTS=1 to run it against the real CLIs)");
  process.exit(0);
}

const TIMEOUT_MS = 180_000;
const task = AGENT_TASKS.probe;
const env = Object.fromEntries(
  Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined),
);
const services: ProviderServices = {
  runner: bunProcessRunner,
  temp: nodeTempDirs,
  env,
  probeTimeoutMs: 15_000,
  killGraceMs: 3_000,
};
const request: AgentRequest = {
  task: "probe",
  attempt: 1,
  templateId: task.template.id,
  system: task.template.text,
  pack: {
    text: "<<<data:task-input:probe>>>\nTrivial capability probe.\n<<<end:task-input:probe>>>",
  } as AgentRequest["pack"],
  outputSchema: task.output,
  model: null,
  timeoutMs: TIMEOUT_MS,
};

let failures = 0;
function check(name: string, ok: boolean, detail = ""): void {
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail === "" ? "" : ` -- ${detail}`}`);
}
const info = (name: string, detail: string): void => console.log(`INFO  ${name}: ${detail}`);
const keysOf = (value: unknown): string =>
  typeof value === "object" && value !== null ? Object.keys(value).toSorted().join(",") : "-";
const parse = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};
const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};

/** One raw run (same argv, env and empty cwd as the adapter) to read the CLI's real output shape. */
async function rawRun(
  command: string,
  args: string[],
  stdin: string,
  onStdoutLine?: (line: string) => "continue" | { stop: string },
): Promise<ProcessOutcome> {
  const cwd = nodeTempDirs.create("heron-agent-cwd");
  try {
    return await bunProcessRunner.run({
      command,
      args,
      cwd: cwd.path,
      env: buildAgentEnv(env).env,
      stdin,
      timeoutMs: TIMEOUT_MS,
      killGraceMs: 3_000,
      maxOutputBytes: 10 * 1024 * 1024,
      captureStdout: true,
      onStdoutLine,
    });
  } finally {
    cwd.dispose();
  }
}

async function endToEnd(provider: AgentProvider): Promise<void> {
  const attempt = await provider.invoke(request, services);
  check(
    `${provider.id}: adapter invoke returns schema-valid output`,
    attempt.status === "succeeded",
    attempt.status === "succeeded"
      ? ""
      : `${attempt.status}${"detail" in attempt ? `: ${attempt.detail}` : ""}`,
  );
  check(
    `${provider.id}: no policy-violation on a trivial reply`,
    attempt.status !== "policy-violation",
  );
  if ("usage" in attempt) {
    info(`${provider.id}: usage`, JSON.stringify(attempt.usage));
    check(
      `${provider.id}: token counters parsed (input, output, cached)`,
      attempt.usage.inputTokens !== null &&
        attempt.usage.outputTokens !== null &&
        attempt.usage.cachedInputTokens !== null,
    );
  }
}

async function claude(): Promise<void> {
  console.log("\n== claude-code ==");
  const probe = await claudeCodeProvider.probe(services, "full");
  check(
    "claude: full probe (version, session, DR6 flags in --help)",
    probe.status === "ready",
    JSON.stringify(probe),
  );
  if (probe.status !== "ready") return;
  const schemaJson = canonicalJson(toProviderSchema(task.output, "claude"));
  const outcome = await rawRun(
    "claude",
    claudeArgv({ schemaJson, system: request.system, model: null }),
    request.pack.text,
  );
  if (outcome.kind !== "exited") {
    check("claude: raw run completed", false, outcome.kind);
    return;
  }
  check(
    "claude: DR6 flags keep the subscription session (exit 0)",
    outcome.exitCode === 0,
    outcome.stderrTail.slice(0, 200),
  );
  const envelope = asRecord(parse(outcome.stdout));
  info("claude: envelope keys", keysOf(envelope));
  const structured = envelope["structured_output"];
  if (structured !== undefined && structured !== null) {
    check('claude: --tools "" + --json-schema yields structured_output', true);
  } else {
    check(
      'claude: structured_output missing; DR13 plan B (JSON.parse of result) with --tools "" + --json-schema',
      task.output.safeParse(parse(String(envelope["result"] ?? ""))).success,
      "result is not valid JSON for the schema",
    );
  }
  info("claude: usage keys", keysOf(envelope["usage"]));
  info("claude: modelUsage keys", keysOf(envelope["modelUsage"]));
  info("claude: total_cost_usd", typeof envelope["total_cost_usd"]);
  await endToEnd(claudeCodeProvider);
}

async function codex(): Promise<void> {
  console.log("\n== codex-cli ==");
  const probe = await codexCliProvider.probe(services, "full");
  check(
    "codex: full probe (version, login status, DR6 flags in exec --help)",
    probe.status === "ready",
    JSON.stringify(probe),
  );
  if (probe.status !== "ready") return;
  const io = nodeTempDirs.create("heron-agent-io");
  try {
    const schemaFile = io.writeFile(
      "schema.json",
      canonicalJson(toProviderSchema(task.output, "openai-strict")),
    );
    const lastMessageFile = join(io.path, "last-message.json");
    const types = new Set<string>();
    const outcome = await rawRun(
      "codex",
      codexArgv({ schemaFile, lastMessageFile, model: null }),
      `<heron-instructions>\n${request.system}\n</heron-instructions>\n\n${request.pack.text}`,
      (line) => {
        const event = asRecord(parse(line));
        types.add(
          `${String(event["type"])}${event["item"] === undefined ? "" : `/${String(asRecord(event["item"])["type"])}`}`,
        );
        return codexLineVerdict(line);
      },
    );
    info("codex: event/item types seen", [...types].toSorted().join(" "));
    check(
      'codex: web_search="disabled", --disable list and --ignore-user-config accepted (exit 0, no stop)',
      outcome.kind === "exited" && outcome.exitCode === 0,
      outcome.kind === "exited" ? outcome.stderrTail.slice(0, 200) : outcome.kind,
    );
    if (outcome.kind === "exited") {
      const completed = outcome.stdout
        .split("\n")
        .map(parse)
        .map(asRecord)
        .find((event) => event["type"] === "turn.completed");
      info("codex: turn.completed usage keys", keysOf(asRecord(completed)["usage"]));
      check(
        "codex: turn.completed carries cached_input_tokens (DR45)",
        "cached_input_tokens" in asRecord(asRecord(completed)["usage"]),
      );
    }
  } finally {
    io.dispose();
  }
  await endToEnd(codexCliProvider);
}

await claude();
await codex();
console.log(
  failures === 0
    ? "\nagents.live: all checks passed"
    : `\nagents.live: ${failures} check(s) failed`,
);
process.exit(failures === 0 ? 0 : 1);
