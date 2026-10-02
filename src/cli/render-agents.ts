import type {
  AgentRunSummary,
  DirectionProposeData,
  DirectionSelectData,
  VisualDirection,
  ResearchAnalyzeData,
  ResearchBriefData,
} from "../core/contracts/index.ts";
import { safeText } from "./render-research.ts";
import { MODE_LABELS } from "./render.ts";

const tokens = (value: number | null): number => value ?? 0;

/** `Agent: …` line of a run; every field that came from the agent or the provider is made terminal-safe. */
function agentLine(run: AgentRunSummary): string {
  if (run.reused) {
    return `Agent: reused run ${run.runId} (inputs unchanged; pass --force to ask again)`;
  }
  const model = run.model === null ? "default model" : safeText(run.model);
  return `Agent: ${run.provider} (${model}), ${run.attempts} attempt(s), ${(run.durationMs / 1000).toFixed(1)} s, ${tokens(run.usage.inputTokens)} in / ${tokens(run.usage.outputTokens)} out / ${tokens(run.usage.cachedInputTokens)} cached tokens · run ${run.runId}`;
}

const writtenLine = (written: readonly string[]): string[] =>
  written.length === 0 ? [] : [`Written: ${written.join(", ")}`];

/** Text of `heron research brief`; agent-authored text goes through safeText. */
export function renderResearchBriefText(data: ResearchBriefData): string {
  const { brief } = data;
  const facets = new Set(brief.queries.map((query) => query.facet));
  const provided = brief.queries.filter((query) => query.origin === "provided").length;
  return [
    `Research brief (${MODE_LABELS[brief.mode]}): ${brief.queries.length} queries across ${facets.size} facets (${provided} from you)`,
    ...brief.queries.map(
      (query) =>
        `  ${query.id} [${query.facet}] ${safeText(query.query)}: ${safeText(query.question ?? query.job)}`,
    ),
    agentLine(data.run),
    ...writtenLine(data.written),
  ].join("\n");
}

/** Text of `heron research analyze`. */
export function renderResearchAnalyzeText(data: ResearchAnalyzeData): string {
  const upToDate = data.fresh.length > 0 ? `: ${data.fresh.join(", ")}` : "";
  const pending =
    data.pending.length === 0
      ? []
      : [`Pending: ${data.pending.join(", ")} (over the 30-reference pack limit; run again)`];
  if (data.analyzed.length === 0) {
    return data.fresh.length === 0
      ? "No references to analyze."
      : [
          `All ${data.fresh.length} active reference(s) are already analyzed; nothing was sent to the agent.`,
          ...(data.run === null ? [] : [agentLine(data.run)]),
        ].join("\n");
  }
  const notes = (data.analysis?.analyses ?? []).filter((entry) =>
    data.analyzed.includes(entry.reference),
  );
  const mode = data.analysis === null ? "REFERENCE ONLY" : MODE_LABELS[data.analysis.mode];
  return [
    `Analyzed ${data.analyzed.length} reference(s) (${mode}); ${data.fresh.length} already up to date${upToDate}`,
    ...notes.map(
      (entry) =>
        `  ${entry.reference}: ${entry.observations.length} observation(s), facets ${entry.facets.join(", ")} (inferred)`,
    ),
    ...(data.run === null ? [] : [agentLine(data.run)]),
    ...writtenLine(data.written),
    ...pending,
  ].join("\n");
}

/** `{DIR-x} {name}: cites {REF ids} · {c} colors, {p} pairs (min contrast {ratio}) · {s} type steps · {k} components`. */
function directionLine(direction: VisualDirection): string {
  const { palette, typeScale, componentSheet } = direction.proposal;
  const cited = [...new Set(direction.attributes.references.map((entry) => entry.reference))];
  const lowest = Math.min(...palette.pairs.map((pair) => pair.contrast.ratio));
  return `  ${direction.id} ${safeText(direction.name)}: cites ${cited.join(", ")} · ${palette.colors.length} colors, ${palette.pairs.length} pairs (min contrast ${lowest.toFixed(2)}) · ${typeScale.steps.length} type steps · ${componentSheet.length} components`;
}

/** Text of `heron direction propose`; agent-authored text goes through safeText. */
export function renderDirectionProposeText(data: DirectionProposeData, path: string): string {
  const { directions } = data;
  return [
    `Proposed 3 visual directions (${MODE_LABELS[directions.mode]}, exploratory): ${data.phase.from} -> ${data.phase.to}`,
    ...directions.directions.map(directionLine),
    agentLine(data.run),
    ...writtenLine(data.written),
    `Next: heron direction select <DIR-x> ${path}`,
  ].join("\n");
}

/** Text of `heron direction select`. */
export function renderDirectionSelectText(data: DirectionSelectData): string {
  const { selection } = data;
  return [
    `Preferred direction: ${selection.direction} "${safeText(data.name)}" (the direction gate is not approved)`,
    `Recorded by ${safeText(selection.decidedBy)} at ${selection.decidedAt} · state revision ${data.stateRevision}`,
  ].join("\n");
}
