import {
  RESEARCH_FACETS,
  type AgentTaskId,
  type DirectionProposalOutput,
  type ProbeOutput,
  type ResearchAnalysisOutput,
  type ResearchBriefOutput,
  type ResearchFacet,
  type VisualDirectionOutput,
} from "../../../core/contracts/index.ts";
import type { ContextItem } from "../../ports.ts";

/** Everything the fake emits is marked SYNTHETIC and depends only on the pack items: same pack, same bytes. */
const MARK = "SYNTHETIC";

const idsOf = (items: readonly ContextItem[], kind: ContextItem["kind"]): string[] =>
  items.filter((item) => item.kind === kind).map((item) => item.id);

/** Facets named in the `task-input` items, in RESEARCH_FACETS order; falls back to the first three. */
function facetsOf(items: readonly ContextItem[]): ResearchFacet[] {
  const text = items
    .filter((item) => item.kind === "task-input")
    .map((item) => item.content)
    .join("\n");
  const named = RESEARCH_FACETS.filter((facet) => text.includes(facet));
  return named.length > 0 ? named : RESEARCH_FACETS.slice(0, 3);
}

function brief(items: readonly ContextItem[]): ResearchBriefOutput {
  const facets = facetsOf(items);
  const count = Math.max(3, facets.length);
  return {
    queries: Array.from({ length: count }, (_, index) => {
      const facet = facets[index % facets.length] as ResearchFacet;
      return {
        facet,
        job: `${MARK} job ${index + 1}`,
        query: `${MARK} ${facet} query ${index + 1}`,
        question: `${MARK} question about ${facet}`,
        rationale: `${MARK} rationale for ${facet}`,
      };
    }),
  };
}

function analyze(items: readonly ContextItem[]): ResearchAnalysisOutput {
  const references = idsOf(items, "reference");
  const queries = idsOf(items, "brief-query").filter((id) => /^Q-[0-9a-f]{8}$/.test(id));
  const ids = references.length > 0 ? references : ["REF-1"];
  return {
    analyses: ids.map((reference) => ({
      reference,
      observations: [{ aspect: `${MARK} aspect`, note: `${MARK} observation of ${reference}` }],
      facets: ["visual-style"],
      suggestedDoNotCopy: [`${MARK} avoid copying ${reference} literally`],
      answersQueries: queries.slice(0, 20),
    })),
  };
}

const PRIMARIES = ["#0B5FFF", "#A31621", "#0B6E4F"] as const;
const DIRECTION_IDS = ["DIR-A", "DIR-B", "DIR-C"] as const;

const node = (
  n: number,
  parent: string | null,
  type: "frame" | "text",
  content: string | null,
) => ({
  id: `n${n}`,
  parent,
  type,
  direction: type === "frame" ? ("column" as const) : null,
  columns: null,
  fill: type === "frame" ? "c1" : null,
  typeStep: type === "text" ? "t3" : null,
  component: null,
  text: content,
  imageHint: null,
});

function direction(index: number, references: readonly string[]): VisualDirectionOutput {
  const id = DIRECTION_IDS[index] as VisualDirectionOutput["id"];
  const text = (label: string): string => `${MARK} ${id} ${label}`;
  const picked = [0, 1].map((n) => references[(index + n) % references.length] as string);
  const primary = PRIMARIES[index] as string;
  const step = (n: number, name: string, sizePx: number) => ({
    id: `t${n}`,
    name,
    sizePx,
    lineHeight: 1.4,
    weight: 400,
    usage: text(name),
  });
  const spec = (kind: "button" | "text-input" | "card" | "badge") => ({
    kind,
    variant: "default",
    fill: "c2",
    text: "c3",
    typeStep: "t3",
    radiusPx: 8,
    notes: text(kind),
  });
  return {
    id,
    name: text("direction"),
    summary: text("summary"),
    attributes: {
      personality: text("personality"),
      density: text("density"),
      surfaceTreatment: text("surface"),
      typographyStrategy: text("typography"),
      colorStrategy: text("color"),
      imageryStrategy: text("imagery"),
      navigationCharacter: text("navigation"),
      componentWeight: text("components"),
      motionCharacter: text("motion"),
      references: picked.map((reference) => ({
        reference,
        takes: [text(`takes from ${reference}`)],
        doNotCopy: [text(`copies nothing from ${reference}`)],
      })),
      risks: [text("risk")],
      whenItFits: [text("fits")],
      whenItDoesnt: [text("does not fit")],
    },
    proposal: {
      palette: {
        colors: [
          { id: "c1", name: "Paper", hex: "#FFFFFF", role: "background" },
          { id: "c2", name: "Surface", hex: "#F5F5F5", role: "surface" },
          { id: "c3", name: "Ink", hex: "#111111", role: "text" },
          { id: "c4", name: "Primary", hex: primary, role: "primary" },
        ],
        pairs: [
          { foreground: "c3", background: "c1", usage: "body-text" },
          { foreground: "c1", background: "c4", usage: "large-text" },
        ],
      },
      typeScale: {
        families: [{ role: "text", family: "Inter", fallback: ["system-ui", "sans-serif"] }],
        steps: [
          step(1, "caption", 12),
          step(2, "body", 16),
          step(3, "title", 24),
          step(4, "display", 40),
        ],
      },
      componentSheet: [spec("button"), spec("text-input"), spec("card"), spec("badge")],
      composition: {
        title: text("composition"),
        description: text("composition description"),
        nodes: [node(1, null, "frame", null), node(2, "n1", "text", text("headline"))],
      },
    },
  };
}

function propose(items: readonly ContextItem[]): DirectionProposalOutput {
  const found = idsOf(items, "reference");
  const references = found.length >= 2 ? found : [...found, "REF-1", "REF-2"].slice(0, 2);
  return { directions: [0, 1, 2].map((index) => direction(index, references)) };
}

function probe(items: readonly ContextItem[]): ProbeOutput {
  return { status: "ok", facets: facetsOf(items).slice(0, 1) };
}

/** Pure, deterministic output of the `fake` provider for each task, derived only from the pack items. */
export const RESPONDERS: Readonly<Record<AgentTaskId, (items: readonly ContextItem[]) => unknown>> =
  {
    "research-brief": brief,
    "research-analyze": analyze,
    "direction-propose": propose,
    probe,
  };
