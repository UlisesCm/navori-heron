import { join } from "node:path";
import {
  ExitCode,
  HERON_PROJECT_DOCUMENT,
  HERON_STATE_DOCUMENT,
  MODE_DECISION_DOCUMENT,
  InvalidDocumentError,
  type BoundArtifact,
  type Finding,
  type GateData,
  type GateName,
  type HeronMode,
  type HeronState,
  type ModeDecision,
  type RelativeArtifactPath,
  type Sha256Hex,
} from "../core/contracts/index.ts";
import {
  GATE_BINDINGS,
  approveGate,
  invalidatedGates,
  isApprovalValid,
  latestDecision,
  rejectGate,
  type GateOutcome,
} from "../core/state/gates.ts";
import { detectMode } from "../core/state/mode.ts";
import { compareStrings } from "../core/state/stale.ts";
import {
  canTransition,
  type TransitionFacts,
  type TransitionMeta,
} from "../core/state/transitions.ts";
import {
  MODE_FILE,
  PROJECT_FILE,
  STATE_FILE,
  openFileStore,
  type FileStore,
} from "../core/store/file-store.ts";
import type { ReadonlyFs } from "../core/store/fs-port.ts";
import { acquireLock } from "../core/store/lock.ts";
import { detectProject } from "../intake/detect.ts";
import type { AppContext } from "./context.ts";
import {
  failure,
  makeFinding,
  pathNotFound,
  rejectionToFinding,
  resolveDirectory,
  stageErrorResult,
  storeErrorResult,
  type UseCaseResult,
} from "./result.ts";

export type GateInput = {
  path: string;
  gate: GateName;
  decision: "approve" | "reject";
  note: string | null;
  reason: string | null;
  yes: boolean;
};

const GLOB_SUFFIX = "/**";

/** Files under `dir` (relative to .heron/), recursively; symlinks are never followed. */
function listFiles(fs: ReadonlyFs, heronDir: string, dir: string): string[] {
  const out: string[] = [];
  let entries: string[];
  try {
    entries = fs.readdirSync(join(heronDir, dir));
  } catch {
    return out;
  }
  for (const entry of entries) {
    const relative = `${dir}/${entry}`;
    const stat = fs.lstatSync(join(heronDir, relative));
    if (stat.isSymbolicLink()) continue;
    if (stat.isDirectory()) out.push(...listFiles(fs, heronDir, relative));
    else if (stat.isFile()) out.push(relative);
  }
  return out;
}

/** Existing files matching GATE_BINDINGS[gate] (exact paths or `dir/**`), hashed, sorted by path. */
export function boundArtifacts(fs: ReadonlyFs, store: FileStore, gate: GateName): BoundArtifact[] {
  const paths = new Set<string>();
  for (const pattern of GATE_BINDINGS[gate]) {
    if (pattern.endsWith(GLOB_SUFFIX)) {
      const dir = pattern.slice(0, -GLOB_SUFFIX.length);
      for (const file of listFiles(fs, store.heronDir, dir)) paths.add(file);
    } else {
      paths.add(pattern);
    }
  }
  const artifacts: BoundArtifact[] = [];
  for (const path of [...paths].toSorted(compareStrings)) {
    const sha256 = store.sha256(path);
    if (sha256 !== null) artifacts.push({ path, sha256 });
  }
  return artifacts;
}

/** P1 fills invalidatedGates and intakeApprovalValid (isApprovalValid over the store) and, when gate != null,
 * boundArtifactCount; every other fact stays absent so its precondition fails closed. */
