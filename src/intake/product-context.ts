import {
  FINDING_CODES,
  PRODUCT_CONTEXT_SECTIONS,
  type AdapterId,
  type Conflict,
  type ConflictKind,
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

/** Ids each defining source declares, taken from the unmerged candidates. Part acceptance ids are
 * not part of the draft, so every part maps to an empty set (T8 supplies them when it has them). */
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
    ? new Map(
        from("parts.json", ["traceability"])
          .flatMap((c) => (c.value as { parts: string[] }).parts)
          .map((id): [string, Set<string>] => [id, new Set()]),
      )
    : null;
  return {
    requirements,
    parts,
    decisions,
    masterActors: from("MASTER.md", ["actors"]).length > 0,
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
