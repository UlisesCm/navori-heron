import {
  canonicalJson,
  type BrandInput,
  type HeronMode,
  type ResearchCounts,
  type ResearchProvenance,
  type ResearchReference,
  type ResearchReferences,
} from "../../core/contracts/index.ts";
import { sha256Hex } from "../../core/store/hash.ts";
import { byIdNumber, missingProvenance, researchMode } from "../provenance.ts";
import { resolveCopy, type SupportedLocale } from "./copy.ts";
import { renderMoodboardHtml } from "./moodboard.ts";
import { buildProvenance } from "./provenance.ts";
import {
  renderReferencesMarkdown,
  type AgentDocuments,
  type ResearchModel,
} from "./references-md.ts";

export type ResearchOutputs = {
  references: ResearchReferences;
  referencesText: string; // canonicalJson
  provenance: ResearchProvenance;
  provenanceText: string; // canonicalJson
  markdown: string;
  moodboard: string;
  mode: HeronMode;
  locale: SupportedLocale;
  fallback: boolean;
};

/** Pure and deterministic: same inputs -> same bytes. mode = researchMode(references, currentMode). */
export function renderResearchOutputs(input: {
  references: readonly ResearchReference[];
  brand: readonly BrandInput[];
  currentMode: HeronMode;
  locale: string | null;
  minimum: number;
  agent: AgentDocuments;
}): ResearchOutputs {
  const references = byIdNumber(input.references);
  const mode = researchMode(references, input.currentMode);
  const active = references.filter((reference) => reference.removed === null);
  const counts: ResearchCounts = {
    active: active.length,
    removed: references.length - active.length,
    withProvenance: active.filter((reference) => missingProvenance(reference).length === 0).length,
    minimum: input.minimum,
    brandInputs: input.brand.length,
  };
  const document: ResearchReferences = {
    kind: "ResearchReferences",
    schemaVersion: 1,
    mode,
    references,
  };
  const referencesText = canonicalJson(document);
  const provenance = buildProvenance(
    references,
    mode,
    sha256Hex(new TextEncoder().encode(referencesText)),
  );
  const { locale, copy, fallback } = resolveCopy(input.locale);
  const model: ResearchModel = {
    mode,
    references,
    brand: byIdNumber(input.brand),
    counts,
    agent: input.agent,
  };
  return {
    references: document,
    referencesText,
    provenance,
    provenanceText: canonicalJson(provenance),
    markdown: renderReferencesMarkdown(model, copy),
    moodboard: renderMoodboardHtml(model, copy, locale),
    mode,
    locale,
    fallback,
  };
}
