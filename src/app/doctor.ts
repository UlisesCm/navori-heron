import { join } from "node:path";
import { buildContextPack } from "../agents/context-pack.ts";
import type { AgentProvider, AgentRequest, ProviderServices } from "../agents/ports.ts";
import {
  DEFAULT_AGENT_SETTINGS,
  resolveAgentSettings,
  type AgentSettings,
} from "../agents/settings.ts";
import { AGENT_TASKS } from "../agents/tasks.ts";
import {
  DOCTOR_CHECK_IDS,
  ExitCode,
  type AgentProviderId,
  HERON_PROJECT_DOCUMENT,
  HERON_STATE_DOCUMENT,
  MODE_DECISION_DOCUMENT,
  type DoctorCheck,
  type DoctorCheckId,
  type DoctorCheckStatus,
  type DoctorData,
  type HeronProject,
} from "../core/contracts/index.ts";
import { detectMode } from "../core/state/mode.ts";
import { readLogEvents } from "../core/store/append-log.ts";
import {
  HERON_DIR,
  HERON_GITIGNORE,
  GITIGNORE_FILE,
  LOCK_FILE,
  MODE_FILE,
  PROJECT_FILE,
  STATE_FILE,
  openFileStore,
} from "../core/store/file-store.ts";
import { isLockStale, readLockOwner } from "../core/store/lock.ts";
import { detectProject } from "../intake/detect.ts";
import { buildAgentEnv } from "../security/env.ts";
import { createValueRedactor } from "../security/redact.ts";
import { summarizeAgentUsage } from "./agent-usage.ts";
import type { AppContext } from "./context.ts";
import { penpotChecks } from "./penpot-doctor.ts";
import { resolveDirectory, storeErrorResult, type UseCaseResult } from "./result.ts";

export const DOCTOR_CHECK_TIMEOUT_MS = 10_000;
/** Minimum Bun version Heron runs on. */
const MIN_BUN: readonly [number, number, number] = [1, 4, 2];

export type DoctorInput = { path: string; deep: boolean };

type Outcome = { status: DoctorCheckStatus; message: string; remedy: string | null };
type CheckSpec = {
  id: DoctorCheckId;
  kind: DoctorCheck["kind"];
  run: () => Outcome | Promise<Outcome>;
};

const pass = (message: string): Outcome => ({ status: "PASS", message, remedy: null });
const warn = (message: string, remedy: string | null = null): Outcome => ({
  status: "WARNING",
  message,
  remedy,
});
const fail = (message: string, remedy: string | null = null): Outcome => ({
  status: "FAIL",
  message,
  remedy,
});

