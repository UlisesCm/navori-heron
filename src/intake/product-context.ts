import {
  FINDING_CODES,
  PRODUCT_CONTEXT_SECTIONS,
  type AdapterId,
  type Conflict,
  type ConflictKind,
  type IntakeConflicts,
  type SourceRef,
  type HeronMode,
  type ProductContext,
  type ProductContextCounts,
  type ProductContextSection,
  type SourceKind,
  type StageSelection,
} from "../core/contracts/index.ts";
import { mergeCandidates, type ValueMismatch } from "./precedence.ts";
import type { Candidate, ContextDraft } from "./ports.ts";
import { compareText } from "./text.ts";

export type BuildMeta = {
  adapter: AdapterId;
  mode: HeronMode;
  stage: { dir: string; selection: StageSelection } | null;
};
/** `null` = the defining source is absent (checks are skipped with REFERENCES_NOT_CHECKED). */
export type DefinedIds = {
  requirements: Set<string> | null;
  parts: Map<string, Set<string>> | null;
  decisions: Set<string> | null;
  masterActors: boolean;
  /** Actors `ux.json` declares, including those the merge skipped for lacking a `MASTER.md` pair. */
  uxActors: { id: string; name: string; ref: SourceRef }[];
};
export type DetectedConflict = Omit<Conflict, "id" | "status" | "ack" | "kind"> & {
  kind: ConflictKind;
};

const findingOrder = (code: string): number => FINDING_CODES.findIndex((c) => c === code);

const REQUIREMENT_SECTIONS: readonly ProductContextSection[] = [
  "businessRules",
  "functionalRequirements",
  "nonFunctionalRequirements",
];

function present(draft: ContextDraft, source: SourceKind): boolean {
  return draft.sources.some(
    (record) => record.source === source && (record.status === "used" || record.status === "read"),
  );
}

function idOf(candidate: Candidate): string | null {
  const id = (candidate.value as { id?: unknown }).id;
  return typeof id === "string" ? id : null;
}

/** Ids each defining source declares, taken from the unmerged candidates. Parts and their criterion
 * ids (`P<n>.A<m>`) come from `draft.parts`; parts only cited by traceability map to an empty set. */
function definedIds(draft: ContextDraft): DefinedIds {
  const from = (source: SourceKind, sections: readonly ProductContextSection[]): Candidate[] =>
    draft.candidates.filter((c) => c.ref.source === source && sections.includes(c.section));
  const requirements = present(draft, "MASTER.md")
    ? new Set(
        from("MASTER.md", REQUIREMENT_SECTIONS)
          .map(idOf)
          .filter((id): id is string => id !== null),
      )
    : null;
  const decisions = present(draft, "DECISIONS.md")
    ? new Set(from("DECISIONS.md", ["decisions"]).map((c) => c.key))
    : null;
  const parts = present(draft, "parts.json")
    ? new Map<string, Set<string>>([
        ...from("parts.json", ["traceability"])
          .flatMap((c) => (c.value as { parts: string[] }).parts)
          .map((id): [string, Set<string>] => [id, new Set()]),
        ...(draft.parts ?? []).map((part): [string, Set<string>] => [
          part.id,
          new Set(part.criteria.map((criterion) => `${part.id}.${criterion}`)),
        ]),
      ])
    : null;
  return {
    requirements,
    parts,
    decisions,
    masterActors: from("MASTER.md", ["actors"]).length > 0,
    uxActors: from("ux.json", ["actors"]).flatMap((c) => {
      const value = c.value as { id?: unknown; name?: unknown };
      return typeof value.id === "string"
        ? [
            {
              id: value.id,
              name: typeof value.name === "string" ? value.name : value.id,
              ref: c.ref,
            },
          ]
        : [];
    }),
  };
}

/** Builds the 19 sections from a draft: precedence merge (RN-7), mismatches for conflict detection
 * and the ids each defining source declares. Pure and deterministic. */
export function buildProductContext(
  draft: ContextDraft,
  meta: BuildMeta,
): {
  context: ProductContext;
  mismatches: ValueMismatch[];
  defined: DefinedIds;
} {
  const { merged, mismatches, findings } = mergeCandidates(
    draft.candidates,
    draft.sources.map((record) => record.path),
  );
  const sections = Object.fromEntries(
    PRODUCT_CONTEXT_SECTIONS.map((section) => [section, [] as unknown[]]),
  ) as Record<ProductContextSection, unknown[]>;
  for (const element of merged) {
    sections[element.section].push({
      ...element.value,
      sourceRef: element.sourceRef,
      alsoIn: element.alsoIn,
      conflicts: [],
    });
  }
  const all = [...draft.findings, ...findings];
  const stored = all.toSorted(
    (a, b) =>
      findingOrder(a.code) - findingOrder(b.code) ||
      compareText(a.paths[0] ?? "", b.paths[0] ?? "") ||
      compareText(a.message, b.message),
  );
  // The per-section arrays hold elements built from typed candidates; the map type cannot say so.
  const context = {
    kind: "ProductContext",
    schemaVersion: 1,
    metadata: {
      adapter: meta.adapter,
      mode: meta.mode,
      stage: meta.stage,
      uxReader: draft.uxReader,
      sources: draft.sources,
      uxExtensions: draft.uxExtensions,
      findings: stored,
    },
    ...sections,
  } as ProductContext;
  return { context, mismatches, defined: definedIds(draft) };
}

/** Number of elements in each of the 19 sections. */
export function countSections(context: ProductContext): ProductContextCounts {
  return Object.fromEntries(
    PRODUCT_CONTEXT_SECTIONS.map((section) => [section, context[section].length]),
  ) as ProductContextCounts;
}

/** Stable identifier of an element inside its section: the id, else the key, name, requirement or text. */
export function elementKey(element: ProductContext[ProductContextSection][number]): string {
  const fields = element as Record<string, unknown>;
  for (const field of ["id", "key", "name", "requirement", "text"]) {
    const value = fields[field];
    if (typeof value === "string" && value !== "") return value;
  }
  return "";
}

/** Sets each element's `conflicts` to the ids of the open conflicts whose impact names it (sorted). */
export function withConflictIds(
  context: ProductContext,
  conflicts: IntakeConflicts,
): ProductContext {
  const open = conflicts.conflicts.filter((conflict) => conflict.status === "open");
  const sections = Object.fromEntries(
    PRODUCT_CONTEXT_SECTIONS.map((section) => [
      section,
      (context[section] as readonly { conflicts: string[] }[]).map((element) => {
        const at = `${section}/${elementKey(element as ProductContext[typeof section][number])}`;
        const ids = open
          .filter((conflict) => conflict.impact.includes(at))
          .map((conflict) => conflict.id)
          .toSorted(compareText);
        return { ...element, conflicts: ids };
      }),
    ]),
  );
  // Each section keeps its own element type; the map above only rewrites `conflicts`.
  return { ...context, ...sections } as ProductContext;
}
