import { z } from "zod";

export type Sha256Hex = string; // /^[0-9a-f]{64}$/
export const Sha256HexSchema: z.ZodType<Sha256Hex> = z.string().regex(/^[0-9a-f]{64}$/);

/** POSIX, relative, no leading "/", no "\\", no NUL, no "", "." or ".." segments, ≤ 512 chars. */
export type RelativeArtifactPath = string;
export const RelativeArtifactPathSchema: z.ZodType<RelativeArtifactPath> = z
  .string()
  .max(512)
  .refine(
    (p) =>
      p.length > 0 &&
      !p.startsWith("/") &&
      !p.includes("\\") &&
      !p.includes("\0") &&
      p.split("/").every((s) => s !== "" && s !== "." && s !== ".."),
    { message: "must be a POSIX relative path without empty, '.' or '..' segments" },
  );

export type IsoDateTime = string; // RFC 3339 UTC, e.g. "2026-09-30T12:00:00.000Z"
export const IsoDateTimeSchema: z.ZodType<IsoDateTime> = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);

/** "run-" + UTC basic timestamp + "-" + 8 lowercase hex, e.g. "run-20260930T120000Z-3f9a1c2b". */
export type RunId = string; // /^run-\d{8}T\d{6}Z-[0-9a-f]{8}$/
export const RunIdSchema: z.ZodType<RunId> = z.string().regex(/^run-\d{8}T\d{6}Z-[0-9a-f]{8}$/);

export const HERON_MODES = ["full", "reference-only"] as const;
export type HeronMode = (typeof HERON_MODES)[number];
export const HeronModeSchema: z.ZodType<HeronMode> = z.enum(HERON_MODES);

export const FINDING_CODES = [
  "UX_INCONSISTENT",
  "UX_CONTRACT_INVALID",
  "UX_DECLARATION_MISMATCH",
  "UX_DECLARED_MD_ONLY",
  "MODE_BLOCKED",
  "TRANSITION_NOT_ALLOWED",
  "PRECONDITION_UNMET",
  "GATE_APPROVAL_INVALIDATED",
  "INPUTS_CHANGED",
  "SCHEMA_VERSION_UNSUPPORTED",
  "DOCUMENT_INVALID",
  "NOT_INITIALIZED",
  "HARNESS_UNREADABLE",
  "HARNESS_VERSION_UNSUPPORTED",
  "HARNESS_UNKNOWN_VALUE",
  "NO_STAGE",
  "STAGE_FALLBACK_LAST_CLOSED",
  "STAGE_NOT_FOUND",
  "NO_SELECTABLE_STAGE",
  "INVALID_STAGE",
  "UNSAFE_PATH",
  "INPUT_TOO_LARGE",
  "PATH_NOT_FOUND",
  "LOCK_BUSY",
  "LOCK_RECLAIMED",
  "STAGING_RECOVERED",
  "CONFIRMATION_REQUIRED",
  "IDENTITY_REQUIRED",
  "REASON_REQUIRED",
  "USAGE",
  "UNEXPECTED_ERROR",
  "PENPOT_REQUIRED_FOR_DIRECTION", // D26: emitted by the direction-selectable precondition
  "PROVENANCE_INCOMPLETE",
  "REFERENCE_INPUT_INVALID",
  "REFERENCE_NOT_FOUND",
  "BATCH_INVALID",
  "CROP_INVALID",
  "BRAND_INPUT_INVALID",
  "INVALID_URL",
  "SSRF_BLOCKED",
  "FETCH_FAILED",
  "UNSUPPORTED_MEDIA_TYPE",
  "IMAGE_UNREADABLE",
  "IMAGE_ENGINE_UNAVAILABLE",
  "ADAPTER_NOT_AVAILABLE",
  "LOCALE_INVALID",
  "LOCALE_FALLBACK",
  "ASSETS_LARGE",
  "PRODUCT_CONTEXT_STALE",
  "CONFLICT_OPEN",
  "CONFLICT_NOT_FOUND",
  "CONFLICT_ALREADY_ACKNOWLEDGED",
  "NOTE_REQUIRED",
  "CONTEXT_INPUT_INVALID",
  "CONTEXT_SECTION_UNREADABLE",
  "CONTEXT_DUPLICATE_ID",
  "UX_REFERENCE_UNRESOLVED",
  "REFERENCES_NOT_CHECKED",
  "ADAPTER_REFERENCE_ONLY",
  "SOURCE_NO_ELEMENTS",
  "LOWER_TIER_ITEMS_SKIPPED",
  "AGENT_UNAVAILABLE",
  "AGENT_FAILED",
  "AGENT_TIMEOUT",
  "AGENT_OUTPUT_INVALID",
  "AGENT_POLICY_VIOLATION",
  "AGENT_ENV_IGNORED",
  "AGENT_CONFIG_INVALID",
  "AGENT_RUN_REUSED",
  "AGENT_BUDGET_WARNING",
  "AGENT_CONTEXT_EMPTY",
  "AGENT_OUTPUT_SUSPICIOUS",
  "CONTEXT_PACK_TRIMMED",
  "CONTEXT_PACK_OVER_BUDGET",
  "RESEARCH_QUERY_INVALID",
  "DIRECTION_NOT_FOUND",
  "DIRECTION_PREFERENCE_CLEARED",
  "DIRECTIONS_WITHOUT_UX_CONTEXT",
  "SECRET_REDACTED",
  "PENPOT_NOT_CONFIGURED",
  "PENPOT_URL_MISSING",
  "PENPOT_CONFIG_INVALID",
  "PENPOT_KEY_MISSING",
  "PENPOT_KEY_FILE_PERMISSIONS",
  "PENPOT_UNREACHABLE",
  "PENPOT_KEY_REJECTED",
  "PENPOT_MCP_INCOMPATIBLE",
  "PENPOT_PLUGIN_NOT_CONNECTED",
  "PENPOT_TIMEOUT",
  "PENPOT_SCRIPT_FAILED",
  "PENPOT_SCRIPT_TOO_LARGE",
  "PENPOT_FILE_MISMATCH",
  "PENPOT_FILE_REBOUND",
  "PENPOT_VERSION_UNTESTED",
  "PENPOT_SOURCE_UNAVAILABLE",
  "PENPOT_SYNC_PARTIAL",
  "PENPOT_HUMAN_SHAPES_INSIDE",
  "PENPOT_DUPLICATE_PAGE",
  "PENPOT_FONT_FALLBACK",
  "PENPOT_PROPOSAL_FALLBACK",
  "PENPOT_REFERENCES_TRUNCATED",
] as const;
export type FindingCode = (typeof FINDING_CODES)[number];
export type FindingSeverity = "info" | "warning" | "error";
/** `pointer` is an RFC 6901 JSON Pointer into the file named by the finding ("" = document root). */
export type FindingIssue = { pointer: string; message: string };
export type Finding = {
  code: FindingCode;
  severity: FindingSeverity;
  message: string;
  paths: string[]; // repo-relative POSIX paths
  issues: FindingIssue[]; // sorted by pointer, then message
};

