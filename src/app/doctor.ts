import { join } from "node:path";
import {
  ExitCode,
  HERON_PROJECT_DOCUMENT,
  HERON_STATE_DOCUMENT,
  MODE_DECISION_DOCUMENT,
  type DoctorCheck,
  type DoctorCheckId,
  type DoctorCheckStatus,
  type DoctorData,
} from "../core/contracts/index.ts";
import { detectMode } from "../core/state/mode.ts";
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
import type { AppContext } from "./context.ts";
import { resolveDirectory, storeErrorResult, type UseCaseResult } from "./result.ts";

export const DOCTOR_CHECK_TIMEOUT_MS = 10_000;
/** Minimum Bun version Heron runs on. */
const MIN_BUN: readonly [number, number, number] = [1, 4, 2];

export type DoctorInput = { path: string };

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
