// Covers: R11, R12, R13
import { describe, expect, test } from "bun:test";
import type {
  AgentRunRef,
  CompositionNodeOutput,
  DirectionId,
  DirectionProposalOutput,
  VisualDirectionOutput,
  VisualDirections,
} from "../../../src/core/contracts/index.ts";
import {
  buildVisualDirections,
  DIRECTION_LIMITS,
  selectDirection,
  validateDirectionsOutput,
} from "../../../src/research/directions.ts";
import { RESEARCH_FILES, runPath } from "../../../src/research/layout.ts";
import { checkContrast } from "../../../src/tokens/contrast.ts";

const ACTIVE = ["REF-1", "REF-2", "REF-3"] as const;
const context = { activeReferences: ACTIVE, checkContrast };
const sha = "a".repeat(64);
const run: AgentRunRef = {
  runId: "run-1",
  path: "runs/run-1.json",
  provider: "fake",
  template: { id: "design-director/direction-propose", version: 1, sha256: sha },
  cacheKey: sha,
};

function direction(id: DirectionId, name: string): VisualDirectionOutput {
  const text = (key: string): string => `${key} of ${name}`;
  return {
    id,
    name,
    summary: text("summary"),
    attributes: {
      personality: text("a"),
      density: text("a"),
      surfaceTreatment: text("a"),
      typographyStrategy: text("a"),
      colorStrategy: text("a"),
      imageryStrategy: text("a"),
      navigationCharacter: text("a"),
      componentWeight: text("a"),
      motionCharacter: text("a"),
      references: [
        { reference: "REF-1", takes: ["rhythm"], doNotCopy: ["logo"] },
        { reference: "REF-2", takes: ["grid"], doNotCopy: ["palette"] },
      ],
      risks: ["r"],
      whenItFits: ["f"],
      whenItDoesnt: ["d"],
    },
    proposal: {
      palette: {
        colors: [
          { id: "c1", name: "Paper", hex: "#ffffff", role: "background" },
          { id: "c2", name: "Ink", hex: "#111111", role: "text" },
          { id: "c3", name: "Blue", hex: "#1a4fd6", role: "primary" },
          { id: "c4", name: "Mist", hex: "#f2f2f2", role: "surface" },
        ],
        pairs: [
          { foreground: "c2", background: "c1", usage: "body-text" },
          { foreground: "c3", background: "c1", usage: "ui-component" },
        ],
      },
      typeScale: {
        families: [{ role: "text", family: "Inter", fallback: ["sans-serif"] }],
        steps: [
          { id: "t1", name: "Small", sizePx: 12, lineHeight: 1.4, weight: 400, usage: "caption" },
          { id: "t2", name: "Body", sizePx: 16, lineHeight: 1.5, weight: 400, usage: "body" },
          { id: "t3", name: "H2", sizePx: 24, lineHeight: 1.3, weight: 600, usage: "heading" },
          { id: "t4", name: "H1", sizePx: 40, lineHeight: 1.2, weight: 700, usage: "title" },
        ],
      },
      componentSheet: (["button", "text-input", "card", "badge"] as const).map((kind) => ({
        kind,
        variant: "default",
        fill: "c4",
        text: "c2",
        typeStep: "t2",
        radiusPx: 8,
        notes: "",
      })),
      composition: {
        title: "Dashboard",
        description: "Generic",
        nodes: [
          node("n1", null, "frame"),
          node("n2", "n1", "stack"),
          { ...node("n3", "n2", "component"), component: 0 },
          { ...node("n4", "n2", "text"), text: "Lorem ipsum", typeStep: "t2", fill: "c4" },
        ],
      },
    },
  };
}

function node(
  id: string,
  parent: string | null,
  type: CompositionNodeOutput["type"],
): CompositionNodeOutput {
  return {
    id,
    parent,
    type,
    direction: null,
    columns: null,
    fill: null,
    typeStep: null,
    component: null,
    text: null,
    imageHint: null,
  };
}

const valid = (): DirectionProposalOutput => ({
  directions: [direction("DIR-A", "Calm"), direction("DIR-B", "Bold"), direction("DIR-C", "Warm")],
});

