// Covers: R9
import { describe, expect, test } from "bun:test";
import type {
  AgentRunRef,
  ResearchBrief,
  ResearchBriefOutput,
} from "../../../src/core/contracts/index.ts";
import {
  GENERIC_QUERY_TERMS,
  buildBrief,
  parseQueryFlag,
  queryId,
  validateBriefOutput,
  validateResearchQuery,
} from "../../../src/research/brief.ts";

const run = { runId: "run-1" } as unknown as AgentRunRef;

const output = (): ResearchBriefOutput => ({
  queries: [
    { facet: "screen-type", query: "membership card" },
    { facet: "flow", query: "QR redemption" },
    { facet: "ui-element", query: "stamp progress" },
  ].map(({ facet, query }) => ({
    facet: facet as "flow",
    job: `show ${query}`,
    query,
    question: "q",
    rationale: "r",
  })),
});

const build = (
  previous: ResearchBrief | null,
  over: Partial<Parameters<typeof buildBrief>[0]> = {},
) =>
  buildBrief({
    previous,
    operator: [],
    resetQueries: false,
    output: output(),
    mode: "reference-only",
    briefedAt: "2026-10-01T00:00:00.000Z",
    run,
    ...over,
  });

describe("research brief", () => {
  // Covers: R9
  test("rejects research queries without an interface-job facet", () => {
    expect(parseQueryFlag("beautiful UI")).toMatchObject({ code: "missing-facet" });
    expect(parseQueryFlag("mood:calm")).toMatchObject({ code: "unknown-facet" });
    expect(parseQueryFlag("screen-type:beautiful modern UI")).toMatchObject({
      code: "generic-query",
    });
    expect(parseQueryFlag("screen-type: ")).toMatchObject({ code: "generic-query" });
    expect(parseQueryFlag("screen-type:membership card")).toEqual({
      facet: "screen-type",
      text: "membership card",
    });
    expect(
      validateResearchQuery({ facet: null, job: "x", query: "membership card" })[0]?.code,
    ).toBe("missing-facet");
    expect(validateResearchQuery({ facet: "flow", job: " ", query: "QR redemption" })).toEqual([
      expect.objectContaining({ code: "missing-job" }),
    ]);
    expect(
      validateResearchQuery({ facet: "flow", job: "j", query: "clean modern app" })[0]?.code,
    ).toBe("generic-query");
    expect(GENERIC_QUERY_TERMS).toContain("beautiful");
    // stable ids (DR28): case and surrounding whitespace do not change the meaning
    expect(queryId("flow", "QR Redemption ")).toBe(queryId("flow", "qr redemption"));
    expect(queryId("flow", "qr redemption")).toMatch(/^Q-[0-9a-f]{8}$/);
    expect(queryId("flow", "qr redemption")).not.toBe(queryId("screen-type", "qr redemption"));
  });

  test("validates the brief output per query, facets and unique ids", () => {
    expect(validateBriefOutput(output())).toEqual([]);
    const bad = output();
    bad.queries[0] = { ...bad.queries[0]!, query: "beautiful UI" };
    bad.queries[1] = { ...bad.queries[2]!, facet: "ui-element" };
    const pointers = validateBriefOutput(bad).map((issue) => issue.pointer);
    expect(pointers).toContain("/queries/0/query");
    expect(pointers).toContain("/queries/2");
    expect(pointers).toContain("/queries");
  });

  test("accumulates provided queries and replaces inferred ones", () => {
    const first = build(null, { operator: [{ facet: "flow", text: "Cashback" }] });
    expect(first.queries.filter((q) => q.origin === "provided")).toHaveLength(1);
    const second = build(first, {
      operator: [
        { facet: "flow", text: "cashback" },
        { facet: "density", text: "dense tables" },
      ],
    });
    expect(second.queries.filter((q) => q.origin === "provided")).toHaveLength(2);
    expect(second.queries.slice(0, 2).every((q) => q.origin === "provided")).toBe(true);
    const third = build(second);
    expect(third.queries.filter((q) => q.origin === "provided")).toHaveLength(2);
    expect(third.queries.filter((q) => q.origin === "inferred")).toHaveLength(3);
    const reset = build(third, { resetQueries: true });
    expect(reset.queries.some((q) => q.origin === "provided")).toBe(false);
  });

  test("stays linear on adversarial input", () => {
    const started = performance.now();
    expect(validateResearchQuery({ facet: "flow", job: "j", query: "a ".repeat(160_000) })).toEqual(
      [],
    );
    expect(parseQueryFlag(`flow:${"x:".repeat(160_000)}`)).toMatchObject({
      code: "query-too-long",
    });
    expect(performance.now() - started).toBeLessThan(15_000);
  });
});
