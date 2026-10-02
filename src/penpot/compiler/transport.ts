import type { PenpotNode } from "./nodes.ts";

/** Positional transport only; semantic nodes and their fingerprints remain unchanged. */
export type PackedPenpotNode = readonly unknown[];

export function packPenpotNode(node: PenpotNode): PackedPenpotNode {
  const common = [node.key, node.name === node.key ? null : node.name];
  if (node.type === "text")
    return [
      0,
      ...common,
      node.characters,
      node.width,
      node.fontFamily,
      node.fontSize,
      node.fontWeight,
      node.lineHeight,
      node.color,
    ];
  if (node.type === "rect")
    return [1, ...common, node.width, node.height, node.fill, node.radius, node.stroke];
  return [
    2,
    ...common,
    node.x,
    node.y,
    node.width,
    node.height,
    node.fill,
    node.radius,
    node.stroke,
    node.layout,
    node.children.map(packPenpotNode),
  ];
}
