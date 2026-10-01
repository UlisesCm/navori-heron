import type { z } from "zod";
import {
  DirectionProposalOutputSchema,
  ProbeOutputSchema,
  ResearchAnalysisOutputSchema,
  ResearchBriefOutputSchema,
  type AgentRole,
  type AgentTaskId,
  type DirectionProposalOutput,
  type PackItemKind,
  type ProbeOutput,
  type ResearchAnalysisOutput,
  type ResearchBriefOutput,
} from "../core/contracts/index.ts";
import { templateFor, type PromptTemplate } from "./prompts.ts";

export type AgentTaskSpec<T> = {
  id: AgentTaskId;
  role: AgentRole;
  template: PromptTemplate;
  output: z.ZodType<T>;
  /** Projection of the context pack: kinds outside this list are a programming error (DR8, DR44). */
  allowedItems: readonly PackItemKind[];
  /** Whether invalid output is repaired (DR10). */
  repair: boolean;
  /** DR42: becomes CLAUDE_CODE_MAX_OUTPUT_TOKENS in the child environment. */
  maxOutputTokens: number;
};

export const AGENT_TASKS: {
  "research-brief": AgentTaskSpec<ResearchBriefOutput>;
  "research-analyze": AgentTaskSpec<ResearchAnalysisOutput>;
  "direction-propose": AgentTaskSpec<DirectionProposalOutput>;
  probe: AgentTaskSpec<ProbeOutput>;
} = {
  "research-brief": {
    id: "research-brief",
    role: "creator",
    template: templateFor("visual-researcher/research-brief"),
    output: ResearchBriefOutputSchema,
    allowedItems: ["task-input", "operator-query", "brand-input", "reference", "reference-origin"],
    repair: true,
    maxOutputTokens: 4_000,
  },
  "research-analyze": {
    id: "research-analyze",
    role: "creator",
    template: templateFor("visual-researcher/research-analyze"),
    output: ResearchAnalysisOutputSchema,
    allowedItems: [
      "task-input",
      "reference",
      "reference-origin",
      "external-text",
      "brief-query",
      "brand-input",
    ],
    repair: true,
    maxOutputTokens: 8_000,
  },
  "direction-propose": {
    id: "direction-propose",
    role: "creator",
    template: templateFor("design-director/direction-propose"),
    output: DirectionProposalOutputSchema,
    // DR44: never external-text or reference-origin.
    allowedItems: [
      "task-input",
      "reference",
      "analysis-note",
      "brief-query",
      "brand-input",
      "contrast-policy",
    ],
    repair: true,
    maxOutputTokens: 16_000,
  },
  probe: {
    id: "probe",
    role: "creator",
    template: templateFor("shared/probe"),
    output: ProbeOutputSchema,
    allowedItems: ["task-input"],
    repair: false,
    maxOutputTokens: 500,
  },
};
