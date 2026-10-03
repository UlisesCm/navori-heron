import type { HeronMode, TemplateRef, VisualDirection } from "../../core/contracts/index.ts";
import { componentNodes, proposalColor, proposalText } from "./components.ts";
import { compositionNodes } from "./composition.ts";
import { ATTRIBUTE_KEYS, type PenpotCopy } from "./copy.ts";
import { contentSha256, proposalPageId, proposalSourceSha256 } from "./ids.ts";
import {
  makeBoard,
  makeRect,
  makeText,
  type CompileIssue,
  type Hex,
  type PenpotNode,
  type ReviewPage,
} from "./nodes.ts";

/** Review chrome is independent from the product palette. */
export const CHROME: { canvas: Hex; panel: Hex; text: Hex; muted: Hex; rule: Hex; band: Hex } = {
  canvas: "#F4F5F7",
  panel: "#FFFFFF",
  text: "#18212B",
  muted: "#556270",
  rule: "#D8DFE7",
  band: "#FFF2C6",
};
type Section = "header" | "palette" | "typeScale" | "components" | "composition" | "attributes";
/** Same positions and capacity for DIR-A, DIR-B and DIR-C; only the final attributes section hugs. */
export const PROPOSAL_LAYOUT: Readonly<
  Record<Section, { x: number; y: number; width: number; height: number | null }>
> = {
  header: { x: 0, y: 0, width: 2100, height: 300 },
  palette: { x: 0, y: 340, width: 2100, height: 1100 },
  typeScale: { x: 0, y: 1480, width: 2100, height: 3500 },
  components: { x: 0, y: 5020, width: 2100, height: 1200 },
  composition: { x: 0, y: 6260, width: 2100, height: 1000 },
  attributes: { x: 0, y: 7300, width: 2100, height: null },
};
const chromeText = (key: string, value: string, size = 16): PenpotNode =>
  makeText(key, value, { width: 2068, fontSize: size, color: CHROME.text });

const grid = (key: string, children: PenpotNode[], columns: number): PenpotNode =>
  makeBoard(key, children, {
    width: 2068,
    layout: { kind: "grid", columns, gap: 16, padding: 0 },
  });

