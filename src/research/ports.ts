import type {
  CaptureMethod,
  ReferenceCapture,
  RelativeArtifactPath,
  ResearchSourceKind,
  SecurityFinding,
  Sha256Hex,
} from "../core/contracts/index.ts";
import type { ReadonlyFs } from "../core/store/fs-port.ts";
import type { Fetcher } from "../security/fetch/types.ts";
import type { ImageSanitizer } from "../security/images/sanitize.ts";

export type ResearchSettings = {
  minReferences: number; // 5 (D16)
  maxTextBytes: number; // 2 MiB (DESIGN.md and pages)
  maxImageBytes: number; // 20 MiB (D16 "20 MB" read as 20 MiB, like InputLimits)
  maxImagePixels: number; // 50 MP (D16)
  maxBatchBytes: number; // 1 MiB
  maxBatchReferences: number; // 200
  assetWarningBytes: number; // 50 MiB (D15 status warning)
};
export const DEFAULT_RESEARCH_SETTINGS: ResearchSettings = {
  minReferences: 5,
  maxTextBytes: 2_097_152,
  maxImageBytes: 20_971_520,
  maxImagePixels: 50_000_000,
  maxBatchBytes: 1_048_576,
  maxBatchReferences: 200,
  assetWarningBytes: 52_428_800,
};
export type CaptureLimits = Pick<
  ResearchSettings,
  "maxTextBytes" | "maxImageBytes" | "maxImagePixels"
>;

/** Raw user path. `base` = ctx.cwd (CLI) or the batch file directory; `allowExternal` is true only for an explicit CLI
 * --file (D28), false for the batch file and batch items. */
export type InputFileRef = { path: string; base: string; allowExternal: boolean };
export type CaptureServices = {
  fetcher: Fetcher;
  images: ImageSanitizer;
  fs: ReadonlyFs;
  root: string; // realpath of the product repo
};
export type CaptureInput =
  | { kind: "manual" }
  | { kind: "url"; url: string; allowLocal: boolean }
  | { kind: "image"; file: InputFileRef; method: CaptureMethod }
  | { kind: "design-md"; from: { file: InputFileRef } | { url: string; allowLocal: boolean } };
export type CaptureRequest = {
  input: CaptureInput;
  services: CaptureServices;
  limits: CaptureLimits;
};
/** Staged by `app` under .heron/. */
export type CapturedFile = { path: RelativeArtifactPath; sha256: Sha256Hex; bytes: Uint8Array };
export type Captured = {
  capture: ReferenceCapture;
  files: CapturedFile[];
  securityFindings: SecurityFinding[];
};
export const CAPTURE_FAILURE_CODES = [
  "INVALID_URL",
  "SSRF_BLOCKED",
  "FETCH_FAILED",
  "UNSUPPORTED_MEDIA_TYPE",
  "INPUT_TOO_LARGE",
  "UNSAFE_PATH",
  "PATH_NOT_FOUND",
  "IMAGE_UNREADABLE",
  "IMAGE_ENGINE_UNAVAILABLE",
] as const;
export type CaptureFailureCode = (typeof CAPTURE_FAILURE_CODES)[number]; // all members of FindingCode
export type CaptureFailure = { code: CaptureFailureCode; message: string; paths: string[] };
export type CaptureResult =
  | { ok: true; captured: Captured }
  | { ok: false; failure: CaptureFailure };

export interface ResearchSource {
  readonly kind: ResearchSourceKind;
  /** Stateless; effects only through request.services; never writes; never throws on hostile input. */
  capture(request: CaptureRequest): Promise<CaptureResult>;
}

/** A failed capture. */
export function captureFailure(
  code: CaptureFailureCode,
  message: string,
  paths: string[] = [],
): { ok: false; failure: CaptureFailure } {
  return { ok: false, failure: { code, message, paths } };
}

/** Invariant guard: `app` picks the adapter with `sourceFor(kind)`, so a mismatch is a caller bug, reported as data. */
export function wrongInput(source: ResearchSourceKind, input: CaptureInput): CaptureResult {
  return captureFailure(
    "UNSUPPORTED_MEDIA_TYPE",
    `Reference source "${source}" cannot capture a "${input.kind}" input.`,
  );
}
