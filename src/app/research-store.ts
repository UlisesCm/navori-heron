import { join } from "node:path";
import {
  BRAND_INPUTS_DOCUMENT,
  RESEARCH_ANALYSIS_DOCUMENT,
  RESEARCH_BRIEF_DOCUMENT,
  RESEARCH_PROVENANCE_DOCUMENT,
  RESEARCH_REFERENCES_DOCUMENT,
  VISUAL_DIRECTIONS_DOCUMENT,
  type BoundArtifact,
  type BrandInput,
  type BrandInputs,
  type HeronMode,
  type ResearchCounts,
  type ResearchAnalysis,
  type ResearchBrief,
  type ResearchOutputStatus,
  type ResearchReference,
  type ResearchReferences,
  type VisualDirections,
} from "../core/contracts/index.ts";
import type { FileStore, StoreTransaction } from "../core/store/file-store.ts";
import type { ReadonlyFs } from "../core/store/fs-port.ts";
import { sha256Hex } from "../core/store/hash.ts";
import { RESEARCH_FILES } from "../research/layout.ts";
import { missingProvenance } from "../research/provenance.ts";
import { renderResearchOutputs } from "../research/render/outputs.ts";
import type { AgentDocuments } from "../research/render/references-md.ts";

/** null = the file is absent (no references yet is not an error). */
export type ResearchSnapshot = {
  references: ResearchReferences | null;
  brand: BrandInputs | null;
  brief: ResearchBrief | null;
  analysis: ResearchAnalysis | null;
  directions: VisualDirections | null;
};

/** The agent documents of a snapshot, as the research views take them. */
export const agentDocuments = (snapshot: ResearchSnapshot): AgentDocuments => ({
  brief: snapshot.brief,
  analysis: snapshot.analysis,
  directions: snapshot.directions,
});

/** Throws the store's and the document's errors; callers map them with storeErrorResult. */
export function readResearch(store: FileStore): ResearchSnapshot {
  return {
    references: store.readDocument(RESEARCH_FILES.references, RESEARCH_REFERENCES_DOCUMENT),
    brand: store.readDocument(RESEARCH_FILES.brand, BRAND_INPUTS_DOCUMENT),
    brief: store.readDocument(RESEARCH_FILES.brief, RESEARCH_BRIEF_DOCUMENT),
    analysis: store.readDocument(RESEARCH_FILES.analysis, RESEARCH_ANALYSIS_DOCUMENT),
    directions: store.readDocument(RESEARCH_FILES.directions, VISUAL_DIRECTIONS_DOCUMENT),
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
    agent: AgentDocuments;
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

/** Bytes of `research/assets/**` + `brand/assets/**` under `.heron/`; symlinks and anything unreadable are skipped. */
export function assetBytes(fs: ReadonlyFs, heronDir: string): number {
  const walk = (dir: string): number => {
    let names: string[];
    try {
      names = fs.readdirSync(dir);
    } catch {
      return 0; // directory absent: no assets yet
    }
    let total = 0;
    for (const name of names) {
      const path = join(dir, name);
      const stat = fs.lstatSync(path);
      if (stat.isSymbolicLink()) continue;
      total += stat.isDirectory() ? walk(path) : stat.isFile() ? stat.size : 0;
    }
    return total;
  };
  return (
    walk(join(heronDir, RESEARCH_FILES.assets)) + walk(join(heronDir, RESEARCH_FILES.brandAssets))
  );
}
