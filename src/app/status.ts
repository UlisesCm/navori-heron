import {
  GATE_NAMES,
  HERON_PROJECT_DOCUMENT,
  HERON_STATE_DOCUMENT,
  InvalidDocumentError,
  MODE_DECISION_DOCUMENT,
  type DetectionReport,
  type DocumentSpec,
  type Finding,
  type GateName,
  type HeronMode,
  type RelativeArtifactPath,
  type Sha256Hex,
  type StatusData,
} from "../core/contracts/index.ts";
import {
  gateStatuses,
  invalidatedGates,
  isApprovalValid,
  latestDecision,
} from "../core/state/gates.ts";
import { describeModeBlock, detectMode } from "../core/state/mode.ts";
import { compareStrings } from "../core/state/stale.ts";
import { allowedEvents } from "../core/state/transitions.ts";
import {
  MODE_FILE,
  PROJECT_FILE,
  STATE_FILE,
  openFileStore,
  type FileStore,
} from "../core/store/file-store.ts";
import { detectProject } from "../intake/detect.ts";
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

export type StatusInput = { path: string };

/** path -> sha256 (null when absent) of every input file a detection looked at. */
function inputHashes(report: DetectionReport): Map<string, Sha256Hex | null> {
  const map = new Map<string, Sha256Hex | null>();
  for (const file of [...report.artifacts, report.uxMarkdown, report.uxJson]) {
    map.set(file.path, file.present ? file.sha256 : null);
  }
  map.delete("");
  return map;
}

function changedInputs(persisted: DetectionReport, live: DetectionReport): string[] {
  const before = inputHashes(persisted);
  const after = inputHashes(live);
  const paths = new Set([...before.keys(), ...after.keys()]);
  return [...paths]
    .filter((path) => (before.get(path) ?? null) !== (after.get(path) ?? null))
    .toSorted(compareStrings);
}

/** A document that must exist once state.json does; a missing one is reported as invalid. */
function requireDocument<T>(
  store: FileStore,
  path: RelativeArtifactPath,
  spec: DocumentSpec<T>,
): T {
  const value = store.readDocument(path, spec);
  if (value === null) {
    throw new InvalidDocumentError(path, spec.kind, [{ pointer: "", message: "file is missing" }]);
  }
  return value;
}

/** Read-only: no lock, no writes (DP16). */
export async function runStatus(
  ctx: AppContext,
  input: StatusInput,
): Promise<UseCaseResult<StatusData>> {
  const root = resolveDirectory(ctx.fs, input.path);
  if (root === null) return pathNotFound(input.path);
  try {
    return readStatus(ctx, root, input.path);
  } catch (error) {
    const mapped = storeErrorResult<StatusData>(error);
    if (mapped === null) throw error;
    return mapped;
  }
}

function readStatus(ctx: AppContext, root: string, path: string): UseCaseResult<StatusData> {
  const store = openFileStore(ctx.fs, root, { create: false });
  const state = store.readDocument(STATE_FILE, HERON_STATE_DOCUMENT);
  if (state === null) {
    return failure(
      3,
      makeFinding(
        "NOT_INITIALIZED",
        "error",
        `.heron/state.json not found. Run: heron init ${path}`,
      ),
    );
  }
  const project = requireDocument(store, PROJECT_FILE, HERON_PROJECT_DOCUMENT);
  const persisted = requireDocument(store, MODE_FILE, MODE_DECISION_DOCUMENT);

  const detection = detectProject({
    root,
    stage: project.source.stage?.dir ?? null,
    fs: ctx.fs,
    limits: ctx.limits,
  });
  if (detection.kind === "stage-error") return stageErrorResult(detection);
  const live = detectMode(detection.report);

  const effective: HeronMode =
    state.mode === "full" && live.mode === "full" ? "full" : "reference-only";
  const findings: Finding[] = [];
  const inputsChanged = changedInputs(persisted.detection, detection.report);
  if (inputsChanged.length > 0) {
    findings.push(
      makeFinding(
        "INPUTS_CHANGED",
        "warning",
        `Inputs changed since the last heron init: ${inputsChanged.join(", ")}. Run: heron init ${path}`,
        inputsChanged,
      ),
    );
  }

  const current = new Map<RelativeArtifactPath, Sha256Hex>();
  for (const decision of state.gates) {
    for (const artifact of decision.artifacts) {
      const sha = store.sha256(artifact.path);
      if (sha !== null) current.set(artifact.path, sha);
    }
  }
  for (const gate of invalidatedGates(state, current)) {
    const decision = latestDecision(state, gate);
    const validity = decision === null ? null : isApprovalValid(decision, current);
    if (validity !== null && !validity.valid) {
      findings.push(
        makeFinding(
          "GATE_APPROVAL_INVALIDATED",
          "warning",
          `Gate "${gate}" approval is no longer valid: changed [${validity.changed.join(", ")}], missing [${validity.missing.join(", ")}].`,
          [...validity.changed, ...validity.missing],
        ),
      );
    }
  }

  const statuses = gateStatuses(state, current);
  const gatesWithRows = new Set<GateName>();
  for (const event of allowedEvents({ ...state, mode: effective })) {
    if (event.type === "approve-gate" || event.type === "reject-gate")
      gatesWithRows.add(event.gate);
  }
  const data: StatusData = {
    adapter: detection.report.adapter,
    navoriMaster: detection.report.navoriMaster,
    stage: detection.report.stage,
    mode: effective,
    persistedMode: state.mode,
    liveMode: live.mode,
    phase: state.phase,
    stateRevision: state.stateRevision,
    counts: effective === "full" ? live.detection.uxJson.summary : null,
    gates: GATE_NAMES.map((gate) => ({ gate, status: statuses[gate] })),
    stale: state.stale,
    inputsChanged,
    openConflicts: null,
    allowedCommands: [
      "heron init",
      "heron status",
      "heron doctor",
      ...GATE_NAMES.filter((gate) => gatesWithRows.has(gate)).map(
        (gate) => `heron gate ${gate} approve|reject`,
      ),
    ],
  };
  if (effective === "reference-only") {
    const blocked = live.mode === "reference-only" ? live : persisted;
    // Carries the cause of "Production blocked: ..." to the renderer (StatusData has no field for it).
    findings.push(
      makeFinding("MODE_BLOCKED", "info", `Production blocked: ${describeModeBlock(blocked)}`),
    );
  }
  return { ok: true, data, findings, next: [] };
}
