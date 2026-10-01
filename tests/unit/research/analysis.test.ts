// Covers: R10
import { describe, expect, test } from "bun:test";
import type {
  AgentRunRef,
  ResearchAnalysis,
  ResearchAnalysisOutput,
  ResearchReference,
} from "../../../src/core/contracts/index.ts";
import {
  freshAnalyses,
  mergeAnalysis,
  referenceDigest,
  referencesToAnalyze,
  validateAnalysisOutput,
} from "../../../src/research/analysis.ts";
import { sampleReference } from "../../helpers/research.ts";

const run = { runId: "run-1" } as unknown as AgentRunRef;
const entry = (reference: string): ResearchAnalysisOutput["analyses"][number] => ({
  reference,
  observations: [{ aspect: "density", note: "calm" }],
  facets: ["density"],
  suggestedDoNotCopy: [],
  answersQueries: [],
});
const merge = (previous: ResearchAnalysis | null, ids: string[], references: ResearchReference[]) =>
  mergeAnalysis(
    previous,
    { analyses: ids.map(entry) },
    {
      references,
      inputKeys: Object.fromEntries(ids.map((id) => [id, "c".repeat(64)])),
      mode: "reference-only",
      analyzedAt: "2026-10-01T00:00:00.000Z",
      run,
    },
  );

describe("research analysis", () => {
  const refs = [
    sampleReference({ id: "REF-1" }),
    sampleReference({ id: "REF-10" }),
    sampleReference({ id: "REF-2" }),
  ];

  // Covers: R10
  test("tracks analysis freshness by reference digest", () => {
    expect(referencesToAnalyze(refs, null, []).ids).toEqual(["REF-1", "REF-2", "REF-10"]);
    const stored = merge(null, ["REF-1", "REF-2", "REF-10"], refs);
    // a second identical run analyzes nothing (DR39)
    expect(referencesToAnalyze(refs, stored, [])).toEqual({
      ids: [],
      unknown: [],
      fresh: ["REF-1", "REF-2", "REF-10"],
    });
    expect(freshAnalyses(stored, refs)).toHaveLength(3);
    // edited reference: stale, re-analyzed, its note leaves the fresh set
    const edited = refs.map((r) => (r.id === "REF-2" ? { ...r, reason: "changed" } : r));
    expect(referenceDigest(edited[2]!)).not.toBe(referenceDigest(refs[2]!));
    expect(referencesToAnalyze(edited, stored, []).ids).toEqual(["REF-2"]);
    expect(freshAnalyses(stored, edited).map((a) => a.reference)).toEqual(["REF-1", "REF-10"]);
    // removed reference: ignored; `removed` itself does not alter the digest
    const removed = refs.map((r) =>
      r.id === "REF-1" ? { ...r, removed: { removedAt: "2026-10-01T00:00:00.000Z" } as never } : r,
    );
    expect(referenceDigest(removed[0]!)).toBe(referenceDigest(refs[0]!));
    expect(freshAnalyses(stored, removed).map((a) => a.reference)).toEqual(["REF-2", "REF-10"]);
    expect(referencesToAnalyze(removed, stored, ["REF-1", "REF-9"])).toEqual({
      ids: [],
      unknown: ["REF-1", "REF-9"],
      fresh: [],
    });
    // requested subset, deduplicated and ordered by number
    expect(referencesToAnalyze(refs, null, ["REF-10", "REF-1", "REF-10"]).ids).toEqual([
      "REF-1",
      "REF-10",
    ]);
  });

  test("validates the output against expected references and current queries", () => {
    expect(validateAnalysisOutput({ analyses: [entry("REF-1")] }, ["REF-1"], [])).toEqual([]);
    const bad: ResearchAnalysisOutput = {
      analyses: [
        { ...entry("REF-1"), facets: ["flow", "flow"], answersQueries: ["Q-00000000"] },
        entry("REF-1"),
        entry("REF-7"),
      ],
    };
    expect(validateAnalysisOutput(bad, ["REF-1", "REF-2"], []).map((i) => i.pointer)).toEqual([
      "/analyses/0/facets",
      "/analyses/0/answersQueries/0",
      "/analyses/1/reference",
      "/analyses/2/reference",
      "/analyses",
    ]);
  });

  test("merges new notes over previous ones and drops removed references", () => {
    const first = merge(null, ["REF-1"], refs);
    expect(first.analyses[0]).toMatchObject({
      origin: "inferred",
      referenceSha256: referenceDigest(refs[0]!),
    });
    const second = merge(first, ["REF-2"], refs);
    expect(second.analyses.map((a) => a.reference)).toEqual(["REF-1", "REF-2"]);
    const gone = merge(second, [], [refs[2]!]);
    expect(gone.analyses.map((a) => a.reference)).toEqual(["REF-2"]);
  });
});
