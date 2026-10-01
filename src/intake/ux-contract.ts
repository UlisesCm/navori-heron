import { z } from "zod";
import {
  toJsonPointer,
  type Finding,
  type FindingIssue,
  type UxFileCheck,
  type UxJsonCheck,
  type UxSummary,
} from "../core/contracts/index.ts";
import type { ReadonlyFs } from "../core/store/fs-port.ts";
import type { InputLimits } from "./ports.ts";
import { decodeUtf8, probeFile, type FileProbe } from "./probe.ts";

// PROVISIONAL (D5): mirrors only the minimal ids and relations of the harness draft ux.json.
// Replaced by the pinned harness schema in P11; unknown fields are tolerated and preserved.
export const UX_CONTRACT_READER = "provisional-1" as const;
export type UxReaderId = typeof UX_CONTRACT_READER;
export const SUPPORTED_UX_SCHEMA_VERSION = 1 as const;

export type UxSurfaceRef = { id: string; name?: string | undefined; [key: string]: unknown };
export type UxScreenRef = { id: string; surface: string; [key: string]: unknown };
export type UxFlowRef = { id: string; screens: string[]; [key: string]: unknown };
export type UxPatternRef = { id: string; screens: string[]; [key: string]: unknown };
export type UxContract = {
  schemaVersion: 1;
  masterStage?: string | undefined;
  surfaces: UxSurfaceRef[];
  screens: UxScreenRef[];
  flows: UxFlowRef[];
  patterns: UxPatternRef[];
  [key: string]: unknown;
};

const id = z.string().min(1);
const shape = z.looseObject({
  schemaVersion: z.literal(SUPPORTED_UX_SCHEMA_VERSION),
  masterStage: z.string().optional(),
  surfaces: z.array(z.looseObject({ id, name: z.string().optional() })).min(1),
  screens: z.array(z.looseObject({ id, surface: z.string() })).min(1),
  flows: z.array(z.looseObject({ id, screens: z.array(z.string()) })).min(1),
  patterns: z.array(z.looseObject({ id, screens: z.array(z.string()) })),
});

type Loose = Record<string, unknown>;
const isRecord = (v: unknown): v is Loose =>
  typeof v === "object" && v !== null && !Array.isArray(v);

function entries(raw: Loose, key: string): { index: number; item: Loose }[] {
  const list = raw[key];
  if (!Array.isArray(list)) return [];
  return list.flatMap((item: unknown, index) => (isRecord(item) ? [{ index, item }] : []));
}

function ids(raw: Loose, key: string): Set<string> {
  return new Set(
    entries(raw, key).flatMap(({ item }) => (typeof item.id === "string" ? [item.id] : [])),
  );
}

/** Relation checks over the raw value; tolerant of malformed parts, which the shape pass reports. */
function relationIssues(raw: Loose, expectedStage: string | null): FindingIssue[] {
  const issues: FindingIssue[] = [];
  for (const key of ["surfaces", "screens", "flows", "patterns"]) {
    const seen = new Set<string>();
    for (const { index, item } of entries(raw, key)) {
      if (typeof item.id !== "string") continue;
      if (seen.has(item.id)) {
        issues.push({
          pointer: toJsonPointer([key, index, "id"]),
          message: `duplicate ${key} id "${item.id}"`,
        });
      }
      seen.add(item.id);
    }
  }
  const surfaces = ids(raw, "surfaces");
  const screens = ids(raw, "screens");
  for (const { index, item } of entries(raw, "screens")) {
    if (typeof item.surface === "string" && !surfaces.has(item.surface)) {
      issues.push({
        pointer: toJsonPointer(["screens", index, "surface"]),
        message: `surface "${item.surface}" is not declared in surfaces`,
      });
    }
  }
  for (const key of ["flows", "patterns"]) {
    for (const { index, item } of entries(raw, key)) {
      if (!Array.isArray(item.screens)) continue;
      item.screens.forEach((screen: unknown, at: number) => {
        if (typeof screen === "string" && !screens.has(screen)) {
          issues.push({
            pointer: toJsonPointer([key, index, "screens", at]),
            message: `screen "${screen}" is not declared in screens`,
          });
        }
      });
    }
  }
  if (
    expectedStage !== null &&
    typeof raw.masterStage === "string" &&
    raw.masterStage !== expectedStage
  ) {
    issues.push({
      pointer: "/masterStage",
      message: `masterStage "${raw.masterStage}" does not match the selected stage "${expectedStage}"`,
    });
  }
  return issues;
}

/** Shape plus relations (without the stage check, which needs the selected stage). */
export const UxContractSchema: z.ZodType<UxContract> = shape.superRefine((value, ctx) => {
  for (const issue of relationIssues(value, null)) {
    ctx.addIssue({
      code: "custom",
      message: issue.message,
      path: issue.pointer.split("/").slice(1),
    });
  }
});

export type UxContractReadResult =
  | { ok: true; contract: UxContract; summary: UxSummary }
  | { ok: false; issues: FindingIssue[] };

