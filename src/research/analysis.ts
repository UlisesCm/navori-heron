import {
  canonicalJson,
  type AgentRunRef,
  type FindingIssue,
  type HeronMode,
  type IsoDateTime,
  type QueryId,
  type ReferenceAnalysis,
  type ReferenceId,
  type ResearchAnalysis,
  type ResearchAnalysisOutput,
  type ResearchReference,
  type Sha256Hex,
} from "../core/contracts/index.ts";
import { sha256Hex } from "../core/store/hash.ts";
import { byIdNumber } from "./provenance.ts";

/** DR2: sha256 of the canonical JSON of the reference without `removed` (removal does not change what was analyzed). */
export function referenceDigest(reference: ResearchReference): Sha256Hex {
  const { removed: _removed, ...rest } = reference;
  return sha256Hex(new TextEncoder().encode(canonicalJson(rest)));
}

const isFresh = (entry: ReferenceAnalysis | undefined, reference: ResearchReference): boolean =>
  entry !== undefined && entry.referenceSha256 === referenceDigest(reference);

/** Pure. DR39: only active references whose digest is not already freshly analyzed go in `ids`; `fresh` lists the
 * requested (or all active, when `requested` is empty) ones that are up to date; `unknown` are requested ids that match
 * no active reference. A second identical run therefore yields `ids: []`. Ordered by id number, no duplicates. */
export function referencesToAnalyze(
  references: readonly ResearchReference[],
  analysis: ResearchAnalysis | null,
  requested: readonly string[],
): { ids: ReferenceId[]; unknown: string[]; fresh: ReferenceId[] } {
  const active = byIdNumber(references.filter((reference) => reference.removed === null));
  const activeIds = new Set<string>(active.map((reference) => reference.id));
  const wanted = new Set(requested.map((id) => id.trim()));
  const unknown = [...wanted].filter((id) => !activeIds.has(id));
  const targets =
    requested.length === 0 ? active : active.filter((reference) => wanted.has(reference.id));
  const stored = new Map(analysis?.analyses.map((entry) => [entry.reference, entry]));
  const ids: ReferenceId[] = [];
  const fresh: ReferenceId[] = [];
  for (const reference of targets) {
    (isFresh(stored.get(reference.id), reference) ? fresh : ids).push(reference.id);
  }
  return { ids, unknown, fresh };
}

/** Pure. The output covers exactly the expected references once each, facets are unique and `answersQueries` only
 * names ids of the current brief. */
export function validateAnalysisOutput(
  output: ResearchAnalysisOutput,
  expected: readonly ReferenceId[],
  queryIds: readonly QueryId[],
): FindingIssue[] {
  const issues: FindingIssue[] = [];
  const wanted = new Set<string>(expected);
  const known = new Set<string>(queryIds);
  const seen = new Set<string>();
  output.analyses.forEach((entry, index) => {
    const at = `/analyses/${index}`;
    if (!wanted.has(entry.reference)) {
      issues.push({ pointer: `${at}/reference`, message: `${entry.reference} was not requested` });
    } else if (seen.has(entry.reference)) {
      issues.push({
        pointer: `${at}/reference`,
        message: `${entry.reference} is analyzed more than once`,
      });
    }
    seen.add(entry.reference);
    if (new Set(entry.facets).size !== entry.facets.length) {
      issues.push({ pointer: `${at}/facets`, message: "facets must be unique" });
    }
    entry.answersQueries.forEach((id, position) => {
      if (!known.has(id)) {
        issues.push({
          pointer: `${at}/answersQueries/${position}`,
          message: `${id} is not a query of the current brief`,
        });
      }
    });
  });
  for (const id of expected) {
    if (!seen.has(id))
      issues.push({ pointer: "/analyses", message: `${id} is missing from the output` });
  }
  return issues;
}

/** Pure. Previous entries stay unless the output replaces them or their reference is gone or removed; new entries carry
 * the reference digest and `inputKeys[id]` (analysisInputKey, computed by the caller: this module cannot import agents).
 * Ordered by reference id number. */
export function mergeAnalysis(
  previous: ResearchAnalysis | null,
  output: ResearchAnalysisOutput,
  meta: {
    references: readonly ResearchReference[];
    inputKeys: Readonly<Record<string, Sha256Hex>>;
    mode: HeronMode;
    analyzedAt: IsoDateTime;
    run: AgentRunRef;
  },
): ResearchAnalysis {
  const active = new Map(
    meta.references
      .filter((reference) => reference.removed === null)
      .map((reference) => [reference.id, reference]),
  );
  const merged = new Map<string, ReferenceAnalysis>();
  for (const entry of previous?.analyses ?? []) {
    if (active.has(entry.reference)) merged.set(entry.reference, entry);
  }
  for (const entry of output.analyses) {
    const reference = active.get(entry.reference);
    const inputKey = meta.inputKeys[entry.reference];
    if (reference === undefined || inputKey === undefined) continue;
    merged.set(entry.reference, {
      ...entry,
      referenceSha256: referenceDigest(reference),
      inputKey,
      analyzedAt: meta.analyzedAt,
      run: meta.run,
      origin: "inferred",
    });
  }
  return {
    kind: "ResearchAnalysis",
    schemaVersion: 1,
    mode: meta.mode,
    analyses: byIdNumber([...active.values()]).flatMap(
      (reference) => merged.get(reference.id) ?? [],
    ),
  };
}

/** Pure. Notes whose reference is still active and unchanged (same digest); edited or removed references drop out. */
export function freshAnalyses(
  analysis: ResearchAnalysis | null,
  references: readonly ResearchReference[],
): ReferenceAnalysis[] {
  const active = new Map(
    references
      .filter((reference) => reference.removed === null)
      .map((reference) => [reference.id, reference]),
  );
  return (analysis?.analyses ?? []).filter((entry) => {
    const reference = active.get(entry.reference);
    return reference !== undefined && isFresh(entry, reference);
  });
}
