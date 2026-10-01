import {
  ExitCode,
  FINDING_CODES,
  INTAKE_CONFLICTS_DOCUMENT,
  PRODUCT_CONTEXT_DOCUMENT,
  canonicalJson,
  parseVersionedDocument,
  type DetectionReport,
  type Finding,
  type HeronMode,
  type IntakeConflicts,
  type IntakeData,
  type ProductContext,
  type StoredFinding,
} from "../core/contracts/index.ts";
import { freshen, recordCommand, withArtifacts } from "../core/state/lifecycle.ts";
import { detectMode } from "../core/state/mode.ts";
import { adapterFor, detectProject } from "../intake/detect.ts";
import { detectConflicts, reconcileConflicts } from "../intake/conflicts.ts";
import type { AdapterSelection } from "../intake/ports.ts";
import { buildProductContext, countSections, withConflictIds } from "../intake/product-context.ts";
import type { AppContext } from "./context.ts";
import {
  makeFinding,
  pathNotFound,
  resolveDirectory,
  stageErrorResult,
  storeErrorResult,
  type UseCaseResult,
} from "./result.ts";
import { loadWorkspace, selectionOf } from "./workspace.ts";
import { withWriteRun, type WriteBodyResult } from "./write-run.ts";

export const PRODUCT_CONTEXT_FILE = "intake/product-context.json";
export const CONFLICTS_FILE = "intake/conflicts.json";

export type IntakeInput = { path: string; dryRun: boolean };
export type IntakeSnapshot = {
  /** User-supplied path, only for the "Run: heron conflicts ack" hints. */
  path: string;
  root: string;
  detection: DetectionReport;
  mode: HeronMode;
  selection: AdapterSelection | null;
};
export type IntakeComputation = {
  context: ProductContext;
  conflicts: IntakeConflicts;
  /** Canonical JSON: the exact bytes the store writes. */
  texts: { context: string; conflicts: string };
  /** Extraction findings plus CONFLICT_OPEN per open unacknowledged conflict. */
  findings: Finding[];
};

const STALE_REASON = "The product context changed.";

/** Stored findings carry any code; the envelope only knows the registered ones. */
function toFindings(stored: readonly StoredFinding[]): Finding[] {
  return stored.flatMap((finding) => {
    const code = FINDING_CODES.find((known) => known === finding.code);
    return code === undefined ? [] : [{ ...finding, code }];
  });
}

/**
 * adapterFor(...).load -> buildProductContext -> detectConflicts -> reconcileConflicts(previous) -> withConflictIds
 * -> canonical texts. Reads the sources and writes nothing; `status` and the gate call it too (freshness is
 * regenerate-and-compare, DR2).
 */
export function computeIntake(
  ctx: AppContext,
  snapshot: IntakeSnapshot,
  previous: IntakeConflicts | null,
): { ok: true; value: IntakeComputation } | { ok: false; result: UseCaseResult<never> } {
  const { detection, mode, selection, root } = snapshot;
  const adapter = adapterFor(detection.adapter);
  if (adapter === null) throw new Error(`no adapter owns "${detection.adapter}"`);
  const loaded = adapter.load({
    root,
    stage: detection.stage?.dir ?? null,
    fs: ctx.fs,
    limits: ctx.limits,
    selection,
    report: detection,
    mode,
  });
  if (!loaded.ok) {
    return {
      ok: false,
      result: {
        ok: false,
        code: loaded.code === "INPUTS_CHANGED" ? ExitCode.Blocked : ExitCode.Usage,
        message: loaded.message,
        findings: loaded.findings,
        data: null,
      },
    };
  }
  const built = buildProductContext(loaded.draft, {
    adapter: detection.adapter,
    mode,
    stage:
      detection.stage === null
        ? null
        : { dir: detection.stage.dir, selection: detection.stage.selection },
  });
  const conflicts = reconcileConflicts(
    previous,
    detectConflicts(built.context, built.mismatches, built.defined),
  );
  const context = withConflictIds(built.context, conflicts);
  const texts = {
    context: canonicalJson(
      parseVersionedDocument(context, PRODUCT_CONTEXT_DOCUMENT, PRODUCT_CONTEXT_FILE),
    ),
    conflicts: canonicalJson(
      parseVersionedDocument(conflicts, INTAKE_CONFLICTS_DOCUMENT, CONFLICTS_FILE),
    ),
  };
  const open = conflicts.conflicts.filter((c) => c.status === "open" && c.ack === null);
  const findings = [
    ...toFindings(context.metadata.findings),
    ...open.map((c) =>
      makeFinding(
        "CONFLICT_OPEN",
        "warning",
        `${c.id} (${c.kind}) on ${c.subject} is not acknowledged. Run: heron conflicts ack ${c.id} ${snapshot.path} --note <text>`,
      ),
    ),
  ];
  return { ok: true, value: { context, conflicts, texts, findings } };
}

