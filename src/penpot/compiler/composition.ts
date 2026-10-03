import type { CompositionNodeOutput, VisualProposal } from "../../core/contracts/index.ts";
import { componentNodes, proposalColor, proposalStep, proposalText } from "./components.ts";
import type { PenpotCopy } from "./copy.ts";
import { makeBoard, type CompileIssue, type PenpotNode } from "./nodes.ts";

export function compositionNodes(
  proposal: VisualProposal,
  key: string,
  copy: PenpotCopy,
): { node: PenpotNode; issues: CompileIssue[] } {
  const issues: CompileIssue[] = [];
  const nodes = proposal.composition.nodes;
  const ids = new Set(nodes.map((node) => node.id));
  const visited = new Set<string>();
  const compile = (
    source: CompositionNodeOutput,
    path: ReadonlySet<string>,
    width: number,
  ): PenpotNode => {
    const nodeKey = `${key}/${source.id}`;
    if (path.has(source.id)) {
      issues.push({
        code: "PENPOT_PROPOSAL_FALLBACK",
        pointer: `${nodeKey}/parent`,
        message: "Cyclic composition parent; shown as an empty slot.",
      });
      return makeBoard(`${nodeKey}/cycle`, [], { layout: null, width, height: 80 });
    }
    visited.add(source.id);
    const next = new Set(path);
    next.add(source.id);
    const childSources = nodes.filter((node) => node.parent === source.id);
    const fill = proposalColor(proposal, source.fill, "surface", `${nodeKey}/fill`, issues);
    const text = proposalColor(proposal, null, "text", `${nodeKey}/text`, issues);
    const step = proposalStep(proposal, source.typeStep, `${nodeKey}/typeStep`, issues);
    if (source.type === "component") {
      const spec =
        source.component === null ? undefined : proposal.componentSheet[source.component];
      if (spec) {
        const result = componentNodes(spec, proposal, nodeKey, copy);
        issues.push(...result.issues);
        if (result.node.type === "board" && childSources.length > 0) {
          const childWidth = Math.max(
            32,
            result.node.width - 2 * (result.node.layout?.padding ?? 0),
          );
          result.node.children = childSources.map((node) => compile(node, next, childWidth));
        }
        return result.node;
      }
      issues.push({
        code: "PENPOT_PROPOSAL_FALLBACK",
        pointer: `${nodeKey}/component`,
        message: "Unknown component index; shown as a slot.",
      });
    }
    if (source.type === "text")
      return proposalText(proposal, nodeKey, source.text ?? "Aa 0123", text, step, width);
    if (source.type === "image" || source.type === "slot" || source.type === "component") {
      return makeBoard(
        nodeKey,
        [
          proposalText(
            proposal,
            `${nodeKey}/label`,
            source.type === "image" ? `${copy.image} · ${source.imageHint ?? ""}` : copy.slot,
            text,
            step,
            Math.max(1, Math.min(320, width) - 24),
          ),
        ],
        {
          name: `${copy.synthetic} · ${source.type}`,
          width: Math.min(320, width),
          height: 160,
          fill,
          stroke: { color: text, width: 1, style: "dashed" },
          layout: { kind: "flex", dir: "column", gap: 8, padding: 12, wrap: false },
        },
      );
    }
    const columns =
      source.type === "grid"
        ? (source.columns ?? 2)
        : source.direction === "row"
          ? Math.max(1, childSources.length)
          : 1;
    const childWidth = Math.max(32, (width - 32 - 16 * (columns - 1)) / columns);
    const children = childSources.map((node) => compile(node, next, childWidth));
    return makeBoard(nodeKey, children, {
      width,
      fill,
      layout:
        source.type === "grid"
          ? { kind: "grid", columns: source.columns ?? 2, gap: 16, padding: 16 }
          : { kind: "flex", dir: source.direction ?? "column", gap: 16, padding: 16, wrap: false },
    });
  };
  const children = nodes
    .filter((node) => node.parent === null || !ids.has(node.parent))
    .map((node) => compile(node, new Set(), 1248));
  // A malformed persisted graph may have no root; the path guard still guarantees termination.
  for (const node of nodes)
    if (!visited.has(node.id)) children.push(compile(node, new Set(), 1248));
  const fill = proposalColor(proposal, null, "background", `${key}/fill`, issues);
  return {
    node: makeBoard(key, children, {
      name: copy.synthetic,
      width: 1280,
      height: 800,
      fill,
      layout: { kind: "flex", dir: "column", gap: 16, padding: 16, wrap: false },
    }),
    issues,
  };
}
