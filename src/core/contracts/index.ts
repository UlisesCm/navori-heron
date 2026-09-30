import { CLI_ENVELOPE_DOCUMENT, type CliEnvelope } from "./cli-envelope.ts";
import { HERON_PROJECT_DOCUMENT, type HeronProject } from "./heron-project.ts";
import { HERON_STATE_DOCUMENT, type HeronState } from "./heron-state.ts";
import { MODE_DECISION_DOCUMENT, type ModeDecision } from "./mode-decision.ts";
import type { DocumentSpec } from "./version.ts";

export * from "./common.ts";
export * from "./canonical-json.ts";
export * from "./version.ts";
export * from "./heron-project.ts";
export * from "./heron-state.ts";
export * from "./mode-decision.ts";
export * from "./cli-envelope.ts";

/** Registry consumed by scripts/gen-schemas.ts, in this order. */
export const CONTRACT_DOCUMENTS: readonly [
  DocumentSpec<HeronProject>,
  DocumentSpec<HeronState>,
  DocumentSpec<ModeDecision>,
  DocumentSpec<CliEnvelope>,
] = [HERON_PROJECT_DOCUMENT, HERON_STATE_DOCUMENT, MODE_DECISION_DOCUMENT, CLI_ENVELOPE_DOCUMENT];
