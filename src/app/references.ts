import { dirname, relative, resolve, sep } from "node:path";
import {
  ExitCode,
  InvalidDocumentError,
  REFERENCE_BATCH_DOCUMENT,
  UnsupportedSchemaVersionError,
  parseVersionedDocument,
  type BoundArtifact,
  type FindingCode,
  type FindingIssue,
  type ReferenceBatch,
  type ReferenceId,
  type ReferenceInput,
  type ReferencesAddData,
  type ReferencesCompareData,
  type ReferencesImportData,
  type ReferencesListData,
  type ReferencesRemoveData,
  type ReferencesShowData,
  type RelativeArtifactPath,
  type ResearchReference,
  type ResearchSourceKind,
} from "../core/contracts/index.ts";
import { recordCommand, withArtifacts } from "../core/state/lifecycle.ts";
import { applyTransition, canTransition } from "../core/state/transitions.ts";
import { sharedValues } from "../research/compare.ts";
import { displayPath, readInputFile } from "../research/input-file.ts";
import {
  type CaptureFailure,
  type CaptureFailureCode,
  type CaptureInput,
  type Captured,
} from "../research/ports.ts";
import {
  byIdNumber,
  nextReferenceId,
  validateCrops,
  validateReferenceInput,
  type ValidReferenceInput,
} from "../research/provenance.ts";
import { availableSourceKinds, sourceFor } from "../research/registry.ts";
import type { AppContext } from "./context.ts";
import {
  readResearch,
  researchCounts,
  stageResearchOutputs,
  type ResearchSnapshot,
} from "./research-store.ts";
import {
  failure,
  makeFinding,
  rejectionToFinding,
  storeErrorResult,
  type UseCaseResult,
} from "./result.ts";
import { loadWorkspace, type Workspace } from "./workspace.ts";
import { withWriteRun, type WriteBodyResult, type WriteRun } from "./write-run.ts";

export type ReferencesAddInput = { path: string; reference: ReferenceInput };
export type ReferencesImportInput = { path: string; file: string; allowLocal: boolean };
export type ReferencesListInput = { path: string; includeRemoved: boolean };
export type ReferencesShowInput = { path: string; id: string };
export type ReferencesCompareInput = { path: string; ids: string[] };
export type ReferencesRemoveInput = { path: string; id: string; reason: string | null };

const REFERENCES_FILE = ".heron/research/references.json";
const RESEARCH_REASON = "An upstream research artifact changed.";

type Loaded =
  | { ok: true; ws: Workspace; research: ResearchSnapshot }
  | { ok: false; result: UseCaseResult<never> };

/** Snapshot R (no lock): workspace + research documents; store and document errors become results. */
function load(ctx: AppContext, path: string): Loaded {
  try {
    const loaded = loadWorkspace(ctx, path);
    if (!loaded.ok) return loaded;
    const { workspace } = loaded;
    return { ok: true, ws: workspace, research: readResearch(workspace.store) };
  } catch (error) {
    const mapped = storeErrorResult<never>(error);
    if (mapped === null) throw error;
    return { ok: false, result: mapped };
  }
}

function withIssues<T>(
  exit: Exclude<ExitCode, 0>,
  code: FindingCode,
  message: string,
  issues: FindingIssue[],
): UseCaseResult<T> {
  return failure(exit, { ...makeFinding(code, "error", message), issues });
}

const CAPTURE_EXIT: Readonly<Record<CaptureFailureCode, Exclude<ExitCode, 0>>> = {
  INVALID_URL: ExitCode.Usage,
  SSRF_BLOCKED: ExitCode.Blocked,
  FETCH_FAILED: ExitCode.DependencyUnavailable,
  UNSUPPORTED_MEDIA_TYPE: ExitCode.Usage,
  INPUT_TOO_LARGE: ExitCode.Usage,
  UNSAFE_PATH: ExitCode.Blocked,
  PATH_NOT_FOUND: ExitCode.Usage,
  IMAGE_UNREADABLE: ExitCode.Usage,
  IMAGE_ENGINE_UNAVAILABLE: ExitCode.DependencyUnavailable,
};

function captureFailureResult<T>(found: CaptureFailure): UseCaseResult<T> {
  return failure(
    CAPTURE_EXIT[found.code],
    makeFinding(found.code, "error", found.message, found.paths),
  );
}

function notFound<T>(id: string): UseCaseResult<T> {
  return failure(
    ExitCode.Usage,
    makeFinding("REFERENCE_NOT_FOUND", "error", `Reference ${id} not found in ${REFERENCES_FILE}.`),
  );
}

