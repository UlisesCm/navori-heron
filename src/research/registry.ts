import { RESEARCH_SOURCE_KINDS, type ResearchSourceKind } from "../core/contracts/index.ts";
import { designMdSource } from "./adapters/design-md/index.ts";
import { imageSource } from "./adapters/image/index.ts";
import { manualSource } from "./adapters/manual/index.ts";
import { urlSource } from "./adapters/url/index.ts";
import type { ResearchSource } from "./ports.ts";

/** Available kinds only (a Partial, never an exhaustive Record): penpot arrives in P6 and refero in P10. */
export const RESEARCH_SOURCES: Readonly<Partial<Record<ResearchSourceKind, ResearchSource>>> = {
  manual: manualSource,
  url: urlSource,
  image: imageSource,
  "design-md": designMdSource,
};

/** null -> ADAPTER_NOT_AVAILABLE (exit 5). */
export function sourceFor(kind: ResearchSourceKind): ResearchSource | null {
  return RESEARCH_SOURCES[kind] ?? null;
}

/** RESEARCH_SOURCE_KINDS order, registered kinds only. */
export function availableSourceKinds(): ResearchSourceKind[] {
  return RESEARCH_SOURCE_KINDS.filter((kind) => RESEARCH_SOURCES[kind] !== undefined);
}
