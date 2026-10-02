import {
  ExitCode,
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
  openFileStore,
} from "../core/store/file-store.ts";
import { sha256Hex } from "../core/store/hash.ts";
import { detectProject } from "../intake/detect.ts";
import { validateSelection } from "../intake/inputs.ts";
import type { AdapterSelection } from "../intake/ports.ts";
import type { AppContext } from "./context.ts";
import {
  failure,
  makeFinding,
  pathNotFound,
  resolveDirectory,
  stageErrorResult,
  storeErrorResult,
  type UseCaseResult,
} from "./result.ts";
import { selectionOf } from "./workspace.ts";
import { withWriteRun, type WriteBodyResult, type WriteRun } from "./write-run.ts";

export type InitInput = {
  path: string;
  stage: string | null;
  dryRun: boolean;
  locale: string | null;
  /** `--adapter`: null keeps the persisted selection; "auto" clears it (DR28). */
  adapter?: "auto" | "markdown" | "manual" | null;
  /** `--context` files, repo-relative; only valid with an explicit markdown/manual adapter. */
  context?: readonly string[];
};

/** Canonical BCP 47 tag (Intl.getCanonicalLocales), or null when the value is not a valid tag. */
function canonicalLocale(value: string): string | null {
  try {
    return Intl.getCanonicalLocales(value)[0] ?? null;
  } catch {
    return null;
  }
}

function buildProject(decision: ModeDecision, selection: AdapterSelection | null): HeronProject {
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
      ...(selection === null ? {} : { inputs: selection.inputs }),
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

type Chosen =
  | { ok: true; selection: AdapterSelection | null }
  | { ok: false; result: UseCaseResult<InitData> };

const usage = (message: string): Chosen => ({
  ok: false,
  result: failure(ExitCode.Usage, makeFinding("CONTEXT_INPUT_INVALID", "error", message)),
});

/**
 * The selection `init` runs with (DR28). Explicit `--adapter markdown|manual` needs >= 1 `--context` and
 * passes `validateSelection` before anything is written; the new selection REPLACES a persisted one.
 * `--adapter auto` clears it. Without `--adapter`, the persisted selection is kept as is.
 * `--context` without an explicit markdown/manual adapter is a usage error.
 */
function chooseSelection(ctx: AppContext, root: string, input: InitInput): Chosen {
  const adapter = input.adapter ?? null;
  const files = input.context ?? [];
  if (adapter === "markdown" || adapter === "manual") {
    if (files.length === 0) {
      return usage(`--adapter ${adapter} requires at least one --context <file>.`);
    }
    const checked = validateSelection(ctx.fs, root, { adapter, inputs: [...files] }, ctx.limits);
    if (checked.ok) return { ok: true, selection: checked.selection };
    return {
      ok: false,
      result: failure(
        ExitCode.Usage,
        { ...makeFinding(checked.code, "error", checked.message), issues: checked.issues },
        checked.message,
      ),
    };
  }
  if (files.length > 0) {
    return usage("--context requires --adapter markdown or --adapter manual.");
  }
  if (adapter === "auto") return { ok: true, selection: null };
  try {
    const project = openFileStore(ctx.fs, root, { create: false }).readDocument(
      PROJECT_FILE,
      HERON_PROJECT_DOCUMENT,
    );
    return { ok: true, selection: project === null ? null : selectionOf(project) };
  } catch (error) {
    const mapped = storeErrorResult<InitData>(error);
    if (mapped === null) throw error;
    return { ok: false, result: mapped };
  }
}

/** detect -> decide -> (without dryRun) withWriteRun: lock -> recover staging -> transaction -> release. */
export async function runInit(ctx: AppContext, input: InitInput): Promise<UseCaseResult<InitData>> {
  let locale: string | null = null;
  if (input.locale !== null) {
    locale = canonicalLocale(input.locale);
    if (locale === null) {
      return failure(
        ExitCode.Usage,
        makeFinding(
          "LOCALE_INVALID",
          "error",
          `Invalid locale "${input.locale}": expected a BCP 47 tag such as es or en-US.`,
        ),
      );
    }
  }
  const root = resolveDirectory(ctx.fs, input.path);
  if (root === null) return pathNotFound(input.path);

  const chosen = chooseSelection(ctx, root, input);
  if (!chosen.ok) return chosen.result;
  const { selection } = chosen;

  const detection = detectProject({
    root,
    stage: input.stage,
    selection,
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
    (run) => writeInit(run, decision, findings, next, locale, selection),
  );
}

function writeInit(
  { store, tx, previous, meta }: WriteRun,
  decision: ModeDecision,
  findings: Finding[],
  next: string[],
  locale: string | null,
  selection: AdapterSelection | null,
): WriteBodyResult<InitData> {
  // DR17: everything in project.json except `source` survives; --locale replaces product.locale.
  const existing = store.readDocument(PROJECT_FILE, HERON_PROJECT_DOCUMENT);
  const fresh = buildProject(decision, selection);
  const product = locale === null ? existing?.product : { locale };
  const project: HeronProject = {
    ...(existing ?? fresh),
    source: fresh.source,
    ...(product === undefined ? {} : { product }),
  };
  const documents: { path: string; text: string }[] = [
    { path: MODE_FILE, text: render(MODE_DECISION_DOCUMENT, MODE_FILE, decision) },
    {
      path: PROJECT_FILE,
      text: render(HERON_PROJECT_DOCUMENT, PROJECT_FILE, project),
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