/** The `reference-added` row must exist from the phase (exit 3, before any network). */
function checkAddable<T>(ws: Workspace): UseCaseResult<T> | null {
  const checked = canTransition(ws.state, { type: "reference-added" }, { referenceComplete: true });
  return checked.ok ? null : failure(ExitCode.Blocked, rejectionToFinding(checked, ws.blocked));
}

function captureInput(
  capture: ValidReferenceInput["capture"],
  file: { base: string; allowExternal: boolean },
): CaptureInput | null {
  switch (capture.kind) {
    case "manual":
      return { kind: "manual" };
    case "url":
      return { kind: "url", url: capture.url, allowLocal: capture.allowLocal };
    case "image":
      return { kind: "image", method: capture.method, file: { path: capture.file, ...file } };
    case "design-md":
      return {
        kind: "design-md",
        from:
          "file" in capture
            ? { file: { path: capture.file, ...file } }
            : { url: capture.url, allowLocal: capture.allowLocal },
      };
    default:
      return null;
  }
}

type Prepared = { valid: ValidReferenceInput; captured: Captured };

/** Captures outside the lock; sources never write. ADAPTER_NOT_AVAILABLE for penpot and refero (exit 5). */
async function captureReference(
  ctx: AppContext,
  root: string,
  valid: ValidReferenceInput,
  file: { base: string; allowExternal: boolean },
): Promise<{ ok: true; value: Prepared } | { ok: false; result: UseCaseResult<never> }> {
  const source = sourceFor(valid.source);
  const input = captureInput(valid.capture, file);
  if (source === null || input === null) {
    return {
      ok: false,
      result: failure(
        ExitCode.DependencyUnavailable,
        makeFinding(
          "ADAPTER_NOT_AVAILABLE",
          "error",
          `Reference source "${valid.source}" is not available in this version of Heron.`,
        ),
      ),
    };
  }
  const result = await source.capture({
    input,
    services: { fetcher: ctx.fetcher, images: ctx.images, fs: ctx.fs, root },
    limits: ctx.research,
  });
  if (!result.ok) return { ok: false, result: captureFailureResult(result.failure) };
  const { capture } = result.captured;
  if (capture.kind === "image") {
    const crops = validateCrops(valid.crops, capture.image.width, capture.image.height);
    if (!crops.ok) {
      return {
        ok: false,
        result: withIssues(ExitCode.Usage, "CROP_INVALID", crops.message, crops.issues),
      };
    }
  }
  return { ok: true, value: { valid, captured: result.captured } };
}

function buildReference(
  id: ReferenceId,
  { valid, captured }: Prepared,
  run: WriteRun,
  ws: Workspace,
): ResearchReference {
  const { capture } = captured;
  const fetched = "fetch" in capture ? capture.fetch : null;
  return {
    id,
    source: valid.source,
    origin: valid.origin ?? fetched?.requestedUrl ?? "",
    capturedAt: run.meta.at,
    mode: ws.mode,
    reason: valid.reason,
    studies: valid.studies,
    doNotCopy: valid.doNotCopy,
    influences: valid.influences,
    capture,
    crops: valid.crops,
    securityFindings: captured.securityFindings,
    removed: null,
  };
}

/** Under the lock: ids, files, outputs and one `reference-added` transition for every prepared capture. */
function commitAdditions<T extends ReferencesAddData>(
  ctx: AppContext,
  run: WriteRun,
  ws: Workspace,
  prepared: readonly Prepared[],
  decorate: (data: ReferencesAddData) => T,
): WriteBodyResult<T> {
  const { store, tx, previous, meta } = run;
  if (previous === null) throw new Error("withWriteRun requireState guarantees state.json");
  const research = readResearch(store);
  const existing = research.references?.references ?? [];
  const brand = research.brand?.inputs ?? [];
  const added: ResearchReference[] = [];
  const bound = new Map<RelativeArtifactPath, BoundArtifact>();
  const written: RelativeArtifactPath[] = [];
  for (const item of prepared) {
    added.push(buildReference(nextReferenceId([...existing, ...added]), item, run, ws));
    for (const file of item.captured.files) {
      if (bound.has(file.path)) continue;
      bound.set(file.path, { path: file.path, sha256: file.sha256 });
      if (store.sha256(file.path) !== file.sha256) {
        tx.put(file.path, file.bytes);
        written.push(file.path);
      }
    }
  }
  const all = [...existing, ...added];
  const staged = stageResearchOutputs(tx, store, {
    references: all,
    brand,
    currentMode: ws.mode,
    locale: ws.project.product?.locale ?? null,
    minimum: ctx.research.minReferences,
  });
  for (const output of staged.outputs) if (output.written) written.push(output.path);
  const outcome = applyTransition(
    previous,
    { type: "reference-added" },
    { referenceComplete: true },
    meta,
  );
  if (!outcome.ok) {
    return {
      kind: "skip",
      result: failure(ExitCode.Blocked, rejectionToFinding(outcome, ws.blocked)),
    };
  }
  const state = withArtifacts(
    outcome.state,
    [...bound.values(), ...staged.artifacts],
    RESEARCH_REASON,
  );
  const counts = researchCounts(all, brand, ctx.research.minReferences);
  const data = decorate({
    references: added,
    phase: { from: previous.phase, to: state.phase },
    stateRevision: state.stateRevision,
    counts,
    written: written.toSorted(),
  });
  const next = [`heron status ${ws.root}`];
  if (counts.withProvenance >= counts.minimum)
    next.unshift(`heron gate research approve ${ws.root}`);
  return { kind: "commit", state, data, findings: [], next };
}

