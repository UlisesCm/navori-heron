import {
  DIRECTION_IDS,
  type AgentRunRef,
  type ContrastResult,
  type DirectionId,
  type DirectionProposalOutput,
  type FindingIssue,
  type HeronMode,
  type IsoDateTime,
  type PalettePairUsage,
  type ReferenceId,
  type VisualDirection,
  type VisualDirectionOutput,
  type VisualDirections,
} from "../core/contracts/index.ts";

/** DR12: closed limits of a direction proposal. */
export const DIRECTION_LIMITS = {
  minReferencesPerDirection: 2,
  minComponents: 4,
  requiredComponents: ["button", "text-input", "card"],
  maxCompositionDepth: 6,
  maxCompositionNodes: 60,
} as const;

/** Injected by `app` (DR11): `research` never imports `tokens`. Null when a color is not "#RRGGBB". */
export type ContrastCheck = (
  foregroundHex: string,
  backgroundHex: string,
  usage: PalettePairUsage,
) => ContrastResult | null;

const blank = (value: string): boolean => value.trim() === "";
const ATTRIBUTE_TEXTS = [
  "personality",
  "density",
  "surfaceTreatment",
  "typographyStrategy",
  "colorStrategy",
  "imageryStrategy",
  "navigationCharacter",
  "componentWeight",
  "motionCharacter",
] as const;
const ATTRIBUTE_LISTS = ["risks", "whenItFits", "whenItDoesnt"] as const;

type Sink = (pointer: string, message: string) => void;

function checkAttributes(
  direction: VisualDirectionOutput,
  at: string,
  add: Sink,
  active: Set<string>,
): void {
  const attributes = direction.attributes;
  for (const key of ATTRIBUTE_TEXTS) {
    if (blank(attributes[key])) add(`${at}/attributes/${key}`, "must not be empty");
  }
  for (const key of ATTRIBUTE_LISTS) {
    if (!attributes[key].some((item) => !blank(item))) {
      add(`${at}/attributes/${key}`, "needs at least one non-empty item");
    }
  }
  const cited = new Set<string>();
  attributes.references.forEach((entry, i) => {
    const pointer = `${at}/attributes/references/${i}`;
    if (!active.has(entry.reference)) {
      add(`${pointer}/reference`, `${entry.reference} is not an active reference`);
      return;
    }
    cited.add(entry.reference);
    if (!entry.doNotCopy.some((item) => !blank(item))) {
      add(`${pointer}/doNotCopy`, "needs at least one non-empty item");
    }
  });
  if (cited.size < DIRECTION_LIMITS.minReferencesPerDirection) {
    add(
      `${at}/attributes/references`,
      `must cite at least ${DIRECTION_LIMITS.minReferencesPerDirection} distinct active references`,
    );
  }
}

function checkPalette(
  direction: VisualDirectionOutput,
  at: string,
  add: Sink,
  check: ContrastCheck,
): Set<string> {
  const { colors, pairs } = direction.proposal.palette;
  const hexById = new Map<string, string>();
  colors.forEach((color, i) => {
    if (hexById.has(color.id))
      add(`${at}/proposal/palette/colors/${i}/id`, `duplicate color id ${color.id}`);
    else hexById.set(color.id, color.hex);
  });
  if (!pairs.some((pair) => pair.usage === "body-text")) {
    add(`${at}/proposal/palette/pairs`, "needs at least one body-text pair");
  }
  pairs.forEach((pair, i) => {
    const pointer = `${at}/proposal/palette/pairs/${i}`;
    const fg = hexById.get(pair.foreground);
    const bg = hexById.get(pair.background);
    if (fg === undefined) add(`${pointer}/foreground`, `unknown color ${pair.foreground}`);
    if (bg === undefined) add(`${pointer}/background`, `unknown color ${pair.background}`);
    if (fg === undefined || bg === undefined) return;
    const result = check(fg, bg, pair.usage);
    if (result === null) {
      add(pointer, `${pair.foreground}/${pair.background} could not be measured`);
    } else if (!result.passes) {
      add(
        pointer,
        `${pair.foreground} on ${pair.background} (${pair.usage}) has contrast ${result.ratio}, below the ${result.threshold} threshold`,
      );
    }
  });
  return new Set(hexById.keys());
}

