// Covers: R10, R14
import { describe, expect, test } from "bun:test";
import asset from "../../assets/penpot/direction-proposal.json" with { type: "json" };
import {
  BASIC_COMPONENT_KINDS,
  DirectionProposalOutputSchema,
  VisualDirectionsSchema,
  canonicalJson,
  type CompositionNodeOutput,
} from "../../../src/core/contracts/index.ts";
import { RESPONDERS } from "../../../src/agents/adapters/fake/responders.ts";
import {
  buildVisualDirections,
  validateDirectionsOutput,
} from "../../../src/research/directions.ts";
import { checkContrast } from "../../../src/tokens/contrast.ts";
import {
  componentNodes,
  proposalColor,
  proposalStep,
  proposalText,
} from "../../../src/penpot/compiler/components.ts";
import { compositionNodes } from "../../../src/penpot/compiler/composition.ts";
import {
  ATTRIBUTE_KEYS,
  PENPOT_COPY,
  resolvePenpotCopy,
} from "../../../src/penpot/compiler/copy.ts";
import {
  contentSha256,
  proposalPageId,
  proposalSourceSha256,
  referencesSourceSha256,
} from "../../../src/penpot/compiler/ids.ts";
import {
  CHROME,
  PROPOSAL_LAYOUT,
  buildProposalPage,
} from "../../../src/penpot/compiler/proposal-page.ts";
import {
  makeBoard,
  makeRect,
  makeText,
  type CompileIssue,
  type PenpotNode,
  type ReviewPage,
} from "../../../src/penpot/compiler/nodes.ts";
import { penpotTemplate } from "../../../src/penpot/compiler/templates.ts";
import { renderScript, reviewScriptData } from "../../../src/penpot/compiler/script.ts";
import { sampleReference } from "../../helpers/research.ts";
import { createFakePenpot, runPenpotScript } from "../../helpers/fake-penpot.ts";

const fixture = VisualDirectionsSchema.parse(asset);
const template = penpotTemplate("review-page");
const context = { mode: fixture.mode, copy: resolvePenpotCopy("en"), template: template.ref };
const first = fixture.directions[0]!;
const flatten = (nodes: readonly PenpotNode[]): PenpotNode[] =>
  nodes.flatMap((node) => [node, ...(node.type === "board" ? flatten(node.children) : [])]);
const textOf = (nodes: readonly PenpotNode[]): string =>
  flatten(nodes)
    .filter((node) => node.type === "text")
    .map((node) => node.characters)
    .join("\n");
const graphNode = (
  id: string,
  parent: string | null,
  type: CompositionNodeOutput["type"],
): CompositionNodeOutput => ({
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
});