function dataOf(
  snapshot: IntakeSnapshot,
  computed: IntakeComputation,
  extra: { dryRun: boolean; written: boolean; stateRevision: number | null },
): IntakeData {
  return {
    mode: snapshot.mode,
    adapter: snapshot.detection.adapter,
    stage: snapshot.detection.stage,
    ...extra,
    counts: countSections(computed.context),
    conflicts: computed.conflicts.conflicts
      .filter((c) => c.status === "open")
      .map((c) => ({ id: c.id, kind: c.kind, subject: c.subject, acknowledged: c.ack !== null })),
  };
}

/**
 * Initialized: loadWorkspace -> withWriteRun(expectedRevision R): previous conflicts.json -> computeIntake ->
 * unchanged bytes: skip -> tx.put both -> recordCommand + withArtifacts + freshen -> commit, in any phase (DR7).
 * --dry-run never writes and works without .heron/ (detection with the default stage).
 */
export async function runIntake(
  ctx: AppContext,
  input: IntakeInput,
): Promise<UseCaseResult<IntakeData>> {
  try {
    const loaded = loadWorkspace(ctx, input.path);
    if (!loaded.ok) {
      const notInit = loaded.result.findings.some((f) => f.code === "NOT_INITIALIZED");
      return input.dryRun && notInit ? dryRunWithoutWorkspace(ctx, input) : loaded.result;
    }
    const { workspace: ws } = loaded;
    const snapshot: IntakeSnapshot = {
      path: input.path,
      root: ws.root,
      detection: ws.detection,
      mode: ws.mode,
      selection: selectionOf(ws.project),
    };
    const next = [`heron status ${input.path}`];
    if (input.dryRun) {
      const previous = ws.store.readDocument(CONFLICTS_FILE, INTAKE_CONFLICTS_DOCUMENT);
      const computed = computeIntake(ctx, snapshot, previous);
      if (!computed.ok) return computed.result;
      const data = dataOf(snapshot, computed.value, {
        dryRun: true,
        written: false,
        stateRevision: ws.state.stateRevision,
      });
      return { ok: true, data, findings: computed.value.findings, next };
    }
    return await withWriteRun(
      ctx,
      ws.root,
      {
        path: input.path,
        command: "intake",
        create: false,
        requireState: true,
        expectedRevision: ws.state.stateRevision,
      },
      ({ store, tx, previous, meta }): WriteBodyResult<IntakeData> => {
        if (previous === null) throw new Error("withWriteRun requireState guarantees state.json");
        const computed = computeIntake(
          ctx,
          snapshot,
          store.readDocument(CONFLICTS_FILE, INTAKE_CONFLICTS_DOCUMENT),
        );
        if (!computed.ok) return { kind: "skip", result: computed.result };
        const { texts, findings } = computed.value;
        const same = (path: string, text: string): boolean => {
          const onDisk = store.readBytes(path);
          return onDisk !== null && Buffer.compare(onDisk, new TextEncoder().encode(text)) === 0;
        };
        const unchanged =
          same(PRODUCT_CONTEXT_FILE, texts.context) && same(CONFLICTS_FILE, texts.conflicts);
        const done = { dryRun: false, stateRevision: previous.stateRevision };
        if (unchanged) {
          const data = dataOf(snapshot, computed.value, { ...done, written: false });
          return { kind: "skip", result: { ok: true, data, findings, next } };
        }
        const artifacts = [
          { path: PRODUCT_CONTEXT_FILE, sha256: tx.put(PRODUCT_CONTEXT_FILE, texts.context) },
          { path: CONFLICTS_FILE, sha256: tx.put(CONFLICTS_FILE, texts.conflicts) },
        ];
        const state = freshen(
          withArtifacts(recordCommand(previous, meta), artifacts, STALE_REASON),
          [PRODUCT_CONTEXT_FILE, CONFLICTS_FILE],
        );
        const data = dataOf(snapshot, computed.value, {
          dryRun: false,
          written: true,
          stateRevision: state.stateRevision,
        });
        return { kind: "commit", state, data, findings, next };
      },
    );
  } catch (error) {
    const mapped = storeErrorResult<IntakeData>(error);
    if (mapped === null) throw error;
    return mapped;
  }
}

/** `--dry-run` over a repository that was never initialized: default stage, no persisted selection, no store. */
function dryRunWithoutWorkspace(ctx: AppContext, input: IntakeInput): UseCaseResult<IntakeData> {
  const root = resolveDirectory(ctx.fs, input.path);
  if (root === null) return pathNotFound(input.path);
  const found = detectProject({ root, stage: null, fs: ctx.fs, limits: ctx.limits });
  if (found.kind === "stage-error") return stageErrorResult(found);
  const snapshot: IntakeSnapshot = {
    path: input.path,
    root,
    detection: found.report,
    mode: detectMode(found.report).mode,
    selection: null,
  };
  const computed = computeIntake(ctx, snapshot, null);
  if (!computed.ok) return computed.result;
  const data = dataOf(snapshot, computed.value, {
    dryRun: true,
    written: false,
    stateRevision: null,
  });
  return { ok: true, data, findings: computed.value.findings, next: [`heron init ${input.path}`] };
}
