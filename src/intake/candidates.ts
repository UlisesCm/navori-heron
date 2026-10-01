import type {
  ProductContextSection,
  RelativeArtifactPath,
  SourceKind,
} from "../core/contracts/index.ts";
import type { Candidate } from "./ports.ts";

export type CandidateOrigin = { source: SourceKind; path: RelativeArtifactPath };

/** Collects the candidates of one source; `order` is the appearance index within that source. */
export type CandidateSink = {
  readonly items: Candidate[];
  add<S extends ProductContextSection>(
    section: S,
    key: string,
    value: Extract<Candidate, { section: S }>["value"],
    locator: string,
  ): void;
};

export function candidateSink(origin: CandidateOrigin): CandidateSink {
  const items: Candidate[] = [];
  return {
    items,
    add(section, key, value, locator) {
      // TypeScript cannot correlate `section` with `value` through the generic; the signature does.
      items.push({
        section,
        key,
        value,
        ref: { source: origin.source, path: origin.path, locator },
        order: items.length,
      } as Candidate);
    },
  };
}
