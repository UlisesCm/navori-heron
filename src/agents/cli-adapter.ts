import { MODEL_NAME_PATTERN, type AgentUsage } from "../core/contracts/index.ts";
import { buildAgentEnv } from "../security/env.ts";
import type {
  AgentAttempt,
  AgentRequest,
  ProbeLevel,
  ProcessOutcome,
  ProviderProbe,
  ProviderServices,
} from "./ports.ts";

/** Helpers shared by the real CLI adapters (claude-code, codex-cli): one probe, one env rule, one outcome mapping. */

export const MAX_OUTPUT_BYTES = 10 * 1024 * 1024;
export const PROBE_OUTPUT_BYTES = 1024 * 1024;
export const OUTPUT_TEXT_CAP = 32_000;

export const NO_USAGE: AgentUsage = {
  inputTokens: null,
  outputTokens: null,
  cachedInputTokens: null,
  costUsd: null,
  costIsEstimate: true,
};

export const record = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
export const count = (value: unknown): number | null =>
  typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;

/** Defense in depth right before building argv: a model name starting with `-` must never reach it. */
export function assertModelName(model: string | null): void {
  if (model !== null && !MODEL_NAME_PATTERN.test(model)) {
    throw new Error("invalid model name");
  }
}

const SEMVER_RE = /(\d+)\.(\d+)\.(\d+)/;

export function parseSemver(text: string): [number, number, number] | null {
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

/** The agent child's environment: the allowlist again over `services.env` (never `process.env`) plus adapter extras. */
export function childEnv(
  services: ProviderServices,
  extra: Readonly<Record<string, string>> = {},
): Record<string, string> {
  return { ...buildAgentEnv(services.env).env, ...extra };
}

/** Removes one surrounding ``` fence (with optional language tag), leaving other text intact. */
export function unfence(text: string): string {
  const trimmed = text.trim();
  if (!trimmed.startsWith("```") || !trimmed.endsWith("```") || trimmed.length < 6) return trimmed;
  const body = trimmed.slice(3, -3);
  const newline = body.indexOf("\n");
  return (newline === -1 ? body : body.slice(newline + 1)).trim();
}

/** Zod issues as `path: message` (never values), at most five, capped at 500 chars. */
export function schemaIssues(error: {
  issues: readonly { path: readonly PropertyKey[]; message: string }[];
}): string {
  const issues = error.issues
    .slice(0, 5)
    .map((issue) => `${issue.path.map(String).join(".") || "<root>"}: ${issue.message}`)
    .join("; ");
  return `output does not match the schema: ${issues}`.slice(0, 500);
}

/** Outcomes that never reached an exit (missing binary, timeout, output cap); null for `exited` and `stopped`. */
export function unfinishedAttempt(
  outcome: ProcessOutcome,
  command: string,
  request: AgentRequest,
): AgentAttempt | null {
  const base = { cliVersion: null, exitCode: null, signal: null, durationMs: 0 };
  if (outcome.kind === "not-found") {
    return { ...base, status: "unavailable", detail: `${command} is not on PATH` };
  }
  if (outcome.kind === "timeout") {
    return {
      ...base,
      status: "timeout",
      detail: `${command} exceeded ${request.timeoutMs} ms`,
      durationMs: outcome.durationMs,
    };
  }
  if (outcome.kind === "output-too-large") {
    return {
      ...base,
      status: "failed",
      detail: `${command} output exceeded 10 MiB`,
      durationMs: outcome.durationMs,
    };
  }
  return null;
}

/** An invocation that failed before the process ran (temp dir, schema, argv). */
export function preflightFailure(command: string): AgentAttempt {
  return {
    status: "failed",
    detail: `${command} invocation failed before the process ran`,
    cliVersion: null,
    exitCode: null,
    signal: null,
    durationMs: 0,
  };
}

export type ProbeSpec = {
  command: string;
  minimum: string;
  /** Arguments of the exit-code-only session check (`auth status`, `login status`). */
  authArgs: readonly string[];
  /** Arguments that print the help listing the capability flags. */
  helpArgs: readonly string[];
  requiredFlags: readonly string[];
};

/** Runs one probe command in a throwaway empty cwd. */
async function probeRun(
  spec: ProbeSpec,
  services: ProviderServices,
  args: readonly string[],
  captureStdout: boolean,
): Promise<ProcessOutcome> {
  const temp = services.temp.create("heron-agent-cwd");
  try {
    return await services.runner.run({
      command: spec.command,
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

/** Version (semver floor), session by exit code only (stdout discarded, credentials never read) and, when full, capabilities. */
export async function probeCli(
  spec: ProbeSpec,
  services: ProviderServices,
  level: ProbeLevel,
): Promise<ProviderProbe> {
  const { command, minimum } = spec;
  const fail = (
    status: "missing" | "outdated" | "unsupported" | "logged-out" | "error",
    cliVersion: string | null,
    detail: string,
  ): ProviderProbe => ({ status, cliVersion, minimum, detail });
  try {
    const version = await probeRun(spec, services, ["--version"], true);
    if (version.kind === "not-found") return fail("missing", null, `${command} is not on PATH`);
    if (version.kind !== "exited" || version.exitCode !== 0) {
      return fail("error", null, `${command} --version did not complete`);
    }
    const parsed = parseSemver(version.stdout);
    if (parsed === null) return fail("error", null, `${command} --version printed no version`);
    const cliVersion = parsed.join(".");
    if (isBelow(parsed, parseSemver(minimum) ?? [0, 0, 0])) {
      return fail("outdated", cliVersion, `${command} ${cliVersion} is older than ${minimum}`);
    }
    const auth = await probeRun(spec, services, spec.authArgs, false);
    if (auth.kind !== "exited") {
      return fail("error", cliVersion, `${command} ${spec.authArgs.join(" ")} did not complete`);
    }
    if (auth.exitCode !== 0)
      return fail("logged-out", cliVersion, `${command} has no active session`);
    if (level === "full") {
      const help = await probeRun(spec, services, spec.helpArgs, true);
      if (help.kind !== "exited" || help.exitCode !== 0) {
        return fail("error", cliVersion, `${command} ${spec.helpArgs.join(" ")} did not complete`);
      }
      const missing = spec.requiredFlags.find((flag) => !help.stdout.includes(flag));
      if (missing !== undefined) return fail("unsupported", cliVersion, `missing ${missing}`);
    }
    return { status: "ready", cliVersion, minimum };
  } catch {
    return fail("error", null, "probe failed");
  }
}