export function collectTransitionFacts(
  store: FileStore,
  state: HeronState,
  gate: GateName | null,
  fs: ReadonlyFs,
): TransitionFacts {
  const current = new Map<RelativeArtifactPath, Sha256Hex>();
  for (const decision of state.gates) {
    for (const artifact of decision.artifacts) {
      const sha = store.sha256(artifact.path);
      if (sha !== null) current.set(artifact.path, sha);
    }
  }
  const intake = latestDecision(state, "intake");
  const facts: TransitionFacts = {
    invalidatedGates: invalidatedGates(state, current),
    intakeApprovalValid: intake?.decision === "approved" && isApprovalValid(intake, current).valid,
  };
  if (gate !== null) facts.boundArtifactCount = boundArtifacts(fs, store, gate).length;
  return facts;
}

const effectiveMode = (mode: HeronMode, other: HeronMode): HeronMode =>
  mode === "full" && other === "full" ? "full" : "reference-only";

function outcomeFailure(
  outcome: Extract<GateOutcome, { ok: false }>,
  blocked: ModeDecision,
): UseCaseResult<GateData> {
  switch (outcome.code) {
    case "IDENTITY_REQUIRED":
    case "REASON_REQUIRED":
      return failure(ExitCode.Usage, makeFinding(outcome.code, "error", outcome.reason));
    case "NO_BOUND_ARTIFACTS":
      return failure(ExitCode.Blocked, makeFinding("PRECONDITION_UNMET", "error", outcome.reason));
    default:
      return failure(ExitCode.Blocked, rejectionToFinding(outcome, blocked));
  }
}

/** Order (design.md): state readable -> lock -> effective mode -> canTransition -> confirmation -> decision ->
 * commit (state.json only) -> release. */
export async function runGate(ctx: AppContext, input: GateInput): Promise<UseCaseResult<GateData>> {
  const root = resolveDirectory(ctx.fs, input.path);
  if (root === null) return pathNotFound(input.path);
  try {
    return await decide(ctx, root, input);
  } catch (error) {
    const mapped = storeErrorResult<GateData>(error);
    if (mapped === null) throw error;
    return mapped;
  }
}

async function decide(
  ctx: AppContext,
  root: string,
  input: GateInput,
): Promise<UseCaseResult<GateData>> {
  const store = openFileStore(ctx.fs, root, { create: false });
  const notInitialized = (): UseCaseResult<GateData> =>
    failure(
      ExitCode.Blocked,
      makeFinding(
        "NOT_INITIALIZED",
        "error",
        `.heron/state.json not found. Run: heron init ${input.path}`,
      ),
    );
  if (store.readDocument(STATE_FILE, HERON_STATE_DOCUMENT) === null) return notInitialized();

  const now = ctx.clock.now();
  const runId = ctx.ids.runId(now);
  const acquired = acquireLock(
    ctx.fs,
    store.heronDir,
    {
      runId,
      pid: ctx.process.pid,
      hostname: ctx.process.hostname,
      command: "gate",
      acquiredAt: now.toISOString(),
    },
    { ...ctx.lock, hostname: ctx.process.hostname, now: () => Date.now() },
  );
  try {
    const stored = store.readDocument(STATE_FILE, HERON_STATE_DOCUMENT);
    if (stored === null) return notInitialized();
    const result = await decideLocked(ctx, root, store, stored, input, { runId, now });
    if (acquired.reclaimed !== null && result.ok) {
      const { pid, hostname, runId: staleRun } = acquired.reclaimed;
      result.findings.push(
        makeFinding(
          "LOCK_RECLAIMED",
          "warning",
          `Reclaimed a stale lock from pid ${pid} on ${hostname} (run ${staleRun}).`,
        ),
      );
    }
    return result;
  } finally {
    acquired.handle.release();
  }
}