/** validate (exit 2) -> loadWorkspace (snapshot R) -> canTransition(reference-added) (exit 3, before any network) ->
 * sourceFor (exit 5) -> capture outside the lock -> validateCrops (exit 2) -> withWriteRun(expectedRevision R): id, record,
 * tx.put new assets/sources (skipped when store.sha256(path) already matches), stageResearchOutputs, applyTransition +
 * withArtifacts -> commit. */
export async function runReferencesAdd(
  ctx: AppContext,
  input: ReferencesAddInput,
): Promise<UseCaseResult<ReferencesAddData>> {
  const valid = validateReferenceInput(input.reference, "");
  if (!valid.ok) return withIssues(ExitCode.Usage, valid.code, valid.message, valid.issues);
  const loaded = load(ctx, input.path);
  if (!loaded.ok) return loaded.result;
  const { ws } = loaded;
  const blocked = checkAddable<ReferencesAddData>(ws);
  if (blocked !== null) return blocked;
  const prepared = await captureReference(ctx, ws.root, valid.value, {
    base: ctx.cwd,
    allowExternal: true,
  });
  if (!prepared.ok) return prepared.result;
  return withWriteRun(
    ctx,
    ws.root,
    {
      path: input.path,
      command: "references add",
      create: false,
      requireState: true,
      expectedRevision: ws.state.stateRevision,
    },
    (run) => commitAdditions(ctx, run, ws, [prepared.value], (data) => data),
  );
}

function batchInvalid<T>(file: string, issues: FindingIssue[]): UseCaseResult<T> {
  return withIssues(
    ExitCode.Usage,
    "BATCH_INVALID",
    `${file} is not a valid ReferenceBatch (${issues.length} issue(s)); nothing was written.`,
    issues,
  );
}

