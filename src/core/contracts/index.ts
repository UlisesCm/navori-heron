import { CLI_ENVELOPE_DOCUMENT, type CliEnvelope } from "./cli-envelope.ts";
import {
  INTAKE_CONFLICTS_DOCUMENT,
  MANUAL_CONTEXT_DOCUMENT,
  PRODUCT_CONTEXT_DOCUMENT,
  type IntakeConflicts,
  type ManualContext,
  type ProductContext,
} from "./product-context.ts";
import { HERON_PROJECT_DOCUMENT, type HeronProject } from "./heron-project.ts";
import { HERON_STATE_DOCUMENT, type HeronState } from "./heron-state.ts";
import { MODE_DECISION_DOCUMENT, type StoredModeDecision } from "./mode-decision.ts";
import {
  BRAND_INPUTS_DOCUMENT,
  REFERENCE_BATCH_DOCUMENT,
  RESEARCH_PROVENANCE_DOCUMENT,
  RESEARCH_REFERENCES_DOCUMENT,
  type BrandInputs,
  type ReferenceBatch,
  type ResearchProvenance,
  type ResearchReferences,
} from "./research.ts";
import type { DocumentSpec } from "./version.ts";

export * from "./common.ts";
export * from "./canonical-json.ts";
export * from "./version.ts";
export * from "./heron-project.ts";
export * from "./heron-state.ts";
export * from "./mode-decision.ts";
export * from "./cli-envelope.ts";
export * from "./research.ts";
export * from "./research-data.ts";
export * from "./product-context.ts";
export * from "./intake-data.ts";

/** Registry consumed by scripts/gen-schemas.ts, in this order. */
export const CONTRACT_DOCUMENTS: readonly [
  DocumentSpec<HeronProject>,
  DocumentSpec<HeronState>,
  DocumentSpec<StoredModeDecision>,
  DocumentSpec<CliEnvelope>,
  DocumentSpec<ResearchReferences>,
  DocumentSpec<ResearchProvenance>,
  DocumentSpec<BrandInputs>,
  DocumentSpec<ReferenceBatch>,
  DocumentSpec<ProductContext>,
  DocumentSpec<IntakeConflicts>,
  DocumentSpec<ManualContext>,
] = [
  HERON_PROJECT_DOCUMENT,
  HERON_STATE_DOCUMENT,
  MODE_DECISION_DOCUMENT,
  CLI_ENVELOPE_DOCUMENT,
  RESEARCH_REFERENCES_DOCUMENT,
  RESEARCH_PROVENANCE_DOCUMENT,
  BRAND_INPUTS_DOCUMENT,
  REFERENCE_BATCH_DOCUMENT,
  PRODUCT_CONTEXT_DOCUMENT,
  INTAKE_CONFLICTS_DOCUMENT,
  MANUAL_CONTEXT_DOCUMENT,
];
