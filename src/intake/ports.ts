import type {
  AdapterId,
  ContextSourceRecord,
  DetectionReport,
  Extension,
  Finding,
  HeronMode,
  ProductContextMetadata,
  ProductContextSection,
  ProductContextSectionMap,
  RelativeArtifactPath,
  SourceRef,
  Sourced,
} from "../core/contracts/index.ts";
import type { ReadonlyFs } from "../core/store/fs-port.ts";

export type InputLimits = { maxInputBytes: number };
export const DEFAULT_INPUT_LIMITS: InputLimits = { maxInputBytes: 16_777_216 };

/** Explicit `markdown`/`manual` selection persisted by `heron init` (DR28). */
export type AdapterSelection = { adapter: "markdown" | "manual"; inputs: RelativeArtifactPath[] };

export type DetectRequest = {
  root: string;
  stage: string | null;
  fs: ReadonlyFs;
  limits: InputLimits;
  selection?: AdapterSelection | null;
};

/** One element proposed by a source, before precedence: `key` groups "the same datum" across sources (DR3),
 * `order` is its appearance index within its source. */
export type Candidate = {
  [S in ProductContextSection]: {
    section: S;
    key: string;
    value: Omit<ProductContextSectionMap[S], keyof Sourced>;
    ref: SourceRef;
    order: number;
  };
}[ProductContextSection];

/** What an adapter reads from its sources, in draft order (DR3), before merging. */
export type ContextDraft = {
  sources: ContextSourceRecord[];
  candidates: Candidate[];
  uxReader: ProductContextMetadata["uxReader"];
  uxExtensions: Extension[];
  findings: Finding[];
  /** Parts `parts.json` declares with their criterion ids (`A<m>`, unqualified), in file order. Only
   * adapters that read `parts.json` set it; it feeds `DefinedIds.parts`. */
  parts?: { id: string; criteria: string[] }[];
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

/** `mode` is the effective mode: UX sources (`ux.json`, `UX.md`) contribute only in `full`. */
export type LoadRequest = DetectRequest & { report: DetectionReport; mode: HeronMode };
/** T9 retires LOAD_NOT_AVAILABLE with the `filesystem` stub; T10 adds CONTEXT_INPUT_INVALID. */
export type AdapterLoadResult =
  | { ok: true; draft: ContextDraft }
  | {
      ok: false;
      code: "LOAD_NOT_AVAILABLE" | "INPUTS_CHANGED";
      message: string;
      findings: Finding[];
    };

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
    findings: [],
  };
}