describe("proposal page compiler", () => {
  test("builds the SYNTHETIC fixture through the existing direction builder", () => {
    const output = DirectionProposalOutputSchema.parse(RESPONDERS["direction-propose"]([]));
    output.directions[0]!.name = 'SYNTHETIC "); malicious()';
    expect(
      validateDirectionsOutput(output, { activeReferences: ["REF-1", "REF-2"], checkContrast }),
    ).toEqual([]);
    expect(
      buildVisualDirections(output, {
        checkContrast,
        proposedAt: fixture.proposedAt,
        run: fixture.run,
        basis: fixture.basis,
      }),
    ).toEqual(fixture);
  });

  test("lays out the proposal sections with the same geometry for every direction", () => {
    for (const direction of fixture.directions) {
      const page = buildProposalPage(direction, context);
      expect(page.heronId).toBe(proposalPageId(direction.id));
      expect(page.kind).toBe("proposal-page");
      expect(page.nodes).toHaveLength(6);
      for (const node of page.nodes) {
        if (node.type !== "board") throw new Error("expected section board");
        expect({ x: node.x, y: node.y, width: node.width, height: node.height }).toEqual(
          PROPOSAL_LAYOUT[node.key as keyof typeof PROPOSAL_LAYOUT],
        );
      }
      const frame = flatten(page.nodes).find((node) => node.key === "composition/frame");
      expect(frame).toMatchObject({ width: 1280, height: 800 });
      const keys = flatten(page.nodes).map((node) => node.key);
      expect(new Set(keys).size).toBe(keys.length);
      expect(page.issues).toEqual([]);
      expect(page.sourceSha256).toBe(proposalSourceSha256(direction));
      expect(page.contentSha256).toBe(contentSha256(page));
      expect(canonicalJson(page)).toBe(canonicalJson(buildProposalPage(direction, context)));
    }
    expect(CHROME.text).toBe("#18212B");
    expect(PROPOSAL_LAYOUT.attributes.y).toBeGreaterThan(
      PROPOSAL_LAYOUT.composition.y + PROPOSAL_LAYOUT.composition.height!,
    );
  });

  test("marks sample content SYNTHETIC and resolves unknown references with fallbacks", () => {
    const proposal = structuredClone(first.proposal);
    const spec = {
      ...proposal.componentSheet[0]!,
      fill: "missing-fill",
      text: "missing-text",
      typeStep: "missing-step",
    };
    const result = componentNodes(spec, proposal, "sample", context.copy);
    expect(result.issues.map((issue) => issue.pointer)).toEqual([
      "sample/fill",
      "sample/text",
      "sample/typeStep",
    ]);
    expect(result.node).toMatchObject({ fill: "#0B5FFF" });
    const labels = flatten([result.node]).filter((node) => node.type === "text");
    expect(labels).not.toHaveLength(0);
    for (const label of labels) expect(label.name).toContain("SYNTHETIC");
    expect(labels[0]).toMatchObject({ color: "#111111", fontSize: 16 });
    const issues: CompileIssue[] = [];
    expect(proposalColor(proposal, "#abcdef", "surface", "/color", issues)).toBe("#ABCDEF");
    expect(proposalStep(proposal, null, "/step", issues).sizePx).toBe(16);
    expect(issues).toEqual([]);
    expect(textOf(buildProposalPage(first, context).nodes)).toContain(context.copy.synthetic);
  });

  test("writes page copy in the product locale", () => {
    const en = buildProposalPage(first, context);
    const es = buildProposalPage(first, { ...context, copy: resolvePenpotCopy("es-MX") });
    expect(en.name).toContain("REFERENCE ONLY");
    expect(es.name).toContain("SOLO REFERENCIA");
    expect(textOf(es.nodes)).toContain("Paleta");
    expect(textOf(es.nodes)).toContain("Qué no copiar");
    for (const key of ATTRIBUTE_KEYS) expect(context.copy[key]).not.toBe("");
    expect(resolvePenpotCopy("ES-mx")).toBe(PENPOT_COPY.es);
    expect(resolvePenpotCopy(null)).toBe(PENPOT_COPY.en);
    expect(resolvePenpotCopy("fr")).toBe(PENPOT_COPY.en);
    expect(es.contentSha256).not.toBe(en.contentSha256);
    expect(es.sourceSha256).toBe(en.sourceSha256);
    const full = buildProposalPage(first, { ...context, mode: "full" });
    expect(full.name).not.toContain("REFERENCE ONLY");
    expect(textOf(full.nodes)).toContain("full");
    expect(full.contentSha256).not.toBe(en.contentSha256);
  });

  test("implements all ten component sizes with deterministic product styling", () => {
    const sizes = [
      [160, 44],
      [280, 44],
      [280, 160],
      [72, 24],
      [360, 56],
      [320, 56],
      [320, 44],
      [360, 200],
      [52, 28],
      [48, 48],
    ];
    for (const [index, kind] of BASIC_COMPONENT_KINDS.entries()) {
      const { node, issues } = componentNodes(
        { ...first.proposal.componentSheet[0]!, kind },
        first.proposal,
        `kind-${kind}`,
        context.copy,
      );
      if (node.type !== "board") throw new Error("component must be a board");
      expect([node.width, node.height]).toEqual(sizes[index]!);
      expect(node.name).toContain(context.copy.synthetic);
      expect(new Set(flatten([node]).map((child) => child.key)).size).toBe(flatten([node]).length);
      expect(issues).toEqual([]);
      if (kind === "avatar") expect(node.radius).toBe(24);
      if (kind === "text-input") expect(node.stroke?.style).toBe("solid");
    }
    const proposal = structuredClone(first.proposal);
    proposal.palette.colors.push({ id: "c5", name: "Border", hex: "#aabbcc", role: "border" });
    expect(
      componentNodes(
        { ...proposal.componentSheet[0]!, kind: "text-input" },
        proposal,
        "input",
        context.copy,
      ).node,
    ).toMatchObject({ stroke: { color: "#AABBCC" } });
  });

  test("compiles every composition kind and handles malformed graphs without recursion loops", () => {
    const proposal = structuredClone(first.proposal);
    proposal.composition.nodes = [
      graphNode("n1", null, "frame"),
      graphNode("n2", "n1", "stack"),
      { ...graphNode("n3", "n2", "grid"), columns: 3 },
      { ...graphNode("n4", "n3", "component"), component: 0 },
      { ...graphNode("n5", "n3", "text"), text: "Aa 0123" },
      { ...graphNode("n6", "n1", "image"), imageHint: "SYNTHETIC landscape" },
      graphNode("n7", "n1", "slot"),
    ];
    const result = compositionNodes(proposal, "composition", context.copy);
    expect(result.issues).toEqual([]);
    expect(flatten([result.node]).find((node) => node.key === "composition/n3")).toMatchObject({
      layout: { kind: "grid", columns: 3 },
    });
    expect(textOf([result.node])).toContain("IMAGE · SYNTHETIC landscape");
    expect(textOf([result.node])).toContain("SLOT");
    proposal.composition.nodes = [{ ...graphNode("n1", null, "component"), component: 99 }];
    expect(compositionNodes(proposal, "composition", context.copy).issues[0]?.pointer).toBe(
      "composition/n1/component",
    );
    proposal.composition.nodes = [graphNode("n1", "n2", "frame"), graphNode("n2", "n1", "stack")];
    expect(compositionNodes(proposal, "composition", context.copy).issues).toHaveLength(1);
    proposal.composition.nodes = [
      graphNode("n1", "missing", "grid"),
      graphNode("n2", "n1", "image"),
    ];
    expect(compositionNodes(proposal, "composition", context.copy).node).toBeDefined();
  });

  test("chooses display fonts for large steps and preserves family fallbacks", () => {
    const proposal = structuredClone(first.proposal);
    proposal.typeScale.families.push({
      role: "display",
      family: "Display Font",
      fallback: ["serif"],
    });
    const body = proposal.typeScale.steps[1]!;
    const heading = proposal.typeScale.steps[3]!;
    expect(proposalText(proposal, "body", "Aa", "#111111", body, 300).fontFamily).toBe("Inter");
    expect(proposalText(proposal, "heading", "Aa", "#111111", heading, 300).fontFamily).toBe(
      "Display Font",
    );
    proposal.typeScale.families = [{ role: "mono", family: "Mono Font", fallback: ["monospace"] }];
    expect(proposalText(proposal, "body", "Aa", "#111111", body, null).fontFamily).toBe(
      "Mono Font",
    );
    const empty = structuredClone(proposal);
    empty.palette.colors = [];
    empty.typeScale.steps = [];
    empty.typeScale.families = [];
    expect(() => proposalColor(empty, null, "text", "/color", [])).toThrow("palette is empty");
    expect(() => proposalStep(empty, "missing", "/step", [])).toThrow("type scale is empty");
    expect(() => proposalText(empty, "text", "Aa", "#111111", body, null)).toThrow(
      "font families are empty",
    );
  });

  test("keeps normal proposal scripts within the transport budget and hostile names as data", async () => {
    const fake = createFakePenpot();
    const page = buildProposalPage(first, context);
    const script = renderScript(template, reviewScriptData(page, null));
    expect(script.ok).toBe(true);
    if (!script.ok) throw new Error(`normal proposal exceeds budget: ${script.bytes}`);
    expect(await runPenpotScript(fake, script.code)).toMatchObject({ outcome: "written" });
    expect(fake.penpot.currentFile?.pages[0]?.name).toContain('"); malicious()');
  });

  test("uses shared pure constructors and keeps fingerprints sensitive to source and template", () => {
    expect(makeBoard("board", []).layout).toMatchObject({ kind: "flex" });
    expect(makeText("text", "Aa").characters).toBe("Aa");
    expect(makeRect("rect", 20, 30).fill).toBeNull();
    const page = buildProposalPage(first, context);
    expect(buildProposalPage({ ...first, summary: "Changed" }, context).sourceSha256).not.toBe(
      page.sourceSha256,
    );
    expect(
      buildProposalPage(first, { ...context, template: { ...template.ref, version: 2 } })
        .contentSha256,
    ).not.toBe(page.contentSha256);
    const refs = [sampleReference({ id: "REF-10" }), sampleReference({ id: "REF-2" })];
    expect(referencesSourceSha256(refs)).toBe(referencesSourceSha256(refs.toReversed()));
    expect(
      referencesSourceSha256([
        ...refs,
        sampleReference({ removed: { at: fixture.proposedAt, reason: "removed" } }),
      ]),
    ).toBe(referencesSourceSha256(refs));
    expect(referencesSourceSha256([])).not.toBe(referencesSourceSha256(refs));
    const diagnostic: ReviewPage = {
      ...page,
      issues: [{ code: "PENPOT_PROPOSAL_FALLBACK", message: "diagnostic", pointer: null }],
    };
    expect(contentSha256(diagnostic)).toBe(page.contentSha256);
    expect(page.name.length).toBeLessThanOrEqual(120);
  });
});
