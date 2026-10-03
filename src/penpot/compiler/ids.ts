import {
  canonicalJson,
  type DirectionId,
  type HeronMode,
  type ResearchReference,
  type Sha256Hex,
  type TemplateRef,
  type VisualDirection,
} from "../../core/contracts/index.ts";
import { sha256Hex } from "../../core/store/hash.ts";
import type { PenpotNode } from "./nodes.ts";

export const REFERENCES_PAGE_ID = "heron:references";
export const proposalPageId = (direction: DirectionId): string => `heron:proposal:${direction}`;
const hashJson = (value: unknown): Sha256Hex =>
  sha256Hex(new TextEncoder().encode(canonicalJson(value)));
export const proposalSourceSha256 = (direction: VisualDirection): Sha256Hex => hashJson(direction);
/** Numeric reference order matches the persisted reference document (REF-2 before REF-10). */
export function activeReferences(references: readonly ResearchReference[]): ResearchReference[] {
  return references
    .filter((reference) => reference.removed === null)
    .toSorted((a, b) => Number(a.id.slice(4)) - Number(b.id.slice(4)));
}
export const referencesSourceSha256 = (references: readonly ResearchReference[]): Sha256Hex =>
  hashJson(activeReferences(references));
export function contentSha256(input: {
  template: TemplateRef;
  heronId: string;
  name: string;
  mode: HeronMode;
  sourceSha256: Sha256Hex;
  nodes: PenpotNode[];
}): Sha256Hex {
  const { template, heronId, name, mode, sourceSha256, nodes } = input;
  return hashJson({ template, heronId, name, mode, sourceSha256, nodes });
}
