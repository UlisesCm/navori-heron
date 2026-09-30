import type { AdapterId, DetectionReport } from "../core/contracts/index.ts";
import type { ReadonlyFs } from "../core/store/fs-port.ts";

export type InputLimits = { maxInputBytes: number };
export const DEFAULT_INPUT_LIMITS: InputLimits = { maxInputBytes: 16_777_216 };

export type DetectRequest = {
  root: string;
  stage: string | null;
  fs: ReadonlyFs;
  limits: InputLimits;
};

export type StageSummary = { dir: string; state: string };
export type StageError = {
  kind: "stage-error";
  code: "STAGE_NOT_FOUND" | "NO_SELECTABLE_STAGE" | "INVALID_STAGE";
  requested: string | null;
  available: StageSummary[]; // index order
  message: string;
};

export type AdapterDetection =
  | { kind: "not-detected" }
  | { kind: "detected"; report: DetectionReport }
  | StageError;

export type LoadRequest = DetectRequest & { report: DetectionReport };
/** P4 widens this union with { ok: true; context: ProductContext }. */
export type AdapterLoadResult = { ok: false; code: "LOAD_NOT_AVAILABLE"; message: string };

export interface ProductContextAdapter {
  readonly id: AdapterId;
  /** Read-only and non-throwing on hostile input: problems become findings in the report. */
  detect(request: DetectRequest): AdapterDetection;
  load(request: LoadRequest): AdapterLoadResult;
}

/** Shared `load` stub until P4 (ProductContext). */
export function loadNotAvailable(id: AdapterId): AdapterLoadResult {
  return {
    ok: false,
    code: "LOAD_NOT_AVAILABLE",
    message: `Adapter "${id}" cannot load a ProductContext yet.`,
  };
}