/** Valid output with `mutate` applied to DIR-A. */
function withFirst(mutate: (d: VisualDirectionOutput) => void): DirectionProposalOutput {
  const output = valid();
  mutate(output.directions[0]!);
  return output;
}
const pointers = (output: DirectionProposalOutput): string[] =>
  validateDirectionsOutput(output, context).map((issue) => issue.pointer);

const nodes = (mutate: (n: CompositionNodeOutput[]) => void): string[] =>
  pointers(withFirst((d) => mutate(d.proposal.composition.nodes)));

const docOf = (mode: "full" | "reference-only"): VisualDirections => ({
  ...buildVisualDirections(valid(), {
    checkContrast,
    proposedAt: "2026-10-01T10:00:00.000Z",
    run,
    basis: { references: [], brief: null, analysis: null },
  }),
  mode,
});
const input = (mode: "full" | "reference-only") => ({
  mode,
  decidedBy: "ana@example.com",
  decidedAt: "2026-10-01T11:00:00.000Z",
  note: null,
  stateRevision: 7,
});

describe("validateDirectionsOutput", () => {
  test("validates citations, completeness and contrast of each proposal", () => {
    expect(validateDirectionsOutput(valid(), context)).toEqual([]);
    expect(DIRECTION_LIMITS.requiredComponents).toEqual(["button", "text-input", "card"]);

    // ids and names
    const dup = valid();
    dup.directions[1]!.id = "DIR-A";
    dup.directions[1]!.name = " calm ";
    expect(pointers(dup)).toEqual(
      expect.arrayContaining(["/directions/1/id", "/directions/1/name", "/directions"]),
    );

    // attributes and citations
    expect(pointers(withFirst((d) => (d.attributes.personality = " ")))).toEqual([
      "/directions/0/attributes/personality",
    ]);
    expect(pointers(withFirst((d) => (d.attributes.risks = [" "])))).toEqual([
      "/directions/0/attributes/risks",
    ]);
    expect(pointers(withFirst((d) => (d.attributes.references[1]!.reference = "REF-9")))).toEqual([
      "/directions/0/attributes/references/1/reference",
      "/directions/0/attributes/references",
    ]);
    expect(pointers(withFirst((d) => (d.attributes.references[1]!.reference = "REF-1")))).toEqual([
      "/directions/0/attributes/references",
    ]);
    expect(pointers(withFirst((d) => (d.attributes.references[0]!.doNotCopy = [" "])))).toEqual([
      "/directions/0/attributes/references/0/doNotCopy",
    ]);

    // palette and contrast
    const low = validateDirectionsOutput(
      withFirst((d) => (d.proposal.palette.colors[1]!.hex = "#999999")),
      context,
    );
    expect(low).toHaveLength(1);
    expect(low[0]?.pointer).toBe("/directions/0/proposal/palette/pairs/0");
    expect(low[0]?.message).toMatch(/c2 on c1 .*2\.85.*4\.5/);
    expect(pointers(withFirst((d) => (d.proposal.palette.colors[1]!.hex = "#12345G")))).toEqual([
      "/directions/0/proposal/palette/pairs/0",
    ]);
    expect(pointers(withFirst((d) => (d.proposal.palette.pairs[0]!.foreground = "c9")))).toEqual([
      "/directions/0/proposal/palette/pairs/0/foreground",
    ]);
    expect(pointers(withFirst((d) => (d.proposal.palette.colors[3]!.id = "c1")))).toEqual([
      "/directions/0/proposal/palette/colors/3/id",
      "/directions/0/proposal/composition/nodes/3/fill", // c4 was renamed away
    ]);
    expect(pointers(withFirst((d) => (d.proposal.palette.pairs[0]!.usage = "large-text")))).toEqual(
      ["/directions/0/proposal/palette/pairs"],
    );

    // type scale and components
    expect(pointers(withFirst((d) => (d.proposal.typeScale.steps[2]!.sizePx = 16)))).toEqual([
      "/directions/0/proposal/typeScale/steps/2/sizePx",
    ]);
    expect(pointers(withFirst((d) => (d.proposal.typeScale.steps[1]!.id = "t1")))).toEqual([
      "/directions/0/proposal/typeScale/steps/1/id",
      "/directions/0/proposal/composition/nodes/3/typeStep", // t2 no longer exists
    ]);
    const noCard = pointers(withFirst((d) => (d.proposal.componentSheet[2]!.kind = "badge")));
    expect(noCard).toEqual(["/directions/0/proposal/componentSheet"]);
    expect(
      pointers(
        withFirst((d) => (d.proposal.componentSheet = d.proposal.componentSheet.slice(0, 3))),
      ),
    ).toContain("/directions/0/proposal/componentSheet");
  });

  test("rejects invalid compositions", () => {
    const base = "/directions/0/proposal/composition/nodes";
    expect(nodes((n) => (n[2]!.parent = "n9"))).toEqual([`${base}/2/parent`]);
    expect(nodes((n) => (n[3]!.fill = "zz"))).toEqual([`${base}/3/fill`]);
    expect(nodes((n) => (n[3]!.typeStep = "zz"))).toEqual([`${base}/3/typeStep`]);
    expect(nodes((n) => (n[2]!.component = 9))).toEqual([`${base}/2/component`]);
    expect(nodes((n) => (n[2]!.component = null))).toEqual([`${base}/2/component`]);
    expect(nodes((n) => (n[3]!.id = "n1"))).toContain(`${base}/3/id`);
    expect(nodes((n) => (n[1]!.parent = null))).toEqual([base]);
    expect(nodes((n) => (n[0]!.parent = "n3"))).toContain(`${base}/0/parent`);
    // chain of 7 > depth 6
    const deep = nodes((n) => {
      n.length = 1;
      for (let i = 2; i <= 7; i++) n.push(node(`n${i}`, `n${i - 1}`, "stack"));
    });
    expect(deep).toEqual([`${base}/6`]);
    // more than 60 nodes
    const many = nodes((n) => {
      for (let i = 5; i <= 62; i++) n.push(node(`n${i}`, "n1", "stack"));
    });
    expect(many).toContain(base);
  });
});

