import {
  RESEARCH_SOURCE_KINDS,
  type CaptureMethod,
  type CropInput,
  type FindingIssue,
  type HeronMode,
  type ReferenceId,
  type ReferenceInput,
  type ResearchReference,
  type ResearchSourceKind,
} from "../core/contracts/index.ts";
import { redactUrl } from "../security/redact.ts";

export const PROVENANCE_FIELDS = [
  "source",
  "origin",
  "reason",
  "studies",
  "doNotCopy",
  "influences",
] as const;
export type ProvenanceField = (typeof PROVENANCE_FIELDS)[number];
export const REFERENCE_TEXT_LIMITS = {
  origin: 2048,
  reason: 2000,
  item: 500,
  items: 20,
  crops: 20,
  note: 500,
} as const;

/** Kinds that are valid names but have no adapter yet (penpot P6, refero P10): `app` answers ADAPTER_NOT_AVAILABLE. */
type UnavailableKind = Exclude<ResearchSourceKind, "manual" | "url" | "image" | "design-md">;
export type ValidReferenceInput = {
  source: ResearchSourceKind;
  origin: string | null; // null: derived from url
  reason: string;
  studies: string[];
  doNotCopy: string[];
  influences: string[];
  capture:
    | { kind: "manual" }
    | { kind: "url"; url: string; allowLocal: boolean }
    | { kind: "image"; file: string; method: CaptureMethod }
    | { kind: "design-md"; file: string }
    | { kind: "design-md"; url: string; allowLocal: boolean }
    | { kind: UnavailableKind };
  crops: CropInput[];
};
export type ReferenceInputResult =
  | { ok: true; value: ValidReferenceInput }
  | {
      ok: false;
      code: "PROVENANCE_INCOMPLETE" | "REFERENCE_INPUT_INVALID";
      message: string;
      issues: FindingIssue[];
    };

const FLAGS: Readonly<Record<string, string>> = {
  source: "--source",
  origin: "--origin",
  reason: "--reason",
  studies: "--study",
  doNotCopy: "--do-not-copy",
  influences: "--influence",
  url: "--url",
  file: "--file",
};
const LIST_FIELDS = ["studies", "doNotCopy", "influences"] as const;

const blank = (value: string | null): boolean => value === null || value.trim() === "";

/** Trimmed, blanks dropped, case-insensitive duplicates dropped (first spelling kept). */
function cleanList(items: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    const value = item.trim();
    if (value === "" || seen.has(value.toLowerCase())) continue;
    seen.add(value.toLowerCase());
    out.push(value);
  }
  return out;
}