/** UTF-8 -> JSON -> size limit -> parseVersionedDocument(REFERENCE_BATCH_DOCUMENT); every failure is BATCH_INVALID. */
function parseBatch(
  bytes: Uint8Array,
  file: string,
  max: number,
): { ok: true; batch: ReferenceBatch } | { ok: false; result: UseCaseResult<never> } {
  const issue = (pointer: string, message: string) => ({
    ok: false as const,
    result: batchInvalid<never>(file, [{ pointer, message }]),
  });
  let raw: unknown;
  try {
    raw = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch (error) {
    return issue("", error instanceof TypeError ? "not valid UTF-8 text" : "not valid JSON");
  }
  const list = typeof raw === "object" && raw !== null ? Reflect.get(raw, "references") : undefined;
  if (Array.isArray(list) && list.length > max) {
    return {
      ok: false,
      result: failure(
        ExitCode.Usage,
        makeFinding(
          "BATCH_INVALID",
          "error",
          `${file} has ${list.length} references; the limit is ${max}.`,
        ),
      ),
    };
  }
  try {
    const batch = parseVersionedDocument(raw, REFERENCE_BATCH_DOCUMENT, file);
    return batch.references.length === 0
      ? issue("/references", "at least one reference is required")
      : { ok: true, batch };
  } catch (error) {
    if (error instanceof InvalidDocumentError) {
      return { ok: false, result: batchInvalid<never>(file, error.issues) };
    }
    if (error instanceof UnsupportedSchemaVersionError)
      return issue("/schemaVersion", error.message);
    throw error;
  }
}

/** readInputFile(batch, maxBatchBytes) -> UTF-8 + JSON + parseVersionedDocument(REFERENCE_BATCH_DOCUMENT) (BATCH_INVALID) ->
 * validate every item (PROVENANCE_INCOMPLETE / REFERENCE_INPUT_INVALID with /references/{i}/{field} pointers) -> capture in
 * order (first failure stops, nothing written) -> one withWriteRun, one reference-added transition, one history entry. */
export async function runReferencesImport(
  ctx: AppContext,
  input: ReferencesImportInput,
): Promise<UseCaseResult<ReferencesImportData>> {
  const loaded = load(ctx, input.path);
  if (!loaded.ok) return loaded.result;
  const { ws } = loaded;
  const blocked = checkAddable<ReferencesImportData>(ws);
  if (blocked !== null) return blocked;
  const file = displayPath(input.file);
  const read = readInputFile({
    fs: ctx.fs,
    root: ws.root,
    file: { path: input.file, base: ctx.cwd, allowExternal: false },
    maxBytes: ctx.research.maxBatchBytes,
    externalExtensions: null,
  });
  if (!read.ok) return captureFailureResult(read.failure);
  const parsed = parseBatch(read.bytes, file, ctx.research.maxBatchReferences);
  if (!parsed.ok) return parsed.result;

  const items: ValidReferenceInput[] = [];
  for (const [index, item] of parsed.batch.references.entries()) {
    const url = item.url ?? null;
    const valid = validateReferenceInput(
      {
        source: item.source ?? null,
        origin: item.origin ?? null,
        reason: item.reason ?? null,
        studies: item.studies ?? [],
        doNotCopy: item.doNotCopy ?? [],
        influences: item.influences ?? [],
        file: item.file ?? null,
        url,
        screenshot: item.screenshot ?? false,
        allowLocal: input.allowLocal && url !== null && url.trim() !== "",
        crops: item.crops ?? [],
      },
      `/references/${index}`,
    );
    if (!valid.ok) return withIssues(ExitCode.Usage, valid.code, valid.message, valid.issues);
    items.push(valid.value);
  }
  const base = dirname(resolve(ctx.cwd, input.file));
  const prepared: Prepared[] = [];
  for (const valid of items) {
    const one = await captureReference(ctx, ws.root, valid, { base, allowExternal: false });
    if (!one.ok) return one.result;
    prepared.push(one.value);
  }
  const batch = { file: relativeToRoot(ctx, ws.root, input.file, file), items: items.length };
  return withWriteRun(
    ctx,
    ws.root,
    {
      path: input.path,
      command: "references import",
      create: false,
      requireState: true,
      expectedRevision: ws.state.stateRevision,
    },
    (run) =>
      commitAdditions(ctx, run, ws, prepared, (data): ReferencesImportData => ({ ...data, batch })),
  );
}

/** Repo-relative POSIX path of the batch file (it is inside the repo: allowExternal is false). */
function relativeToRoot(ctx: AppContext, root: string, input: string, fallback: string): string {
  try {
    return relative(root, ctx.fs.realpathSync(resolve(ctx.cwd, input)))
      .split(sep)
      .join("/");
  } catch {
    return fallback;
  }
}

export async function runReferencesList(
  ctx: AppContext,
  input: ReferencesListInput,
): Promise<UseCaseResult<ReferencesListData>> {
  const loaded = load(ctx, input.path);
  if (!loaded.ok) return loaded.result;
  const references = byIdNumber(loaded.research.references?.references ?? []);
  const shown = input.includeRemoved
    ? references
    : references.filter((reference) => reference.removed === null);
  const data: ReferencesListData = {
    references: shown.map((reference) => ({
      id: reference.id,
      source: reference.source,
      origin: reference.origin,
      capturedAt: reference.capturedAt,
      mode: reference.mode,
      removed: reference.removed !== null,
      crops: reference.crops.length,
      securityFindings: reference.securityFindings.length,
    })),
    counts: researchCounts(
      references,
      loaded.research.brand?.inputs ?? [],
      ctx.research.minReferences,
    ),
    includeRemoved: input.includeRemoved,
  };
  return { ok: true, data, findings: [], next: [`heron status ${input.path}`] };
}

export async function runReferencesShow(
  ctx: AppContext,
  input: ReferencesShowInput,
): Promise<UseCaseResult<ReferencesShowData>> {
  const loaded = load(ctx, input.path);
  if (!loaded.ok) return loaded.result;
  const references = loaded.research.references?.references ?? [];
  const reference = references.find((candidate) => candidate.id === input.id);
  if (reference === undefined) return notFound(input.id);
  const counts = researchCounts(
    references,
    loaded.research.brand?.inputs ?? [],
    ctx.research.minReferences,
  );
  return { ok: true, data: { reference, counts }, findings: [], next: [] };
}

export async function runReferencesCompare(
  ctx: AppContext,
  input: ReferencesCompareInput,
): Promise<UseCaseResult<ReferencesCompareData>> {
  const loaded = load(ctx, input.path);
  if (!loaded.ok) return loaded.result;
  const stored = loaded.research.references?.references ?? [];
  const chosen: ResearchReference[] = [];
  for (const id of input.ids) {
    const found = stored.find((candidate) => candidate.id === id);
    if (found === undefined) return notFound(id);
    chosen.push(found);
  }
  const data: ReferencesCompareData = {
    references: chosen,
    shared: {
      studies: sharedValues(chosen.map((reference) => reference.studies)),
      doNotCopy: sharedValues(chosen.map((reference) => reference.doNotCopy)),
      influences: sharedValues(chosen.map((reference) => reference.influences)),
    },
  };
  return { ok: true, data, findings: [], next: [] };
}

/** A reference that exists and is not removed, or the failed result. */
function removable(
  references: readonly ResearchReference[],
  id: string,
): { ok: true; reference: ResearchReference } | { ok: false; result: UseCaseResult<never> } {
  const reference = references.find((candidate) => candidate.id === id);
  if (reference === undefined) return { ok: false, result: notFound(id) };
  if (reference.removed !== null) {
    return {
      ok: false,
      result: failure(
        ExitCode.Usage,
        makeFinding("REFERENCE_NOT_FOUND", "error", `Reference ${id} is already removed.`),
      ),
    };
  }
  return { ok: true, reference };
}

/** Phase must have a reference-added row (else TRANSITION_NOT_ALLOWED, exit 3); recordCommand + withArtifacts. */
export async function runReferencesRemove(
  ctx: AppContext,
  input: ReferencesRemoveInput,
): Promise<UseCaseResult<ReferencesRemoveData>> {
  const loaded = load(ctx, input.path);
  if (!loaded.ok) return loaded.result;
  const { ws, research } = loaded;
  const phase = ws.state.phase;
  if (!canTransition(ws.state, { type: "reference-added" }, { referenceComplete: true }).ok) {
    return failure(
      ExitCode.Blocked,
      makeFinding(
        "TRANSITION_NOT_ALLOWED",
        "error",
        `References cannot be removed from phase "${phase}"; research is frozen once a direction is selected.`,
      ),
    );
  }
  const first = removable(research.references?.references ?? [], input.id);
  if (!first.ok) return first.result;
  const reason = input.reason?.trim() ?? "";
  return withWriteRun(
    ctx,
    ws.root,
    {
      path: input.path,
      command: "references remove",
      create: false,
      requireState: true,
      expectedRevision: ws.state.stateRevision,
    },
    ({ store, tx, previous, meta }): WriteBodyResult<ReferencesRemoveData> => {
      if (previous === null) throw new Error("withWriteRun requireState guarantees state.json");
      const current = readResearch(store);
      const found = removable(current.references?.references ?? [], input.id);
      if (!found.ok) return { kind: "skip", result: found.result };
      const removed: ResearchReference = {
        ...found.reference,
        removed: { at: meta.at, reason: reason === "" ? null : reason },
      };
      const all = (current.references?.references ?? []).map((reference) =>
        reference.id === input.id ? removed : reference,
      );
      const brand = current.brand?.inputs ?? [];
      const staged = stageResearchOutputs(tx, store, {
        references: all,
        brand,
        currentMode: ws.mode,
        locale: ws.project.product?.locale ?? null,
        minimum: ctx.research.minReferences,
      });
      const state = withArtifacts(recordCommand(previous, meta), staged.artifacts, RESEARCH_REASON);
      const data: ReferencesRemoveData = {
        removed,
        stateRevision: state.stateRevision,
        counts: researchCounts(all, brand, ctx.research.minReferences),
        written: staged.outputs
          .filter((output) => output.written)
          .map((output) => output.path)
          .toSorted(),
      };
      return { kind: "commit", state, data, findings: [], next: [`heron status ${input.path}`] };
    },
  );
}

/** = availableSourceKinds(), for USAGE_TEXT. */
export function availableReferenceSources(): ResearchSourceKind[] {
  return availableSourceKinds();
}