describe("buildVisualDirections", () => {
  test("stamps deterministic contrast, upper-cased hex and reference-only mode", () => {
    const output = valid();
    output.directions.reverse();
    const doc = buildVisualDirections(output, {
      checkContrast,
      proposedAt: "2026-10-01T10:00:00.000Z",
      run,
      basis: { references: ["REF-1"], brief: null, analysis: null },
    });
    expect(doc.mode).toBe("reference-only");
    expect(doc.selection).toBeNull();
    expect(doc.directions.map((d) => d.id)).toEqual(["DIR-A", "DIR-B", "DIR-C"]);
    const first = doc.directions[0]!;
    expect(first.origin).toBe("inferred");
    expect(first.proposal.marking).toBe("SYNTHETIC");
    expect(first.proposal.palette.colors[0]?.hex).toBe("#FFFFFF");
    expect(first.proposal.palette.pairs[0]?.contrast).toEqual(
      checkContrast("#111111", "#FFFFFF", "body-text") ?? undefined,
    );
    expect(() =>
      buildVisualDirections(
        withFirst((d) => (d.proposal.palette.pairs[0]!.foreground = "c9")),
        { checkContrast, proposedAt: doc.proposedAt, run, basis: doc.basis },
      ),
    ).toThrow(/Unmeasurable/);
  });
});

describe("selectDirection", () => {
  test("records preferred unless both the document and the project are full", () => {
    for (const [docMode, projectMode, status] of [
      ["reference-only", "reference-only", "preferred"],
      ["reference-only", "full", "preferred"],
      ["full", "reference-only", "preferred"],
      ["full", "full", "selected"],
    ] as const) {
      const result = selectDirection(docOf(docMode), "DIR-B", input(projectMode));
      expect("error" in result).toBe(false);
      expect((result as VisualDirections).selection).toEqual({
        direction: "DIR-B",
        status,
        decidedBy: "ana@example.com",
        decidedAt: "2026-10-01T11:00:00.000Z",
        note: null,
        stateRevision: 7,
      });
    }
    expect(selectDirection(docOf("reference-only"), "DIR-Z", input("full"))).toEqual({
      error: "not-found",
    });
  });
});

describe("research layout", () => {
  test("names the P3 documents and the run record", () => {
    expect(RESEARCH_FILES.brief).toBe("research/brief.json");
    expect(RESEARCH_FILES.analysis).toBe("research/analysis.json");
    expect(RESEARCH_FILES.directions).toBe("research/visual-directions.json");
    expect(runPath("abc")).toBe("runs/abc.json");
  });
});
