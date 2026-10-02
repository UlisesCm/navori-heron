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
