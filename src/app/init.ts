import {
  HERON_PROJECT_DOCUMENT,
  HERON_STATE_DOCUMENT,
  MODE_DECISION_DOCUMENT,
  canonicalJson,
  parseVersionedDocument,
  type DocumentSpec,
  type BoundArtifact,
  type Finding,
  type HeronProject,
  type HeronState,
  type InitData,
  type ModeDecision,
} from "../core/contracts/index.ts";
import { createInitialState, recordInit } from "../core/state/lifecycle.ts";
import { detectMode } from "../core/state/mode.ts";
import type { TransitionMeta } from "../core/state/transitions.ts";
import {
  GITIGNORE_FILE,
  HERON_GITIGNORE,
  MODE_FILE,
  PROJECT_FILE,
  STATE_FILE,
  openFileStore,
} from "../core/store/file-store.ts";
import { sha256Hex } from "../core/store/hash.ts";
import { acquireLock } from "../core/store/lock.ts";
import { detectProject } from "../intake/detect.ts";
import type { AppContext } from "./context.ts";
import {
  makeFinding,
  pathNotFound,
  resolveDirectory,
  stageErrorResult,
  storeErrorResult,
  type UseCaseResult,
} from "./result.ts";

export type InitInput = { path: string; stage: string | null; dryRun: boolean };

function buildProject(decision: ModeDecision): HeronProject {
  const { detection } = decision;
  return {
    kind: "HeronProject",
    schemaVersion: 1,
    source: {
      adapter: detection.adapter,
      specsDir: detection.specsDir,
      stage:
        detection.stage === null
          ? null
          : { dir: detection.stage.dir, selection: detection.stage.selection },
    },
    penpot: { enabled: false, url: null, fileId: null, version: null },
  };
}

/** Findings shown in data.decision plus the ones only the envelope carries. */
function collectFindings(decision: ModeDecision): Finding[] {
  const { detection } = decision;
  const findings = [...detection.findings, ...decision.findings];
  if (detection.stageNotice !== null) {
    findings.push(
      makeFinding(
        "STAGE_FALLBACK_LAST_CLOSED",
        "info",
        detection.stageNotice,
        detection.specsDir === null ? [] : [`${detection.specsDir}/_master/index.json`],
      ),
    );
  }
  return findings;
}

/** detect -> decide -> (without dryRun) lock -> recover staging -> transaction -> release. */
export async function runInit(ctx: AppContext, input: InitInput): Promise<UseCaseResult<InitData>> {
  const root = resolveDirectory(ctx.fs, input.path);
  if (root === null) return pathNotFound(input.path);

  const detection = detectProject({
    root,
    stage: input.stage,
    fs: ctx.fs,
    limits: ctx.limits,
  });
  if (detection.kind === "stage-error") return stageErrorResult(detection);
  const decision = detectMode(detection.report);
  const findings = collectFindings(decision);
  const next = [`heron status ${input.path}`];

  if (input.dryRun) {
    const data: InitData = { decision, dryRun: true, written: false, stateRevision: null };
    return { ok: true, data, findings, next };
  }

  try {
    return commitInit(ctx, root, decision, findings, next);
  } catch (error) {
    const mapped = storeErrorResult<InitData>(error);
    if (mapped === null) throw error;
    return mapped;
  }
}

function commitInit(
  ctx: AppContext,
  root: string,
  decision: ModeDecision,
  findings: Finding[],
  next: string[],
): UseCaseResult<InitData> {
  const now = ctx.clock.now();
  const runId = ctx.ids.runId(now);
  const store = openFileStore(ctx.fs, root, { create: true });
  const acquired = acquireLock(
    ctx.fs,
    store.heronDir,
    {
      runId,
      pid: ctx.process.pid,
      hostname: ctx.process.hostname,
      command: "init",
      acquiredAt: now.toISOString(),
    },
    { ...ctx.lock, hostname: ctx.process.hostname, now: () => Date.now() },
  );
  const all = [...findings];
  if (acquired.reclaimed !== null) {
    const { pid, hostname, runId: staleRun } = acquired.reclaimed;
    all.push(
      makeFinding(
        "LOCK_RECLAIMED",
        "warning",
        `Reclaimed a stale lock from pid ${pid} on ${hostname} (run ${staleRun}).`,
      ),
    );
  }
  try {
    const recovered = store.recoverOrphanStaging(runId);
    if (recovered.length > 0) {
      all.push(
        makeFinding(
          "STAGING_RECOVERED",
          "info",
          `Removed orphan staging from interrupted run(s): ${recovered.join(", ")}.`,
        ),
      );
    }
    const previous = store.readDocument(STATE_FILE, HERON_STATE_DOCUMENT);

    const documents: { path: string; text: string }[] = [
      { path: MODE_FILE, text: render(MODE_DECISION_DOCUMENT, MODE_FILE, decision) },
      {
        path: PROJECT_FILE,
        text: render(HERON_PROJECT_DOCUMENT, PROJECT_FILE, buildProject(decision)),
      },
    ];
    const hashes = new Map(
      documents.map((doc) => [doc.path, sha256Hex(new TextEncoder().encode(doc.text))]),
    );
    const unchanged =
      previous !== null &&
      previous.mode === decision.mode &&
      documents.every((doc) => store.sha256(doc.path) === hashes.get(doc.path)) &&
      sameText(store.readBytes(GITIGNORE_FILE), HERON_GITIGNORE);
    if (unchanged) {
      const data: InitData = {
        decision,
        dryRun: false,
        written: false,
        stateRevision: previous.stateRevision,
      };
      return { ok: true, data, findings: all, next };
    }

    const tx = store.begin(runId);
    try {
      tx.put(GITIGNORE_FILE, HERON_GITIGNORE);
      for (const doc of documents) tx.put(doc.path, doc.text);
      const artifacts: BoundArtifact[] = documents.map((doc) => ({
        path: doc.path,
        sha256: hashes.get(doc.path) ?? "",
      }));
      const meta: TransitionMeta = {
        runId,
        at: now.toISOString(),
        command: "init",
        heronVersion: ctx.heronVersion,
      };
      const state: HeronState =
        previous === null
          ? createInitialState({ mode: decision.mode, artifacts, meta })
          : recordInit(previous, { mode: decision.mode, artifacts, meta });
      const result = tx.commit(state, previous?.stateRevision ?? 0);
      const data: InitData = {
        decision,
        dryRun: false,
        written: true,
        stateRevision: result.stateRevision,
      };
      return { ok: true, data, findings: all, next };
    } catch (error) {
      tx.abort();
      throw error;
    }
  } finally {
    acquired.handle.release();
  }
}

/** Canonical JSON of a validated document (the exact bytes the store writes). */
function render<T>(spec: DocumentSpec<T>, path: string, value: T): string {
  return canonicalJson(parseVersionedDocument(value, spec, path));
}

function sameText(bytes: Uint8Array | null, text: string): boolean {
  return bytes !== null && new TextDecoder().decode(bytes) === text;
}
