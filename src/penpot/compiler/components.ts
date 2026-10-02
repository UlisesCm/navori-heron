import type {
  BasicComponentKind,
  ComponentSpecOutput,
  PaletteRole,
  TypeStepOutput,
  VisualProposal,
} from "../../core/contracts/index.ts";
import type { PenpotCopy } from "./copy.ts";
import {
  makeBoard,
  makeRect,
  makeText,
  type BoardNode,
  type CompileIssue,
  type Hex,
  type PenpotNode,
  type TextNode,
} from "./nodes.ts";

function fallback(issues: CompileIssue[], pointer: string, value: string): void {
  issues.push({
    code: "PENPOT_PROPOSAL_FALLBACK",
    pointer,
    message: `Unknown proposal reference ${value}; using the declared fallback.`,
  });
}
/** Resolve only palette colors or explicit hex values. Never invent product colors (DR24). */
export function proposalColor(
  proposal: VisualProposal,
  value: string | null,
  role: PaletteRole,
  pointer: string,
  issues: CompileIssue[],
): Hex {
  const found = proposal.palette.colors.find((color) => color.id === value);
  if (found) return found.hex.toUpperCase();
  if (value !== null && /^#[0-9a-f]{6}$/i.test(value)) return value.toUpperCase();
  if (value !== null) fallback(issues, pointer, value);
  const color =
    proposal.palette.colors.find((candidate) => candidate.role === role) ??
    proposal.palette.colors[0];
  if (!color) throw new Error("proposal palette is empty");
  return color.hex.toUpperCase();
}
export function proposalStep(
  proposal: VisualProposal,
  id: string | null,
  pointer: string,
  issues: CompileIssue[],
): TypeStepOutput {
  const found = proposal.typeScale.steps.find((step) => step.id === id);
  if (found) return found;
  if (id !== null) fallback(issues, pointer, id);
  const nearest = proposal.typeScale.steps.toSorted(
    (a, b) => Math.abs(a.sizePx - 16) - Math.abs(b.sizePx - 16),
  )[0];
  if (!nearest) throw new Error("proposal type scale is empty");
  return nearest;
}
export function proposalText(
  proposal: VisualProposal,
  key: string,
  characters: string,
  color: Hex,
  step: TypeStepOutput,
  width: number | null,
): TextNode {
  const families = proposal.typeScale.families;
  const text = families.find((family) => family.role === "text") ?? families[0];
  const family =
    step.sizePx >= 24 ? (families.find((candidate) => candidate.role === "display") ?? text) : text;
  if (!family) throw new Error("proposal font families are empty");
  // Tag the layer without making a 72px badge overflow with a long warning. Section notices stay visible.
  return makeText(key, characters, {
    name: `${key} · SYNTHETIC`,
    color,
    width,
    fontFamily: family.family,
    fontSize: step.sizePx,
    fontWeight: step.weight,
    lineHeight: step.lineHeight,
  });
}

const SIZES: Readonly<Record<BasicComponentKind, readonly [number, number]>> = {
  button: [160, 44],
  "text-input": [280, 44],
  card: [280, 160],
  badge: [72, 24],
  navigation: [360, 56],
  "list-item": [320, 56],
  tabs: [320, 44],
  dialog: [360, 200],
  toggle: [52, 28],
  avatar: [48, 48],
};
export function componentNodes(
  spec: ComponentSpecOutput,
  proposal: VisualProposal,
  key: string,
  copy: PenpotCopy,
): { node: PenpotNode; issues: CompileIssue[] } {
  const issues: CompileIssue[] = [];
  const fill = proposalColor(
    proposal,
    spec.fill,
    spec.kind === "button" ? "primary" : "surface",
    `${key}/fill`,
    issues,
  );
  const color = proposalColor(proposal, spec.text, "text", `${key}/text`, issues);
  const step = proposalStep(proposal, spec.typeStep, `${key}/typeStep`, issues);
  const [width, height] = SIZES[spec.kind];
  const label = (suffix: string, text: string, w: number | null = width - 24): TextNode =>
    proposalText(proposal, `${key}/${suffix}`, text, color, step, w);
  const children: PenpotNode[] = [];
  const row = ["navigation", "tabs", "toggle"].includes(spec.kind);
  const board: BoardNode = makeBoard(key, children, {
    name: `${copy[spec.kind]} · ${copy.synthetic}`,
    width,
    height,
    fill,
    radius: spec.radiusPx,
    layout: {
      kind: "flex",
      dir: row ? "row" : "column",
      gap: 8,
      padding: spec.kind === "avatar" || spec.kind === "toggle" ? 0 : 8,
      wrap: false,
    },
  });
  switch (spec.kind) {
    case "avatar":
      board.radius = 24;
      children.push(label("initials", "AB", 40));
      break;
    case "toggle":
      children.push(makeRect(`${key}/knob`, 24, 24, { fill: color, radius: 12 }));
      break;
    case "navigation":
    case "tabs":
      for (let index = 1; index <= 3; index += 1)
        children.push(label(`item-${index}`, `${copy[spec.kind]} ${index}`, (width - 32) / 3));
      break;
    case "card":
      children.push(label("title", copy.card), label("body", "Aa 0123\nAa 0123"));
      break;
    case "dialog": {
      children.push(label("title", copy.dialog), label("body", "Aa 0123"));
      const button = componentNodes({ ...spec, kind: "button" }, proposal, `${key}/button`, copy);
      children.push(button.node);
      issues.push(...button.issues);
      break;
    }
    case "text-input": {
      const borderRole = proposal.palette.colors.some((candidate) => candidate.role === "border")
        ? "border"
        : "text-muted";
      board.stroke = {
        color: proposalColor(proposal, null, borderRole, `${key}/border`, issues),
        width: 1,
        style: "solid",
      };
      children.push(label("placeholder", copy[spec.kind]));
      break;
    }
    default:
      children.push(label("label", copy[spec.kind], spec.kind === "badge" ? null : width - 16));
  }
  return { node: board, issues };
}
