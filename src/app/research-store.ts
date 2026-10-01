import {
  BRAND_INPUTS_DOCUMENT,
  RESEARCH_PROVENANCE_DOCUMENT,
  RESEARCH_REFERENCES_DOCUMENT,
  type BoundArtifact,
  type BrandInput,
  type BrandInputs,
  type HeronMode,
  type ResearchCounts,
  type ResearchOutputStatus,
  type ResearchReference,
  type ResearchReferences,
} from "../core/contracts/index.ts";
import type { FileStore, StoreTransaction } from "../core/store/file-store.ts";
import { sha256Hex } from "../core/store/hash.ts";
import { RESEARCH_FILES } from "../research/layout.ts";
import { missingProvenance } from "../research/provenance.ts";
import { renderResearchOutputs } from "../research/render/outputs.ts";

/** null = the file is absent (no references yet is not an error). */
export type ResearchSnapshot = { references: ResearchReferences | null; brand: BrandInputs | null };

/** Throws the store's and the document's errors; callers map them with storeErrorResult. */
export function readResearch(store: FileStore): ResearchSnapshot {
  return {
    references: store.readDocument(RESEARCH_FILES.references, RESEARCH_REFERENCES_DOCUMENT),
    brand: store.readDocument(RESEARCH_FILES.brand, BRAND_INPUTS_DOCUMENT),
  };
}

export function researchCounts(
  references: readonly ResearchReference[],
  brand: readonly BrandInput[],
  minimum: number,
): ResearchCounts {
  const active = references.filter((reference) => reference.removed === null);
  return {
    active: active.length,
    removed: references.length - active.length,
    withProvenance: active.filter((reference) => missingProvenance(reference).length === 0).length,
    minimum,
    brandInputs: brand.length,
  };
}

export type StagedOutputs = {
  artifacts: BoundArtifact[];
  outputs: ResearchOutputStatus[];
  locale: string;
  fallback: boolean;
};

/** renderResearchOutputs, then tx.put only for the outputs whose bytes differ from disk; `artifacts` lists all 4. */
export function stageResearchOutputs(
  tx: StoreTransaction,
  store: FileStore,
  input: {
    references: ResearchReference[];
    brand: BrandInput[];
    currentMode: HeronMode;
    locale: string | null;
    minimum: number;
  },
): StagedOutputs {
  const rendered = renderResearchOutputs(input);
  const outputs = [
    {
      path: RESEARCH_FILES.references,
      text: rendered.referencesText,
      write: () =>
        tx.putDocument(
          RESEARCH_FILES.references,
          RESEARCH_REFERENCES_DOCUMENT,
          rendered.references,
        ),
    },
    {
      path: RESEARCH_FILES.provenance,
      text: rendered.provenanceText,
      write: () =>
        tx.putDocument(
          RESEARCH_FILES.provenance,
          RESEARCH_PROVENANCE_DOCUMENT,
          rendered.provenance,
        ),
    },
    {
      path: RESEARCH_FILES.markdown,
      text: rendered.markdown,
      write: () => tx.put(RESEARCH_FILES.markdown, rendered.markdown),
    },
    {
      path: RESEARCH_FILES.moodboard,
      text: rendered.moodboard,
      write: () => tx.put(RESEARCH_FILES.moodboard, rendered.moodboard),
    },
  ].map(({ path, text, write }): ResearchOutputStatus => {
    const sha256 = sha256Hex(new TextEncoder().encode(text));
    const written = store.sha256(path) !== sha256;
    if (written) write();
    return { path, sha256, written };
  });
  return {
    artifacts: outputs.map(({ path, sha256 }) => ({ path, sha256 })),
    outputs,
    locale: rendered.locale,
    fallback: rendered.fallback,
  };
}