function parseHttpUrl(text: string): URL | null {
  try {
    const url = new URL(text);
    return url.protocol === "http:" || url.protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

function invalid(detail: string, pointer: string): ReferenceInputResult {
  return {
    ok: false,
    code: "REFERENCE_INPUT_INVALID",
    message: `Invalid reference input: ${detail}. Nothing was written.`,
    issues: [{ pointer, message: detail }],
  };
}

/** `file`/`url` the source needs but the input lacks; design-md accepts either one. */
function missingTarget(source: ResearchSourceKind, input: ReferenceInput): string[] {
  const noFile = blank(input.file);
  const noUrl = blank(input.url);
  if (source === "url" && noUrl) return ["url"];
  if (source === "image" && noFile) return ["file"];
  return source === "design-md" && noFile && noUrl ? ["file"] : [];
}

function targetFlag(source: ResearchSourceKind, field: string): string {
  return source === "design-md" && field === "file" ? "--file or --url" : (FLAGS[field] ?? field);
}

/** Contradictory or out-of-limit input (REFERENCE_INPUT_INVALID); null when consistent. */
function conflict(
  source: ResearchSourceKind,
  input: ReferenceInput,
  origin: string,
  lists: Record<(typeof LIST_FIELDS)[number], string[]>,
  reason: string,
): string | null {
  const hasFile = !blank(input.file);
  const hasUrl = !blank(input.url);
  if (source === "manual" && (hasFile || hasUrl))
    return "a manual reference takes no --file or --url";
  if (source === "url" && hasFile) return "a url reference takes --url, not --file";
  if (source === "image" && hasUrl) return "an image reference takes --file, not --url";
  if (source === "design-md" && hasFile && hasUrl) return "pass either --file or --url, not both";
  if (source === "url" && origin !== "")
    return "the origin of a url reference is derived from --url";
  if (source === "design-md" && hasUrl && origin !== "") {
    return "the origin of a design-md reference from --url is derived from it";
  }
  if (input.screenshot && source !== "image")
    return "--screenshot only applies to an image reference";
  if (input.allowLocal && !hasUrl) return "--allow-local only applies with --url";
  if (input.crops.length > 0 && source !== "image") return "crops only apply to an image reference";
  if (input.crops.length > REFERENCE_TEXT_LIMITS.crops) {
    return `at most ${REFERENCE_TEXT_LIMITS.crops} crops are allowed`;
  }
  if (origin.length > REFERENCE_TEXT_LIMITS.origin) {
    return `origin exceeds ${REFERENCE_TEXT_LIMITS.origin} characters`;
  }
  if (reason.length > REFERENCE_TEXT_LIMITS.reason) {
    return `reason exceeds ${REFERENCE_TEXT_LIMITS.reason} characters`;
  }
  for (const field of LIST_FIELDS) {
    const items = lists[field];
    if (items.length > REFERENCE_TEXT_LIMITS.items) {
      return `${field} has more than ${REFERENCE_TEXT_LIMITS.items} items`;
    }
    if (items.some((item) => item.length > REFERENCE_TEXT_LIMITS.item)) {
      return `a ${field} item exceeds ${REFERENCE_TEXT_LIMITS.item} characters`;
    }
  }
  return null;
}

function cropProblem(crop: CropInput, index: number): string | null {
  const ints = [crop.x, crop.y, crop.width, crop.height].every(Number.isInteger);
  if (!ints || crop.x < 0 || crop.y < 0 || crop.width < 1 || crop.height < 1) {
    return `crop ${index + 1} needs integer x,y >= 0 and width,height >= 1`;
  }
  const note = crop.note.trim();
  return note === "" || note.length > REFERENCE_TEXT_LIMITS.note
    ? `crop ${index + 1} needs a note of 1 to ${REFERENCE_TEXT_LIMITS.note} characters`
    : null;
}

/** Pure. Missing fields (PROVENANCE_FIELDS order, then file/url) -> PROVENANCE_INCOMPLETE; contradictions or limits ->
 * REFERENCE_INPUT_INVALID. pointerPrefix: "" for the CLI, "/references/{i}" for a batch item (reported as "Batch item
 * {i + 1}"). Origins that parse as http(s) URLs are passed through redactUrl. Issues keep the contract order. */
export function validateReferenceInput(
  input: ReferenceInput,
  pointerPrefix: string,
): ReferenceInputResult {
  const source = RESEARCH_SOURCE_KINDS.find((kind) => kind === input.source?.trim());
  const lists = {
    studies: cleanList(input.studies),
    doNotCopy: cleanList(input.doNotCopy),
    influences: cleanList(input.influences),
  };
  const reason = (input.reason ?? "").trim();
  const origin = (input.origin ?? "").trim();
  const absent: string[] = [];
  if (blank(input.source)) absent.push("source");
  const derivable = source === "url" || (source === "design-md" && !blank(input.url));
  if (origin === "" && !derivable) absent.push("origin");
  if (reason === "") absent.push("reason");
  for (const field of LIST_FIELDS) if (lists[field].length === 0) absent.push(field);
  if (source !== undefined) absent.push(...missingTarget(source, input));
  if (absent.length > 0) {
    const fields = absent
      .map(
        (field) =>
          `${field} (${source === undefined ? (FLAGS[field] ?? field) : targetFlag(source, field)})`,
      )
      .join(", ");
    const index = Number(pointerPrefix.slice(pointerPrefix.lastIndexOf("/") + 1));
    const subject = pointerPrefix === "" ? "Reference" : `Batch item ${index + 1}`;
    return {
      ok: false,
      code: "PROVENANCE_INCOMPLETE",
      message: `${subject} is missing required field(s): ${fields}. Nothing was written.`,
      issues: absent.map((field) => ({
        pointer: `${pointerPrefix}/${field}`,
        message: "is required",
      })),
    };
  }
  if (source === undefined) {
    return invalid(
      `unknown source "${input.source?.trim() ?? ""}" (expected: ${RESEARCH_SOURCE_KINDS.join(", ")})`,
      `${pointerPrefix}/source`,
    );
  }
  const problem =
    conflict(source, input, origin, lists, reason) ??
    input.crops.map(cropProblem).find((message) => message !== null) ??
    null;
  if (problem !== null) return invalid(problem, pointerPrefix);
  const url = (input.url ?? "").trim();
  const file = (input.file ?? "").trim();
  const parsedOrigin = parseHttpUrl(origin);
  const redacted = parsedOrigin === null ? origin : redactUrl(parsedOrigin);
  const capture = ((): ValidReferenceInput["capture"] => {
    if (source === "url") return { kind: "url", url, allowLocal: input.allowLocal };
    if (source === "image") {
      return { kind: "image", file, method: input.screenshot ? "screenshot" : "file" };
    }
    if (source === "design-md") {
      return url === ""
        ? { kind: "design-md", file }
        : { kind: "design-md", url, allowLocal: input.allowLocal };
    }
    return { kind: source };
  })();
  return {
    ok: true,
    value: {
      source,
      origin: redacted === "" ? null : redacted,
      reason,
      ...lists,
      capture,
      crops: input.crops.map((crop) => ({ ...crop, note: crop.note.trim() })),
    },
  };
}

const filled = (items: readonly string[]): boolean => items.some((item) => item.trim() !== "");

/** RN-11 fields of a stored reference that are empty, in PROVENANCE_FIELDS order. */
export function missingProvenance(reference: ResearchReference): ProvenanceField[] {
  const present: Record<ProvenanceField, boolean> = {
    source: reference.source.trim() !== "",
    origin: reference.origin.trim() !== "",
    reason: reference.reason.trim() !== "",
    studies: filled(reference.studies),
    doNotCopy: filled(reference.doNotCopy),
    influences: filled(reference.influences),
  };
  return PROVENANCE_FIELDS.filter((field) => !present[field]);
}

/** Crops inside width x height (CROP_INVALID message on the first one outside). */
export function validateCrops(
  crops: readonly CropInput[],
  width: number,
  height: number,
): { ok: true } | { ok: false; message: string; issues: FindingIssue[] } {
  const index = crops.findIndex(
    (crop) => crop.x + crop.width > width || crop.y + crop.height > height,
  );
  const crop = crops[index];
  if (crop === undefined) return { ok: true };
  return {
    ok: false,
    message: `Crop ${index + 1} (${crop.x},${crop.y} ${crop.width}x${crop.height}) falls outside the ${width}x${height} image.`,
    issues: [{ pointer: `/crops/${index}`, message: "falls outside the image" }],
  };
}

/** Numeric part of a "PREFIX-n" id; 0 when malformed. */
const idNumber = (id: string): number => {
  const n = Number(id.slice(id.indexOf("-") + 1));
  return Number.isInteger(n) ? n : 0;
};

/** Items by the number of their id (REF-2 before REF-10). */
export function byIdNumber<T extends { id: string }>(items: readonly T[]): T[] {
  return items.toSorted((a, b) => idNumber(a.id) - idNumber(b.id));
}

/** `1 + max` of the numeric part of every id (removed ones included). */
export function nextNumber(ids: readonly string[]): number {
  return ids.reduce((max, id) => Math.max(max, idNumber(id)), 0) + 1;
}

export function nextReferenceId(references: readonly ResearchReference[]): ReferenceId {
  return `REF-${nextNumber(references.map((reference) => reference.id))}`;
}

/** DR2: reference-only if any active reference was captured in reference-only; full if all active were full; with no
 * active references, the current effective mode. */
export function researchMode(
  references: readonly ResearchReference[],
  current: HeronMode,
): HeronMode {
  const active = references.filter((reference) => reference.removed === null);
  if (active.length === 0) return current;
  return active.some((reference) => reference.mode === "reference-only")
    ? "reference-only"
    : "full";
}