/** Races `work` against a timer; the timer is always cleared. */
export async function withTimeout<T>(
  work: () => T | Promise<T>,
  timeoutMs: number,
): Promise<{ timedOut: false; value: T } | { timedOut: true }> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<{ timedOut: true }>((resolve) => {
    timer = setTimeout(() => resolve({ timedOut: true }), timeoutMs);
  });
  const done = (async (): Promise<{ timedOut: false; value: T }> => ({
    timedOut: false,
    value: await work(),
  }))();
  try {
    return await Promise.race([done, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/** Runs one check with its timeout and duration; a throw or a timeout becomes a FAIL. */
export async function runCheck(spec: CheckSpec, timeoutMs: number): Promise<DoctorCheck> {
  const started = performance.now();
  let outcome: Outcome;
  try {
    const result = await withTimeout(spec.run, timeoutMs);
    outcome = result.timedOut ? fail(`timed out after ${timeoutMs} ms`) : result.value;
  } catch (error) {
    outcome = fail(`check failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  return {
    id: spec.id,
    kind: spec.kind,
    ...outcome,
    durationMs: Math.max(0, Math.round(performance.now() - started)),
  };
}

function parseVersion(version: string): [number, number, number] | null {
  const parts = version.split(".").map((part) => Number.parseInt(part, 10));
  const [major, minor, patch] = parts;
  if (major === undefined || minor === undefined || patch === undefined) return null;
  return [major, minor, patch].some(Number.isNaN) ? null : [major, minor, patch];
}

function atLeast(found: readonly number[], minimum: readonly number[]): boolean {
  for (const [index, need] of minimum.entries()) {
    const have = found[index] ?? 0;
    if (have !== need) return have > need;
  }
  return true;
}

function bunCheck(ctx: AppContext): Outcome {
  const minimum = MIN_BUN.join(".");
  const remedy = `Install Bun ${minimum} or newer.`;
  const raw = ctx.process.bunVersion;
  if (raw === null) return fail("Not running under Bun.", remedy);
  const parsed = parseVersion(raw);
  if (parsed === null || !atLeast(parsed, MIN_BUN)) {
    return fail(`Bun ${raw} is older than ${minimum}.`, remedy);
  }
  return pass(`Bun ${raw}`);
}

/** Outcome of a store failure, reusing the message the other commands report. */
function storeFailure(error: unknown): Outcome {
  const mapped = storeErrorResult<never>(error);
  if (mapped === null || mapped.ok) throw error;
  return fail(mapped.message, "Restore .heron/ from Git.");
}

function documentsCheck(ctx: AppContext, root: string, path: string): Outcome {
  try {
    const store = openFileStore(ctx.fs, root, { create: false });
    if (store.readDocument(STATE_FILE, HERON_STATE_DOCUMENT) === null) {
      return warn("Not initialized", `Run: heron init ${path}`);
    }
    const missing: string[] = [];
    if (store.readDocument(PROJECT_FILE, HERON_PROJECT_DOCUMENT) === null) {
      missing.push(PROJECT_FILE);
    }
    if (store.readDocument(MODE_FILE, MODE_DECISION_DOCUMENT) === null) missing.push(MODE_FILE);
    if (missing.length > 0) {
      return fail(`${missing.join(", ")} missing in ${HERON_DIR}/`, "Restore .heron/ from Git.");
    }
    return pass("project.json, state.json and intake/mode.json are readable");
  } catch (error) {
    return storeFailure(error);
  }
}

function lockCheck(ctx: AppContext, root: string): Outcome {
  const heronDir = join(root, HERON_DIR);
  const lockPath = join(heronDir, LOCK_FILE);
  if (!ctx.fs.existsSync(lockPath)) return pass("No lock held");
  const owner = readLockOwner(ctx.fs, heronDir);
  const stale = isLockStale(owner, ctx.fs.lstatSync(lockPath).mtimeMs, {
    ...ctx.lock,
    hostname: ctx.process.hostname,
    now: () => Date.now(),
  });
  const who =
    owner === null
      ? "owner unreadable"
      : `"${owner.command}", pid ${owner.pid} on ${owner.hostname}, since ${owner.acquiredAt}`;
  return stale
    ? warn(`Stale lock (${who})`, "The next Heron write command reclaims it automatically.")
    : warn(`Locked by another Heron command (${who})`, "Wait for it to finish and retry.");
}

function gitignoreCheck(ctx: AppContext, root: string, path: string): Outcome {
  try {
    const store = openFileStore(ctx.fs, root, { create: false });
    const bytes = store.readBytes(GITIGNORE_FILE);
    if (bytes === null) {
      return warn(`${HERON_DIR}/${GITIGNORE_FILE} not found`, `Run: heron init ${path}`);
    }
    return new TextDecoder().decode(bytes) === HERON_GITIGNORE
      ? pass(`${HERON_DIR}/${GITIGNORE_FILE} is up to date`)
      : warn(
          `${HERON_DIR}/${GITIGNORE_FILE} differs from the one Heron manages`,
          `Run: heron init ${path}`,
        );
  } catch (error) {
    return storeFailure(error);
  }
}

function detectionCheck(ctx: AppContext, root: string): Outcome {
  let stage: string | null = null;
  try {
    const store = openFileStore(ctx.fs, root, { create: false });
    stage = store.readDocument(PROJECT_FILE, HERON_PROJECT_DOCUMENT)?.source.stage?.dir ?? null;
  } catch {
    // An unreadable .heron/ is reported by heron.documents; detection falls back to the default stage.
  }
  const detection = detectProject({ root, stage, fs: ctx.fs, limits: ctx.limits });
  if (detection.kind === "stage-error") return warn(detection.message);
  const { report } = detection;
  const findings = [...report.findings, ...detectMode(report).findings];
  if (findings.length > 0) {
    return warn(findings.map((finding) => `${finding.code}: ${finding.message}`).join("; "));
  }
  return pass(`adapter ${report.adapter}, stage ${report.stage?.dir ?? "none"}`);
}

/** Cap on detail text echoed from a provider (already redacted). */
const MAX_DETAIL_CHARS = 300;
/** Redacts loaded secret values and caps provider-originated detail text. */
const safeDetail =
  (ctx: AppContext) =>
  (text: string): string =>
    createValueRedactor(ctx.env).redact(text).text.slice(0, MAX_DETAIL_CHARS);
const LOGIN_COMMAND: Readonly<Record<AgentProviderId, string>> = {
  "claude-code": "claude auth login",
  "codex-cli": "codex login",
  fake: "",
};
const DAY_MS = 86_400_000;

type AgentCheckId = Extract<DoctorCheckId, `agents.${string}` | `probe.${string}`>;

/** Builds a check with its own timer (DR20: agent checks do not go through runCheck). */
async function timedCheck(
  id: AgentCheckId,
  kind: DoctorCheck["kind"],
  timeoutMs: number,
  onTimeout: (message: string) => Outcome,
  run: () => Outcome | Promise<Outcome>,
): Promise<DoctorCheck> {
  const started = performance.now();
  let outcome: Outcome;
  try {
    const result = await withTimeout(run, timeoutMs);
    outcome = result.timedOut ? onTimeout(`timed out after ${timeoutMs} ms`) : result.value;
  } catch (error) {
    outcome = onTimeout(`check failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  return {
    id,
    kind,
    ...outcome,
    durationMs: Math.max(0, Math.round(performance.now() - started)),
  };
}

/** Basic probe (version + session, exit codes only; never reads credentials) as a WARNING-at-worst outcome. */
async function availabilityOutcome(
  provider: AgentProvider,
  services: ProviderServices,
  roles: readonly string[],
  ignoredEnv: readonly string[],
  safe: (text: string) => string,
): Promise<Outcome> {
  const probe = await provider.probe(services, "basic");
  const login = LOGIN_COMMAND[provider.id];
  const { label } = provider;
  const minimum = probe.minimum ?? provider.minimumVersion;
  switch (probe.status) {
    case "ready": {
      const ignored =
        ignoredEnv.length > 0
          ? ` · ${ignoredEnv.join(", ")} set but not passed (docs/agent-providers.md)`
          : "";
      const version = [probe.cliVersion, minimum === null ? null : `(minimum ${minimum})`]
        .filter((part) => part !== null)
        .join(" ");
      return pass(`${label} ${version}, logged in; roles: ${roles.join(", ")}${ignored}`);
    }
    case "missing":
      return warn(
        `${label} was not found on PATH`,
        `Install ${label} ${minimum ?? ""} or newer and run: ${login}`.replace("  ", " "),
      );
    case "outdated":
      return warn(
        `${label} ${probe.cliVersion ?? ""} is older than ${minimum ?? "the minimum"}`.replace(
          "  ",
          " ",
        ),
        `Update ${label} to ${minimum ?? "the latest version"} or newer.`,
      );
    case "logged-out":
      return warn(`${label} is not logged in`, `Run: ${login}`);
    case "unsupported":
    case "error":
      return warn(
        `${label}: ${safe(probe.detail)}`,
        `Update ${label} (minimum ${minimum ?? "n/a"}).`,
      );
  }
}

/** Full probe, then one schema-bound `probe` task through the provider; any failure is a FAIL dependency. */
async function deepOutcome(
  ctx: AppContext,
  provider: AgentProvider,
  services: ProviderServices,
  model: string | null,
): Promise<Outcome> {
  const safe = safeDetail(ctx);
  const probe = await provider.probe(services, "full");
  if (probe.status !== "ready") {
    return fail(`${probe.status}: ${safe(probe.detail)}`, `Run: heron doctor (without --deep).`);
  }
  const spec = AGENT_TASKS.probe;
  const built = buildContextPack({
    task: spec.id,
    budget: DEFAULT_AGENT_SETTINGS.contextBudgetChars,
    allowed: spec.allowedItems,
    items: [
      {
        kind: "task-input",
        id: "task-input",
        trust: "heron",
        priority: 0,
        content: "Reply with status ok and one facet.",
        findings: 0,
      },
    ],
  });
  if (!built.ok) return fail("probe context pack over budget");
  const request: AgentRequest = {
    task: spec.id,
    attempt: 1,
    templateId: spec.template.id,
    system: spec.template.text,
    pack: built.pack,
    outputSchema: spec.output,
    model,
    timeoutMs: ctx.agents.deepTimeoutMs,
  };
  const started = performance.now();
  const attempt = await provider.invoke(request, services);
  if (attempt.status !== "succeeded") return fail(`${attempt.status}: ${safe(attempt.detail)}`);
  const seconds = ((performance.now() - started) / 1000).toFixed(1);
  return pass(`structured output OK in ${seconds} s (model ${model ?? "default"})`);
}

/**
 * Not wrapped by runCheck (DR20): the providers assigned to a role run in parallel, each with its own timeout.
 * `agents.<id>` (basic probe, WARNING at worst), `agents.config` (WARNING when project.agents is invalid),
 * `agents.usage` (local log, WARNING over the soft budget; only when the log has calls) and, with `deep`,
 * `probe.<id>` (full probe + the `probe` task; FAIL on any non-succeeded status). Never writes and never reads credentials.
 */
export async function agentChecks(
  ctx: AppContext,
  rawSettings: unknown,
  deep: boolean,
  heronDir: string | null = null,
): Promise<DoctorCheck[]> {
  const resolved = resolveAgentSettings(rawSettings);
  const settings: AgentSettings = resolved.ok ? resolved.settings : DEFAULT_AGENT_SETTINGS;
  const roles = new Map<AgentProviderId, string[]>();
  for (const [role, id] of Object.entries(settings.roles) as [string, AgentProviderId][]) {
    roles.set(id, [...(roles.get(id) ?? []), role]);
  }
  const agentEnv = buildAgentEnv(ctx.env);
  const services: ProviderServices = {
    runner: ctx.agents.runner,
    temp: ctx.agents.temp,
    env: agentEnv.env,
    probeTimeoutMs: ctx.agents.probeTimeoutMs,
    killGraceMs: ctx.agents.killGraceMs,
  };
  const pending: Promise<DoctorCheck>[] = [];
  const done: DoctorCheck[] = [];

  if (!resolved.ok) {
    const first = resolved.issues[0];
    done.push(
      await timedCheck("agents.config", "workspace", 1_000, warn, () =>
        warn(
          `.heron/project.json "agents" is invalid (${resolved.issues.length} issue(s)): ${first?.pointer ?? ""}: ${first?.message ?? ""}`,
          'Fix the "agents" block (docs/agent-providers.md).',
        ),
      ),
    );
  }

  const now = ctx.clock.now();
  const summary = summarizeAgentUsage(
    heronDir === null
      ? []
      : readLogEvents(
          ctx.fs,
          heronDir,
          new Date(now.getTime() - (ctx.logRetentionDays - 1) * DAY_MS),
        ),
    now,
    { windowDays: ctx.logRetentionDays, softBudget: settings.warnTokensPerDay },
  );
  if (summary.window.invocations > 0) {
    const used = summary.today.inputTokens + summary.today.outputTokens;
    done.push(
      await timedCheck("agents.usage", "workspace", 1_000, warn, () =>
        summary.overBudget
          ? warn(
              `today ${used} tokens exceed the soft budget ${summary.softBudget ?? 0}`,
              "Nothing is blocked; raise agents.warnTokensPerDay or run fewer agent commands.",
            )
          : pass(
              `today ${used} tokens in ${summary.today.invocations} call(s)${summary.softBudget === null ? "" : ` (soft budget ${summary.softBudget})`}`,
            ),
      ),
    );
  }

  const basicTimeout = 2 * ctx.agents.probeTimeoutMs + 2 * ctx.agents.killGraceMs;
  for (const [id, assigned] of roles) {
    const provider = ctx.agents.providers[id];
    const agentId = `agents.${id}` as const;
    pending.push(
      timedCheck(agentId, "dependency", basicTimeout, warn, () => {
        if (id === "fake") {
          return warn("fake provider: outputs are deterministic and SYNTHETIC");
        }
        if (provider === undefined) {
          return warn(
            `${id} has no registered provider`,
            'Pick another provider in project.json "agents".',
          );
        }
        return availabilityOutcome(provider, services, assigned, agentEnv.ignored, safeDetail(ctx));
      }),
    );
    if (deep) {
      pending.push(
        timedCheck(`probe.${id}`, "dependency", ctx.agents.deepTimeoutMs, fail, () =>
          provider === undefined
            ? fail("unavailable: no provider is registered")
            : deepOutcome(ctx, provider, services, settings.models[id] ?? null),
        ),
      );
    }
  }
  const all = [...done, ...(await Promise.all(pending))];
  return all.toSorted((a, b) => DOCTOR_CHECK_IDS.indexOf(a.id) - DOCTOR_CHECK_IDS.indexOf(b.id));
}

/** The raw `agents` block and the .heron/ dir, read-only; an unreadable or absent workspace yields defaults. */
function agentWorkspace(
  ctx: AppContext,
  root: string | null,
): { rawSettings: unknown; heronDir: string | null; project: HeronProject | null } {
  if (root === null) return { rawSettings: undefined, heronDir: null, project: null };
  try {
    const store = openFileStore(ctx.fs, root, { create: false });
    const project = store.readDocument(PROJECT_FILE, HERON_PROJECT_DOCUMENT);
    return { rawSettings: project?.agents, heronDir: store.heronDir, project };
  } catch {
    return { rawSettings: undefined, heronDir: null, project: null };
  }
}

const skipped = (): Outcome => warn("Skipped: the target path is not a directory.");

/** Read-only (DP16): no lock, no writes. Exit 5 when a dependency check fails, 4 when another one does. */
export async function runDoctor(
  ctx: AppContext,
  input: DoctorInput,
): Promise<UseCaseResult<DoctorData>> {
  const root = resolveDirectory(ctx.fs, input.path);
  const specs: CheckSpec[] = [
    { id: "runtime.bun", kind: "dependency", run: () => bunCheck(ctx) },
    {
      id: "target.path",
      kind: "workspace",
      run: () =>
        root === null
          ? fail(`Path not found or not a directory: ${input.path}`, "Pass an existing directory.")
          : pass(root),
    },
    {
      id: "heron.documents",
      kind: "workspace",
      run: () => (root === null ? skipped() : documentsCheck(ctx, root, input.path)),
    },
    {
      id: "heron.lock",
      kind: "workspace",
      run: () => (root === null ? skipped() : lockCheck(ctx, root)),
    },
    {
      id: "heron.gitignore",
      kind: "workspace",
      run: () => (root === null ? skipped() : gitignoreCheck(ctx, root, input.path)),
    },
    {
      id: "harness.detection",
      kind: "workspace",
      run: () => (root === null ? skipped() : detectionCheck(ctx, root)),
    },
  ];
  const checks: DoctorCheck[] = [];
  for (const spec of specs) checks.push(await runCheck(spec, DOCTOR_CHECK_TIMEOUT_MS));
  const { rawSettings, heronDir, project } = agentWorkspace(ctx, root);
  const [agents, penpot] = await Promise.all([
    agentChecks(ctx, rawSettings, input.deep, heronDir),
    project?.penpot.enabled && project.penpot.fileId !== null
      ? penpotChecks(ctx, project)
      : Promise.resolve([]),
  ]);
  checks.push(...agents, ...penpot);
  const data: DoctorData = { checks };
  const failed = checks.filter((check) => check.status === "FAIL");
  if (failed.length === 0) return { ok: true, data, findings: [], next: [] };
  const code = failed.some((check) => check.kind === "dependency")
    ? ExitCode.DependencyUnavailable
    : ExitCode.ValidationFailed;
  return {
    ok: false,
    code,
    message: `${failed.length} check(s) failed: ${failed.map((check) => check.id).join(", ")}.`,
    findings: [],
    data,
  };
}