function checkTypeScale(direction: VisualDirectionOutput, at: string, add: Sink): Set<string> {
  const steps = direction.proposal.typeScale.steps;
  const ids = new Set<string>();
  steps.forEach((step, i) => {
    if (ids.has(step.id))
      add(`${at}/proposal/typeScale/steps/${i}/id`, `duplicate step id ${step.id}`);
    ids.add(step.id);
    const previous = steps[i - 1];
    if (previous !== undefined && step.sizePx <= previous.sizePx) {
      add(`${at}/proposal/typeScale/steps/${i}/sizePx`, "sizes must be strictly increasing");
    }
  });
  return ids;
}

function checkComponents(
  direction: VisualDirectionOutput,
  at: string,
  add: Sink,
  colorIds: ReadonlySet<string>,
  stepIds: ReadonlySet<string>,
): void {
  const sheet = direction.proposal.componentSheet;
  if (sheet.length < DIRECTION_LIMITS.minComponents) {
    add(
      `${at}/proposal/componentSheet`,
      `needs at least ${DIRECTION_LIMITS.minComponents} components`,
    );
  }
  sheet.forEach((component, i) => {
    const pointer = `${at}/proposal/componentSheet/${i}`;
    for (const field of ["fill", "text"] as const) {
      if (!colorIds.has(component[field]))
        add(
          `${pointer}/${field}`,
          `unknown color ${component[field]}; must reference palette.colors[].id`,
        );
    }
    if (!stepIds.has(component.typeStep))
      add(
        `${pointer}/typeStep`,
        `unknown type step ${component.typeStep}; must reference typeScale.steps[].id`,
      );
  });
  const kinds = new Set(sheet.map((component) => component.kind));
  for (const kind of DIRECTION_LIMITS.requiredComponents) {
    if (!kinds.has(kind))
      add(`${at}/proposal/componentSheet`, `missing required component: ${kind}`);
  }
}

/** DR12: flat list with `parent`; one root, existing references, no cycles, depth and size caps, closed vocabulary. */
function checkComposition(
  direction: VisualDirectionOutput,
  at: string,
  add: Sink,
  colorIds: ReadonlySet<string>,
  stepIds: ReadonlySet<string>,
): void {
  const { nodes } = direction.proposal.composition;
  const base = `${at}/proposal/composition/nodes`;
  if (nodes.length > DIRECTION_LIMITS.maxCompositionNodes) {
    add(base, `at most ${DIRECTION_LIMITS.maxCompositionNodes} nodes are allowed`);
  }
  const byId = new Map<string, number>();
  nodes.forEach((node, i) => {
    if (byId.has(node.id)) add(`${base}/${i}/id`, `duplicate node id ${node.id}`);
    else byId.set(node.id, i);
  });
  const roots = nodes.filter((node) => node.parent === null).length;
  if (roots !== 1) add(base, `needs exactly one root node (found ${roots})`);
  nodes.forEach((node, i) => {
    const pointer = `${base}/${i}`;
    if (node.parent !== null && !byId.has(node.parent)) {
      add(`${pointer}/parent`, `unknown parent ${node.parent}`);
    }
    if (node.fill !== null && !colorIds.has(node.fill))
      add(`${pointer}/fill`, `unknown color ${node.fill}`);
    if (node.typeStep !== null && !stepIds.has(node.typeStep)) {
      add(`${pointer}/typeStep`, `unknown type step ${node.typeStep}`);
    }
    if (node.type === "component") {
      const sheet = direction.proposal.componentSheet;
      if (node.component === null || node.component >= sheet.length) {
        add(`${pointer}/component`, "must index an entry of componentSheet");
      }
    }
    // walk to the root: a revisit is a cycle, more hops than the cap is too deep
    const seen = new Set<string>([node.id]);
    let depth = 1;
    let parent = node.parent;
    while (parent !== null && byId.has(parent)) {
      if (seen.has(parent)) {
        add(`${pointer}/parent`, "parent chain forms a cycle");
        return;
      }
      seen.add(parent);
      depth += 1;
      parent = nodes[byId.get(parent)!]!.parent;
    }
    if (depth > DIRECTION_LIMITS.maxCompositionDepth) {
      add(pointer, `depth ${depth} exceeds ${DIRECTION_LIMITS.maxCompositionDepth}`);
    }
  });
}

