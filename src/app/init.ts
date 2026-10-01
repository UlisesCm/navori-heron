import {
  HERON_PROJECT_DOCUMENT,
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
import {
  GITIGNORE_FILE,
  HERON_GITIGNORE,
  MODE_FILE,
  PROJECT_FILE,
} from "../core/store/file-store.ts";
import { sha256Hex } from "../core/store/hash.ts";
import { detectProject } from "../intake/detect.ts";
import type { AppContext } from "./context.ts";
import {
  makeFinding,
  pathNotFound,
  resolveDirectory,
  stageErrorResult,
  type UseCaseResult,
} from "./result.ts";
import { withWriteRun, type WriteBodyResult, type WriteRun } from "./write-run.ts";

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

/** detect -> decide -> (without dryRun) withWriteRun: lock -> recover staging -> transaction -> release. */
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

  return withWriteRun(
    ctx,
    root,
    {
      path: input.path,
      command: "init",
      create: true,
      requireState: false,
      expectedRevision: null,
    },
    (run) => writeInit(run, decision, findings, next),
  );
}

function writeInit(
  { store, tx, previous, meta }: WriteRun,
  decision: ModeDecision,
  findings: Finding[],
  next: string[],
): WriteBodyResult<InitData> {
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
    return { kind: "skip", result: { ok: true, data, findings, next } };
  }

  tx.put(GITIGNORE_FILE, HERON_GITIGNORE);
  for (const doc of documents) tx.put(doc.path, doc.text);
  const artifacts: BoundArtifact[] = documents.map((doc) => ({
    path: doc.path,
    sha256: hashes.get(doc.path) ?? "",
  }));
  const state: HeronState =
    previous === null
      ? createInitialState({ mode: decision.mode, artifacts, meta })
      : recordInit(previous, { mode: decision.mode, artifacts, meta });
  const data: InitData = {
    decision,
    dryRun: false,
    written: true,
    stateRevision: state.stateRevision,
  };
  return { kind: "commit", state, data, findings, next };
}

/** Canonical JSON of a validated document (the exact bytes the store writes). */
function render<T>(spec: DocumentSpec<T>, path: string, value: T): string {
  return canonicalJson(parseVersionedDocument(value, spec, path));
}

function sameText(bytes: Uint8Array | null, text: string): boolean {
  return bytes !== null && new TextDecoder().decode(bytes) === text;
}
