import type { HeronMode, Sha256Hex, TemplateRef } from "../../core/contracts/index.ts";

export const HERON_NAMESPACE = "heron";
export type Hex = string;
export type BoardLayout =
  | { kind: "flex"; dir: "row" | "column"; gap: number; padding: number; wrap: boolean }
  | { kind: "grid"; columns: number; gap: number; padding: number };
type Stroke = { color: Hex; width: number; style: "solid" | "dashed" };
export type PenpotNode =
  | {
      type: "board";
      key: string;
      name: string;
      x: number;
      y: number;
      width: number;
      height: number | null;
      fill: Hex | null;
      radius: number;
      stroke: Stroke | null;
      layout: BoardLayout | null;
      children: PenpotNode[];
    }
  | {
      type: "rect";
      key: string;
      name: string;
      width: number;
      height: number;
      fill: Hex | null;
      radius: number;
      stroke: Stroke | null;
    }
  | {
      type: "text";
      key: string;
      name: string;
      characters: string;
      width: number | null;
      fontFamily: string;
      fontSize: number;
      fontWeight: number;
      lineHeight: number;
      color: Hex;
    };
export type ReviewPageKind = "proposal-page" | "references-page";
export type CompileIssue = {
  code: "PENPOT_PROPOSAL_FALLBACK" | "PENPOT_REFERENCES_TRUNCATED";
  message: string;
  pointer: string | null;
};
export type ReviewPage = {
  heronId: string;
  kind: ReviewPageKind;
  name: string;
  mode: HeronMode;
  sourceSha256: Sha256Hex;
  nodes: PenpotNode[];
  template: TemplateRef;
  contentSha256: Sha256Hex;
  issues: CompileIssue[];
};

export type BoardNode = Extract<PenpotNode, { type: "board" }>;
export type TextNode = Extract<PenpotNode, { type: "text" }>;
export type RectNode = Extract<PenpotNode, { type: "rect" }>;

/** Small, pure constructors shared by the section, component and composition recipes. */
export function makeBoard(
  key: string,
  children: PenpotNode[],
  options: Partial<Omit<BoardNode, "type" | "key" | "children">> = {},
): BoardNode {
  return {
    type: "board",
    key,
    name: key,
    x: 0,
    y: 0,
    width: 320,
    height: null,
    fill: null,
    radius: 0,
    stroke: null,
    layout: { kind: "flex", dir: "column", gap: 12, padding: 0, wrap: false },
    ...options,
    children,
  };
}
export function makeText(
  key: string,
  characters: string,
  options: Partial<Omit<TextNode, "type" | "key" | "characters">> = {},
): TextNode {
  return {
    type: "text",
    key,
    name: key,
    characters,
    width: 320,
    fontFamily: "Inter",
    fontSize: 16,
    fontWeight: 400,
    lineHeight: 1.4,
    color: "#18212B",
    ...options,
  };
}
export function makeRect(
  key: string,
  width: number,
  height: number,
  options: Partial<Omit<RectNode, "type" | "key" | "width" | "height">> = {},
): RectNode {
  return {
    type: "rect",
    key,
    name: key,
    width,
    height,
    fill: null,
    radius: 0,
    stroke: null,
    ...options,
  };
}