/** DIR-A..C once; unique names; 13 attributes non-empty; >= 2 distinct active references per direction, each with >= 1
 * doNotCopy; palette ids unique; >= 1 body-text pair; pairs refer to existing colors and pass `checkContrast` (the issue
 * names the pair, ratio and threshold); steps strictly increasing; required components present; composition valid (DR12).
 * Pointers into the output. Pure. */
export function validateDirectionsOutput(
  output: DirectionProposalOutput,
  context: { activeReferences: readonly ReferenceId[]; checkContrast: ContrastCheck },
): FindingIssue[] {
  const issues: FindingIssue[] = [];
  const add: Sink = (pointer, message) => issues.push({ pointer, message });
  const active = new Set<string>(context.activeReferences);
  const ids = new Set<string>();
  const names = new Set<string>();
  output.directions.forEach((direction, i) => {
    const at = `/directions/${i}`;
    if (ids.has(direction.id)) add(`${at}/id`, `duplicate direction ${direction.id}`);
    ids.add(direction.id);
    const name = direction.name.trim().toLowerCase();
    if (name === "") add(`${at}/name`, "must not be empty");
    else if (names.has(name)) add(`${at}/name`, `duplicate name "${direction.name}"`);
    names.add(name);
    if (blank(direction.summary)) add(`${at}/summary`, "must not be empty");
    checkAttributes(direction, at, add, active);
    const colorIds = checkPalette(direction, at, add, context.checkContrast);
    const stepIds = checkTypeScale(direction, at, add);
    checkComponents(direction, at, add, colorIds, stepIds);
    checkComposition(direction, at, add, colorIds, stepIds);
  });
  for (const id of DIRECTION_IDS) {
    if (!ids.has(id)) add("/directions", `missing direction ${id}`);
  }
  return issues;
}

const directionOrder = (id: DirectionId): number => DIRECTION_IDS.indexOf(id);

function stamp(direction: VisualDirectionOutput, check: ContrastCheck): VisualDirection {
  const { palette, ...rest } = direction.proposal;
  const colors = palette.colors.map((color) => ({ ...color, hex: color.hex.toUpperCase() }));
  const hexById = new Map(colors.map((color) => [color.id, color.hex]));
  const pairs = palette.pairs.map((pair) => {
    const fg = hexById.get(pair.foreground);
    const bg = hexById.get(pair.background);
    const contrast = fg === undefined || bg === undefined ? null : check(fg, bg, pair.usage);
    if (contrast === null)
      throw new Error(`Unmeasurable pair ${pair.foreground}/${pair.background}: validate first.`);
    return { ...pair, contrast };
  });
  return {
    ...direction,
    proposal: { ...rest, marking: "SYNTHETIC", palette: { colors, pairs } },
    origin: "inferred",
  };
}

/** Pure; expects an output that passed `validateDirectionsOutput` (throws on an unmeasurable pair). Stamps the contrast
 * (never the agent's), upper-cases hex (DR33), marking "SYNTHETIC", origin "inferred", mode "reference-only" (DR3),
 * selection null; directions in DIR-A..C order. */
export function buildVisualDirections(
  output: DirectionProposalOutput,
  meta: {
    checkContrast: ContrastCheck;
    proposedAt: IsoDateTime;
    run: AgentRunRef;
    basis: VisualDirections["basis"];
  },
): VisualDirections {
  return {
    kind: "VisualDirections",
    schemaVersion: 1,
    mode: "reference-only",
    proposedAt: meta.proposedAt,
    run: meta.run,
    basis: meta.basis,
    directions: output.directions
      .toSorted((a, b) => directionOrder(a.id) - directionOrder(b.id))
      .map((direction) => stamp(direction, meta.checkContrast)),
    selection: null,
  };
}

/** DR3/R13: records `preferred` unless both the document and the project are `full` (then `selected`, P5). */
export function selectDirection(
  doc: VisualDirections,
  id: string,
  input: {
    mode: HeronMode;
    decidedBy: string;
    decidedAt: IsoDateTime;
    note: string | null;
    stateRevision: number;
  },
): VisualDirections | { error: "not-found" } {
  const direction = doc.directions.find((candidate) => candidate.id === id);
  if (direction === undefined) return { error: "not-found" };
  return {
    ...doc,
    selection: {
      direction: direction.id,
      status: doc.mode === "full" && input.mode === "full" ? "selected" : "preferred",
      decidedBy: input.decidedBy,
      decidedAt: input.decidedAt,
      note: input.note,
      stateRevision: input.stateRevision,
    },
  };
}