export const FindingIssueSchema: z.ZodType<FindingIssue> = z.looseObject({
  pointer: z.string(),
  message: z.string(),
});
/** Persisted finding codes are UPPER_SNAKE text (OD1-C′); emitters still type `FindingCode`. */
export const FINDING_CODE_PATTERN = /^[A-Z][A-Z0-9_]*$/;
/** Persisted finding: same shape as `Finding`, but `code` is any UPPER_SNAKE string so a new emitter code needs no schema bump. */
export type StoredFinding = Omit<Finding, "code"> & { code: string };
export const StoredFindingSchema: z.ZodType<StoredFinding> = z.looseObject({
  code: z.string().regex(FINDING_CODE_PATTERN),
  severity: z.enum(["info", "warning", "error"]),
  message: z.string(),
  paths: z.array(z.string()),
  issues: z.array(FindingIssueSchema),
});
/** Closed-union schema: CliEnvelope.findings only. */
export const FindingSchema: z.ZodType<Finding> = z.looseObject({
  code: z.enum(FINDING_CODES),
  severity: z.enum(["info", "warning", "error"]),
  message: z.string(),
  paths: z.array(z.string()),
  issues: z.array(FindingIssueSchema),
});

/** Exit codes (MASTER.md Contratos). Same identifier for the value map and the union type. */
export const ExitCode = {
  Ok: 0,
  Unexpected: 1,
  Usage: 2,
  Blocked: 3, // mode or precondition
  ValidationFailed: 4,
  DependencyUnavailable: 5,
  LockBusy: 6, // lock held or stateRevision conflict
} as const;
export type ExitCode = (typeof ExitCode)[keyof typeof ExitCode];

/** ["screens", 1, "surface"] -> "/screens/1/surface"; escapes "~" as "~0" and "/" as "~1". */
export function toJsonPointer(path: readonly PropertyKey[]): string {
  return path.map((seg) => `/${String(seg).replaceAll("~", "~0").replaceAll("/", "~1")}`).join("");
}