async function decideLocked(
  ctx: AppContext,
  root: string,
  store: FileStore,
  stored: HeronState,
  input: GateInput,
  run: { runId: TransitionMeta["runId"]; now: Date },
): Promise<UseCaseResult<GateData>> {
  const project = store.readDocument(PROJECT_FILE, HERON_PROJECT_DOCUMENT);
  const persisted = store.readDocument(MODE_FILE, MODE_DECISION_DOCUMENT);
  if (project === null) {
    throw new InvalidDocumentError(PROJECT_FILE, HERON_PROJECT_DOCUMENT.kind, [
      { pointer: "", message: "file is missing" },
    ]);
  }
  if (persisted === null) {
    throw new InvalidDocumentError(MODE_FILE, MODE_DECISION_DOCUMENT.kind, [
      { pointer: "", message: "file is missing" },
    ]);
  }
  const detection = detectProject({
    root,
    stage: project.source.stage?.dir ?? null,
    fs: ctx.fs,
    limits: ctx.limits,
  });
  if (detection.kind === "stage-error") return stageErrorResult(detection);
  const live = detectMode(detection.report);
  const blocked = live.mode === "reference-only" ? live : persisted;
  // The effective mode is recomputed from the live detection (RN-29); the persisted one is kept on disk.
  const state: HeronState = { ...stored, mode: effectiveMode(stored.mode, live.mode) };

  const facts = collectTransitionFacts(store, state, input.gate, ctx.fs);
  const event = {
    type: input.decision === "approve" ? "approve-gate" : "reject-gate",
    gate: input.gate,
  } as const;
  const checked = canTransition(state, event, facts);
  if (!checked.ok) return failure(ExitCode.Blocked, rejectionToFinding(checked, blocked));

  const decidedBy = ctx.identity.current()?.trim() ?? "";
  if (decidedBy === "") {
    return failure(
      ExitCode.Usage,
      makeFinding(
        "IDENTITY_REQUIRED",
        "error",
        "Cannot determine who is deciding the gate (OS user is empty).",
      ),
    );
  }
  const reason = input.reason?.trim() ?? "";
  if (input.decision === "reject" && reason === "") {
    return failure(
      ExitCode.Usage,
      makeFinding(
        "REASON_REQUIRED",
        "error",
        `heron gate ${input.gate} reject requires --reason <text>.`,
      ),
    );
  }
  const artifacts = boundArtifacts(ctx.fs, store, input.gate);
  if (!input.yes) {
    if (!ctx.isTTY) {
      return failure(
        ExitCode.Usage,
        makeFinding(
          "CONFIRMATION_REQUIRED",
          "error",
          "Gate decisions need an interactive terminal or --yes.",
        ),
      );
    }
    const verb = input.decision === "approve" ? "Approve" : "Reject";
    const confirmed = await ctx.confirm(
      `${verb} gate "${input.gate}" bound to ${artifacts.length} artifact(s)? [y/N] `,
    );
    if (!confirmed) {
      return failure(
        ExitCode.Usage,
        makeFinding(
          "CONFIRMATION_REQUIRED",
          "error",
          "Gate decision cancelled; nothing was written.",
        ),
      );
    }
  }

  const meta: TransitionMeta = {
    runId: run.runId,
    at: run.now.toISOString(),
    command: "gate",
    heronVersion: ctx.heronVersion,
  };
  const outcome =
    input.decision === "approve"
      ? approveGate(
          state,
          { gate: input.gate, decidedBy, note: input.note, artifacts, meta },
          facts,
        )
      : rejectGate(state, { gate: input.gate, decidedBy, reason, artifacts, meta }, facts);
  if (!outcome.ok) return outcomeFailure(outcome, blocked);

  const next: HeronState = { ...outcome.state, mode: stored.mode };
  const tx = store.begin(run.runId);
  let revision: number;
  try {
    revision = tx.commit(next, stored.stateRevision).stateRevision;
  } catch (error) {
    tx.abort();
    throw error;
  }
  const data: GateData = {
    gate: input.gate,
    decision: input.decision === "approve" ? "approved" : "rejected",
    from: stored.phase,
    to: next.phase,
    stateRevision: revision,
    artifacts: outcome.decision.artifacts,
  };
  const findings: Finding[] = [];
  return { ok: true, data, findings, next: [`heron status ${input.path}`] };
}