export function buildProposalPage(
  direction: VisualDirection,
  context: { mode: HeronMode; copy: PenpotCopy; template: TemplateRef },
): ReviewPage {
  const { copy, mode, template } = context;
  const proposal = direction.proposal;
  const issues: CompileIssue[] = [];
  const section = (id: Section, children: PenpotNode[]): PenpotNode =>
    makeBoard(id, children, {
      name: id === "header" ? direction.name : copy[id],
      ...PROPOSAL_LAYOUT[id],
      fill: CHROME.panel,
      layout: { kind: "flex", dir: "column", gap: 16, padding: 16, wrap: false },
    });
  const samples = proposal.palette.colors.map((color) =>
    makeBoard(
      `palette/${color.id}`,
      [
        makeRect(`palette/${color.id}/swatch`, 468, 60, { fill: color.hex.toUpperCase() }),
        makeText(`palette/${color.id}/label`, `${color.name} · ${color.hex} · ${color.role}`, {
          color: CHROME.text,
          width: 468,
        }),
      ],
      {
        width: 500,
        height: 140,
        fill: CHROME.panel,
        layout: { kind: "flex", dir: "column", gap: 8, padding: 16, wrap: false },
      },
    ),
  );
  const pairs = proposal.palette.pairs.map((pair, index) => {
    const key = `palette/pair-${index}`;
    const background = proposalColor(
      proposal,
      pair.background,
      "background",
      `${key}/background`,
      issues,
    );
    const foreground = proposalColor(
      proposal,
      pair.foreground,
      "text",
      `${key}/foreground`,
      issues,
    );
    return makeBoard(
      key,
      [
        makeText(
          `${key}/text`,
          `${pair.foreground}/${pair.background} · ${pair.usage}\n${pair.contrast.ratio.toFixed(2)} / ${pair.contrast.threshold} · ${pair.contrast.passes ? copy.passes : copy.fails}`,
          { width: 468, color: foreground },
        ),
      ],
      {
        width: 500,
        height: 140,
        fill: background,
        layout: { kind: "flex", dir: "column", gap: 8, padding: 16, wrap: false },
      },
    );
  });
  const typeRows = proposal.typeScale.steps.map((step) =>
    makeBoard(
      `typeScale/${step.id}`,
      [
        chromeText(
          `typeScale/${step.id}/label`,
          `${step.name} · ${step.sizePx}px / ${step.lineHeight} · ${step.weight} · ${step.usage}`,
        ),
        proposalText(
          proposal,
          `typeScale/${step.id}/sample`,
          "SYNTHETIC Aa 0123",
          proposalColor(proposal, null, "text", `typeScale/${step.id}/color`, issues),
          step,
          2068,
        ),
      ],
      { width: 2068, height: null },
    ),
  );
  const components = proposal.componentSheet.map((spec, index) => {
    const result = componentNodes(spec, proposal, `components/${index}/sample`, copy);
    issues.push(...result.issues);
    return makeBoard(
      `components/${index}`,
      [
        makeText(
          `components/${index}/label`,
          `${copy[spec.kind]} · ${spec.variant}\n${spec.notes}`,
          { width: 376, fontSize: 14 },
        ),
        result.node,
      ],
      { width: 400, height: 520 },
    );
  });
  const composition = compositionNodes(proposal, "composition/frame", copy);
  issues.push(...composition.issues);
  const attributes = ATTRIBUTE_KEYS.filter((key) => key !== "references").map((key) =>
    chromeText(
      `attributes/${key}`,
      `${copy[key]}\n${Array.isArray(direction.attributes[key]) ? direction.attributes[key].join("\n") : direction.attributes[key]}`,
    ),
  );
  attributes.push(chromeText("attributes/references-label", copy.referencesCited, 24));
  direction.attributes.references.forEach((reference, index) =>
    attributes.push(
      chromeText(
        `attributes/reference-${index}`,
        `${reference.reference}\n${reference.takes.join("\n")}\n${copy.doNotCopy}: ${reference.doNotCopy.join("\n")}`,
      ),
    ),
  );
  const nodes = [
    section("header", [
      chromeText("header/name", `${direction.id} · ${direction.name}`, 32),
      chromeText("header/summary", direction.summary),
      makeBoard(
        "header/band",
        [chromeText("header/mode", mode === "reference-only" ? copy.referenceOnly : mode)],
        { width: 2068, height: null, fill: CHROME.band },
      ),
      chromeText("header/synthetic", copy.synthetic),
    ]),
    section("palette", [
      chromeText("palette/title", copy.palette, 24),
      grid("palette/colors", samples, 4),
      grid("palette/pairs", pairs, 4),
    ]),
    section("typeScale", [chromeText("typeScale/title", copy.typeScale, 24), ...typeRows]),
    section("components", [
      chromeText("components/title", `${copy.components} · ${copy.synthetic}`, 24),
      grid("components/grid", components, 5),
    ]),
    section("composition", [
      chromeText("composition/title", `${copy.composition} · ${copy.synthetic}`, 24),
      chromeText(
        "composition/description",
        `${proposal.composition.title}\n${proposal.composition.description}`,
      ),
      composition.node,
    ]),
    section("attributes", [chromeText("attributes/title", copy.attributes, 24), ...attributes]),
  ];
  const heronId = proposalPageId(direction.id);
  const name = Array.from(
    `Heron · ${direction.id} · ${direction.name}${mode === "reference-only" ? ` · ${copy.referenceOnly}` : ""}`,
  )
    .slice(0, 120)
    .join("");
  const sourceSha256 = proposalSourceSha256(direction);
  return {
    heronId,
    kind: "proposal-page",
    name,
    mode,
    sourceSha256,
    nodes,
    template,
    contentSha256: contentSha256({ template, heronId, name, mode, sourceSha256, nodes }),
    issues,
  };
}
