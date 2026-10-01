import {
  RESEARCH_FACETS,
  type AgentRunRef,
  type BriefQuery,
  type FindingIssue,
  type HeronMode,
  type IsoDateTime,
  type QueryId,
  type ResearchBrief,
  type ResearchBriefOutput,
  type ResearchFacet,
} from "../core/contracts/index.ts";
import { sha256Hex } from "../core/store/hash.ts";

/** Words that say nothing about what the interface does; a query made only of these is rejected (R9, P3.A8). */
export const GENERIC_QUERY_TERMS: readonly string[] = [
  "beautiful",
  "modern",
  "clean",
  "nice",
  "pretty",
  "stunning",
  "sleek",
  "elegant",
  "cool",
  "awesome",
  "amazing",
  "great",
  "good",
  "best",
  "trendy",
  "aesthetic",
  "inspiration",
  "inspiring",
  "ui",
  "ux",
  "design",
  "designs",
  "interface",
  "app",
  "apps",
  "website",
  "web",
  "page",
  "pages",
];

export type QueryIssue = {
  code: "missing-facet" | "unknown-facet" | "generic-query" | "missing-job";
  message: string;
};

const FACET_LIST = RESEARCH_FACETS.join(", ");
const GENERIC = new Set(GENERIC_QUERY_TERMS);

const isFacet = (value: string): value is ResearchFacet =>
  (RESEARCH_FACETS as readonly string[]).includes(value);

/** True when the text has no word beyond GENERIC_QUERY_TERMS. Linear: one split on a single-class pattern. */
function onlyGeneric(text: string): boolean {
  const words = text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word !== "");
  return words.every((word) => GENERIC.has(word));
}

const genericIssue = (): QueryIssue => ({
  code: "generic-query",
  message:
    "the query has only generic terms; name what the interface does (for example screen-type:membership card)",
});

/** Pure. "<facet>:<text>" -> parsed query, or the first issue (missing facet, unknown facet, generic text). */
export function parseQueryFlag(raw: string): { facet: ResearchFacet; text: string } | QueryIssue {
  const cut = raw.indexOf(":");
  const facet = cut < 0 ? "" : raw.slice(0, cut).trim();
  const text = cut < 0 ? raw.trim() : raw.slice(cut + 1).trim();
  if (facet === "") {
    return {
      code: "missing-facet",
      message: `the query names no research facet; use <facet>:<text> with one of: ${FACET_LIST}`,
    };
  }
  if (!isFacet(facet)) {
    return {
      code: "unknown-facet",
      message: `unknown facet "${facet}"; expected one of: ${FACET_LIST}`,
    };
  }
  if (text === "" || onlyGeneric(text)) return genericIssue();
  return { facet, text };
}

/** Pure. Issues of one query in a stable order: facet, job, query text. */
export function validateResearchQuery(query: {
  facet: string | null;
  job: string;
  query: string;
}): QueryIssue[] {
  const issues: QueryIssue[] = [];
  const facet = query.facet?.trim() ?? "";
  if (facet === "") {
    issues.push({
      code: "missing-facet",
      message: `the query names no research facet; expected one of: ${FACET_LIST}`,
    });
  } else if (!isFacet(facet)) {
    issues.push({
      code: "unknown-facet",
      message: `unknown facet "${facet}"; expected one of: ${FACET_LIST}`,
    });
  }
  if (query.job.trim() === "") {
    issues.push({ code: "missing-job", message: "the query names no interface job" });
  }
  if (query.query.trim() === "" || onlyGeneric(query.query)) issues.push(genericIssue());
  return issues;
}

/** DR28: "Q-" + first 8 hex of sha256(facet + "\n" + lower-cased query). Stable across brief regenerations. */
export function queryId(facet: ResearchFacet, query: string): QueryId {
  const digest = sha256Hex(new TextEncoder().encode(`${facet}\n${query.trim().toLowerCase()}`));
  return `Q-${digest.slice(0, 8)}`;
}

const POINTER_FIELD: Record<QueryIssue["code"], string> = {
  "missing-facet": "facet",
  "unknown-facet": "facet",
  "missing-job": "job",
  "generic-query": "query",
};

/** Pure. Per query (pointer /queries/{i}/{field}); at least 3 distinct facets; unique ids. */
export function validateBriefOutput(output: ResearchBriefOutput): FindingIssue[] {
  const issues: FindingIssue[] = [];
  const seen = new Map<QueryId, number>();
  output.queries.forEach((entry, index) => {
    for (const issue of validateResearchQuery(entry)) {
      issues.push({
        pointer: `/queries/${index}/${POINTER_FIELD[issue.code]}`,
        message: issue.message,
      });
    }
    const id = queryId(entry.facet, entry.query);
    const first = seen.get(id);
    if (first === undefined) seen.set(id, index);
    else {
      issues.push({
        pointer: `/queries/${index}`,
        message: `duplicates the query at /queries/${first} (same facet and text)`,
      });
    }
  });
  const facets = new Set(output.queries.map((entry) => entry.facet));
  if (facets.size < 3) {
    issues.push({
      pointer: "/queries",
      message: `needs at least 3 distinct facets; got ${facets.size}`,
    });
  }
  return issues;
}

const byId = (a: BriefQuery, b: BriefQuery): number => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** Pure. DR27: provided = (resetQueries ? [] : previous provided) + new operator queries (dedupe by id); inferred =
 * the agent output (an inferred query repeating a provided id is dropped). Each group ordered by id. Operator queries
 * have no job of their own: the query text stands in for it; question and rationale are null. */
export function buildBrief(input: {
  previous: ResearchBrief | null;
  operator: readonly { facet: ResearchFacet; text: string }[];
  resetQueries: boolean;
  output: ResearchBriefOutput;
  mode: HeronMode;
  briefedAt: IsoDateTime;
  run: AgentRunRef;
}): ResearchBrief {
  const provided = new Map<QueryId, BriefQuery>();
  const kept = input.resetQueries
    ? []
    : (input.previous?.queries.filter((entry) => entry.origin === "provided") ?? []);
  for (const entry of kept) provided.set(entry.id, entry);
  for (const { facet, text } of input.operator) {
    const id = queryId(facet, text);
    if (provided.has(id)) continue;
    provided.set(id, {
      id,
      facet,
      job: text.trim(),
      query: text.trim(),
      question: null,
      rationale: null,
      origin: "provided",
    });
  }
  const inferred = new Map<QueryId, BriefQuery>();
  for (const entry of input.output.queries) {
    const id = queryId(entry.facet, entry.query);
    if (provided.has(id) || inferred.has(id)) continue;
    inferred.set(id, {
      id,
      facet: entry.facet,
      job: entry.job,
      query: entry.query,
      question: entry.question,
      rationale: entry.rationale,
      origin: "inferred",
    });
  }
  return {
    kind: "ResearchBrief",
    schemaVersion: 1,
    mode: input.mode,
    briefedAt: input.briefedAt,
    run: input.run,
    queries: [...[...provided.values()].toSorted(byId), ...[...inferred.values()].toSorted(byId)],
  };
}
