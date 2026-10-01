import {
  HERON_PROJECT_DOCUMENT,
  HERON_STATE_DOCUMENT,
  InvalidDocumentError,
  MODE_DECISION_DOCUMENT,
  type DetectionReport,
  type DocumentSpec,
  type HeronMode,
  type HeronProject,
  type HeronState,
  type ModeDecision,
  type StoredModeDecision,
  type RelativeArtifactPath,
} from "../core/contracts/index.ts";
import { detectMode } from "../core/state/mode.ts";
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
  notInitialized,
  pathNotFound,
  resolveDirectory,
  stageErrorResult,
  type UseCaseResult,
} from "./result.ts";

export type Workspace = {
  /** Realpath of the product repository. */
  root: string;
  /** Opened with create: false. */
  store: FileStore;
  /** Persisted state. */
  state: HeronState;
  project: HeronProject;
  /** `.heron/intake/mode.json`. */
  persisted: StoredModeDecision;
  /** detectMode over the live detection with the persisted stage. */
  live: ModeDecision;
  /** Live detection report. */
  detection: DetectionReport;
  /** Effective mode: "full" iff state.mode and live.mode are both "full". */
  mode: HeronMode;
  /** Decision that explains reference-only: live when it is reference-only, else the persisted one. */
  blocked: StoredModeDecision;
};

export type WorkspaceLoad =
  | { ok: true; workspace: Workspace }
  | { ok: false; result: UseCaseResult<never> };

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

/**
 * Read-only snapshot of an initialized workspace, no lock: resolveDirectory (PATH_NOT_FOUND, exit 2) ->
 * openFileStore(create: false) -> state.json (absent: NOT_INITIALIZED, exit 3) -> project.json and mode.json
 * (absent: InvalidDocumentError "file is missing") -> detectProject with the persisted stage (stage-error: exit 2).
 * Store and document errors are thrown; callers map them with storeErrorResult.
 */
export function loadWorkspace(ctx: AppContext, path: string): WorkspaceLoad {
  const root = resolveDirectory(ctx.fs, path);
  if (root === null) return { ok: false, result: pathNotFound(path) };
  const store = openFileStore(ctx.fs, root, { create: false });
  const state = store.readDocument(STATE_FILE, HERON_STATE_DOCUMENT);
  if (state === null) return { ok: false, result: notInitialized(path) };
  const project = requireDocument(store, PROJECT_FILE, HERON_PROJECT_DOCUMENT);
  const persisted = requireDocument(store, MODE_FILE, MODE_DECISION_DOCUMENT);
  const found = detectProject({
    root,
    stage: project.source.stage?.dir ?? null,
    fs: ctx.fs,
    limits: ctx.limits,
  });
  if (found.kind === "stage-error") return { ok: false, result: stageErrorResult(found) };
  const live = detectMode(found.report);
  const mode: HeronMode = state.mode === "full" && live.mode === "full" ? "full" : "reference-only";
  return {
    ok: true,
    workspace: {
      root,
      store,
      state,
      project,
      persisted,
      live,
      detection: found.report,
      mode,
      blocked: live.mode === "reference-only" ? live : persisted,
    },
  };
}