const byPointer = (a: FindingIssue, b: FindingIssue): number =>
  a.pointer < b.pointer
    ? -1
    : a.pointer > b.pointer
      ? 1
      : a.message < b.message
        ? -1
        : a.message > b.message
          ? 1
          : 0;

function fail(issues: FindingIssue[]): { ok: false; issues: FindingIssue[] } {
  const unique = new Map(issues.map((i) => [`${i.pointer}\u0000${i.message}`, i]));
  return { ok: false, issues: [...unique.values()].toSorted(byPointer) };
}

/** Fatal UTF-8 decode -> JSON.parse -> schemaVersion gate -> shape -> relations (unique ids per kind,
 * screen.surface declared, flow/pattern screens declared, masterStage equal to expectedStage when both exist). */
export function readUxContract(
  bytes: Uint8Array,
  options: { expectedStage: string | null },
): UxContractReadResult {
  const text = decodeUtf8(bytes);
  if (text === null) return fail([{ pointer: "", message: "file is not valid UTF-8" }]);
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return fail([{ pointer: "", message: `file is not valid JSON: ${detail}` }]);
  }
  if (!isRecord(raw)) return fail([{ pointer: "", message: "expected a JSON object" }]);
  const version = raw.schemaVersion;
  if (typeof version === "number" && version !== SUPPORTED_UX_SCHEMA_VERSION) {
    return fail([
      {
        pointer: "/schemaVersion",
        message: `schemaVersion ${version} is not supported; Heron reads ux.json schemaVersion ${SUPPORTED_UX_SCHEMA_VERSION}`,
      },
    ]);
  }
  const parsed = shape.safeParse(raw);
  const issues = relationIssues(raw, options.expectedStage);
  if (!parsed.success) {
    issues.push(
      ...parsed.error.issues.map((issue) => ({
        pointer: toJsonPointer(issue.path),
        message: issue.message,
      })),
    );
  }
  if (!parsed.success || issues.length > 0) return fail(issues);
  const contract: UxContract = parsed.data;
  return {
    ok: true,
    contract,
    summary: {
      surfaces: contract.surfaces.map((s) => s.id),
      screens: contract.screens.length,
      flows: contract.flows.length,
      patterns: contract.patterns.length,
    },
  };
}

/** Switchable ux.json reader (DR10): P11 adds one backed by the pinned harness schema. */
export type UxReader = {
  readonly id: UxReaderId;
  read(bytes: Uint8Array, options: { expectedStage: string | null }): UxContractReadResult;
};
export const PROVISIONAL_UX_READER: UxReader = { id: UX_CONTRACT_READER, read: readUxContract };
/** The single switch point: every consumer reads ux.json through this reader. */
export const ACTIVE_UX_READER: UxReader = PROVISIONAL_UX_READER;

export type UxMarkdownReadResult = { ok: true } | { ok: false; issues: FindingIssue[] };

/** Valid iff fatal UTF-8 decode succeeds and the text has >= 1 non-whitespace character (R5). */
export function readUxMarkdown(bytes: Uint8Array): UxMarkdownReadResult {
  const text = decodeUtf8(bytes);
  if (text === null)
    return { ok: false, issues: [{ pointer: "", message: "file is not valid UTF-8" }] };
  if (text.trim().length === 0) {
    return { ok: false, issues: [{ pointer: "", message: "file has no non-whitespace content" }] };
  }
  return { ok: true };
}

function baseCheck(probe: FileProbe): UxFileCheck {
  return {
    path: probe.path,
    present: probe.present,
    valid: null,
    sha256: probe.sha256,
    issues: [],
  };
}

/** Probes and validates both UX files. Only probe findings (UNSAFE_PATH, INPUT_TOO_LARGE) are returned:
 * validity is reported through `valid`/`issues` and turned into UX_CONTRACT_INVALID by detectMode. */
export function checkUxFiles(
  fs: ReadonlyFs,
  root: string,
  paths: { markdown: string; json: string },
  expectedStage: string | null,
  limits: InputLimits,
): { uxMarkdown: UxFileCheck; uxJson: UxJsonCheck; findings: Finding[] } {
  const mdProbe = probeFile(fs, root, paths.markdown, limits);
  const jsonProbe = probeFile(fs, root, paths.json, limits);
  const uxMarkdown = baseCheck(mdProbe);
  const uxJson: UxJsonCheck = {
    ...baseCheck(jsonProbe),
    reader: ACTIVE_UX_READER.id,
    summary: null,
  };
  if (mdProbe.bytes !== null) {
    const result = readUxMarkdown(mdProbe.bytes);
    uxMarkdown.valid = result.ok;
    if (!result.ok) uxMarkdown.issues = result.issues;
  }
  if (jsonProbe.bytes !== null) {
    const result = ACTIVE_UX_READER.read(jsonProbe.bytes, { expectedStage });
    uxJson.valid = result.ok;
    if (result.ok) uxJson.summary = result.summary;
    else uxJson.issues = result.issues;
  }
  const findings = [mdProbe.finding, jsonProbe.finding].filter((f): f is Finding => f !== null);
  return { uxMarkdown, uxJson, findings };
}
