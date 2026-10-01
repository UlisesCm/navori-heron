import {
  BRAND_KINDS,
  BRAND_ORIGINS,
  ReferenceIdSchema,
  type BrandInput,
  type BrandInputDraft,
  type BrandInputId,
  type BrandKind,
  type BrandOrigin,
  type FindingIssue,
  type ReferenceId,
} from "../core/contracts/index.ts";
import { nextNumber } from "./provenance.ts";

export type ValidBrandInput = {
  kind: BrandKind;
  origin: BrandOrigin;
  value: string;
  note: string | null;
  derivedFrom: ReferenceId | null;
  file: string | null;
};
const MAX_TEXT = 2000;

const text = (value: string | null): string => (value ?? "").trim();
const fail = (message: string, issues: FindingIssue[]) => ({ ok: false as const, message, issues });

function invalid(detail: string, field: string) {
  return fail(`Invalid brand input: ${detail}. Nothing was written.`, [
    { pointer: `/${field}`, message: detail },
  ]);
}

/** Pure. Missing kind/origin/value -> "missing required field(s)"; unknown kind/origin, --reference without
 * reference-derived, reference-derived without --reference (or with a malformed id) and oversize text -> invalid.
 * Both are BRAND_INPUT_INVALID with the full catalogue message. */
export function validateBrandInput(
  draft: BrandInputDraft,
): { ok: true; value: ValidBrandInput } | { ok: false; message: string; issues: FindingIssue[] } {
  const absent: [string, string][] = [];
  if (text(draft.kind) === "") absent.push(["kind", "--kind"]);
  if (text(draft.origin) === "") {
    absent.push([
      "origin",
      `--origin ${BRAND_ORIGINS.slice(0, -1).join(", ")} or ${BRAND_ORIGINS.at(-1)}`,
    ]);
  }
  if (text(draft.value) === "") absent.push(["value", "--value"]);
  if (absent.length > 0) {
    return fail(
      `Brand input is missing required field(s): ${absent.map(([field, flag]) => `${field} (${flag})`).join(", ")}. Nothing was written.`,
      absent.map(([field]) => ({ pointer: `/${field}`, message: "is required" })),
    );
  }
  const kind = BRAND_KINDS.find((candidate) => candidate === text(draft.kind));
  if (kind === undefined) {
    return invalid(
      `unknown kind "${text(draft.kind)}" (expected: ${BRAND_KINDS.join(", ")})`,
      "kind",
    );
  }
  const origin = BRAND_ORIGINS.find((candidate) => candidate === text(draft.origin));
  if (origin === undefined) {
    return invalid(
      `unknown origin "${text(draft.origin)}" (expected: ${BRAND_ORIGINS.join(", ")})`,
      "origin",
    );
  }
  const value = text(draft.value);
  const note = text(draft.note);
  if (value.length > MAX_TEXT || note.length > MAX_TEXT) {
    return invalid(`value and note are limited to ${MAX_TEXT} characters`, "value");
  }
  const reference = text(draft.reference);
  if (origin === "reference-derived" && reference === "") {
    return invalid("origin reference-derived needs --reference", "reference");
  }
  if (origin !== "reference-derived" && reference !== "") {
    return invalid("--reference only applies to origin reference-derived", "reference");
  }
  if (reference !== "" && !ReferenceIdSchema.safeParse(reference).success) {
    return invalid(`"${reference}" is not a reference id such as REF-1`, "reference");
  }
  const file = text(draft.file);
  return {
    ok: true,
    value: {
      kind,
      origin,
      value,
      note: note === "" ? null : note,
      derivedFrom: reference === "" ? null : reference,
      file: file === "" ? null : file,
    },
  };
}

export function nextBrandInputId(inputs: readonly BrandInput[]): BrandInputId {
  return `BRAND-${nextNumber(inputs.map((input) => input.id))}`;
}
