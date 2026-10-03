import type { z } from "zod";
import { toJsonPointer, type FindingIssue } from "./common.ts";

export const DOCUMENT_KINDS = [
  "HeronProject",
  "HeronState",
  "ModeDecision",
  "CliEnvelope",
  "ResearchReferences",
  "ResearchProvenance",
  "BrandInputs",
  "ReferenceBatch",
  "ProductContext",
  "IntakeConflicts",
  "ManualContext",
  "AgentRun",
  "ResearchBrief",
  "ResearchAnalysis",
  "VisualDirections",
  "PenpotSyncState",
] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

export interface DocumentSpec<T> {
  readonly kind: DocumentKind;
  readonly schemaVersion: number; // supported (and written) version
  readonly schema: z.ZodType<T>;
  readonly schemaFile: string; // e.g. "heron-state.v1.schema.json"
}

export class UnsupportedSchemaVersionError extends Error {
  readonly file: string;
  readonly kind: DocumentKind;
  readonly found: number;
  readonly supported: number;
  constructor(file: string, kind: DocumentKind, found: number, supported: number) {
    super(formatUnsupportedVersionMessage(file, kind, found, supported));
    this.name = "UnsupportedSchemaVersionError";
    this.file = file;
    this.kind = kind;
    this.found = found;
    this.supported = supported;
  }
}

export class InvalidDocumentError extends Error {
  readonly file: string;
  readonly kind: DocumentKind;
  readonly issues: FindingIssue[];
  constructor(file: string, kind: DocumentKind, issues: FindingIssue[]) {
    const first = issues[0];
    super(`${file}: invalid ${kind}${first ? ` (${first.pointer || "/"}: ${first.message})` : ""}`);
    this.name = "InvalidDocumentError";
    this.file = file;
    this.kind = kind;
    this.issues = issues;
  }
}

function sortIssues(issues: FindingIssue[]): FindingIssue[] {
  return issues.toSorted(
    (a, b) =>
      (a.pointer < b.pointer ? -1 : a.pointer > b.pointer ? 1 : 0) ||
      (a.message < b.message ? -1 : a.message > b.message ? 1 : 0),
  );
}

/** Order: object with `kind` equal to spec.kind -> integer `schemaVersion` -> version gate -> Zod parse.
 * found > supported throws UnsupportedSchemaVersionError; any other problem throws InvalidDocumentError. */
export function parseVersionedDocument<T>(raw: unknown, spec: DocumentSpec<T>, file: string): T {
  const fail = (pointer: string, message: string): never => {
    throw new InvalidDocumentError(file, spec.kind, [{ pointer, message }]);
  };
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return fail("", "expected a JSON object");
  }
  const obj = raw as Record<string, unknown>;
  if (obj["kind"] !== spec.kind) return fail("/kind", `expected "${spec.kind}"`);
  const version = obj["schemaVersion"];
  if (typeof version !== "number" || !Number.isInteger(version)) {
    return fail("/schemaVersion", "expected an integer");
  }
  if (version > spec.schemaVersion) {
    throw new UnsupportedSchemaVersionError(file, spec.kind, version, spec.schemaVersion);
  }
  const result = spec.schema.safeParse(raw);
  if (!result.success) {
    throw new InvalidDocumentError(
      file,
      spec.kind,
      sortIssues(
        result.error.issues.map((i) => ({ pointer: toJsonPointer(i.path), message: i.message })),
      ),
    );
  }
  return result.data;
}

/** Exact text: `${file}: ${kind} schemaVersion ${found} is not supported; this Heron supports schemaVersion ${supported}. Upgrade Heron to read this file.` */
export function formatUnsupportedVersionMessage(
  file: string,
  kind: DocumentKind,
  found: number,
  supported: number,
): string {
  return `${file}: ${kind} schemaVersion ${found} is not supported; this Heron supports schemaVersion ${supported}. Upgrade Heron to read this file.`;
}
