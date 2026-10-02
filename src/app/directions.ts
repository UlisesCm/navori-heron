import { referenceItems } from "../agents/context-pack.ts";
import type { ContextItem } from "../agents/ports.ts";
import { AGENT_TASKS } from "../agents/tasks.ts";
import {
  AGENT_RUN_DOCUMENT,
  DIRECTION_IDS,
  ExitCode,
  VISUAL_DIRECTIONS_DOCUMENT,
  type AgentRunRef,
  type DirectionProposeData,
  type DirectionSelectData,
  type Finding,
  type HeronState,
  type ReferenceAnalysis,
  type ResearchReference,
} from "../core/contracts/index.ts";
import { freshen, recordCommand, withArtifacts } from "../core/state/lifecycle.ts";
import { applyTransition, canTransition } from "../core/state/transitions.ts";
import { RESEARCH_FILES, runPath } from "../research/layout.ts";
import { freshAnalyses } from "../research/analysis.ts";
import {
  buildVisualDirections,
  selectDirection,
  validateDirectionsOutput,
} from "../research/directions.ts";
import { researchMode } from "../research/provenance.ts";
import { CONTRAST_THRESHOLDS, checkContrast } from "../tokens/contrast.ts";
import { executeAgentStep, finalizeAgentRun } from "./agent-task.ts";
import type { AppContext } from "./context.ts";
import { collectDirectionFacts } from "./facts.ts";
import {
  activeOf,
  boundInputs,
  brandItems,
  queryContent,
  reusedSummary,
  runSummary,
  stepFailure,
  textItem,
} from "./research.ts";
import { agentDocuments, readResearch, stageResearchOutputs } from "./research-store.ts";
import {
  failure,
  makeFinding,
  rejectionToFinding,
  storeErrorResult,
  type UseCaseResult,
} from "./result.ts";
import { loadWorkspace } from "./workspace.ts";
import { withWriteRun, type WriteBodyResult } from "./write-run.ts";

export type DirectionProposeInput = { path: string; force: boolean };
export type DirectionSelectInput = { path: string; direction: string; note: string | null };

const DIRECTIONS_REASON = "Visual directions changed.";

/** DR44: a reference with a fresh saved analysis goes in as its minimal projection plus the analysis note; any other
 * reference goes in as the normal projection. Never raw sources (no `reference-origin`, no `external-text`). */
function directionItems(
  reference: ResearchReference,
  analysis: ReferenceAnalysis | undefined,
): ContextItem[] {
  const [base] = referenceItems(reference);
  if (base === undefined) return [];
  if (analysis === undefined) return [base];
  const minimal = [
    `id: ${reference.id}`,
    `reason: ${reference.reason}`,
    `doNotCopy: ${reference.doNotCopy.join("; ") || "none"}`,
    `influences: ${reference.influences.join("; ") || "none"}`,
  ].join("\n");
  const note = [
    ...analysis.observations.map((entry) => `${entry.aspect}: ${entry.note}`),
    `facets: ${analysis.facets.join(", ")}`,
  ].join("\n");
  return [
    { ...base, content: minimal },
    textItem("analysis-note", reference.id, "untrusted", 2, note),
  ];
}

const contrastPolicy = (): string =>
  Object.entries(CONTRAST_THRESHOLDS)
    .map(([usage, ratio]) => `${usage}: contrast ratio >= ${ratio}`)
    .join("\n");

/**
 * loadWorkspace (R) -> canTransition(directions-proposed) with the hypothetical 3 valid directions (research approval
 * invalid or no row: exit 3, before any agent call) -> pack from the saved analyses (DR44) -> executeAgentStep (cache,
 * DR39; validator with the T6 contrast check) -> withWriteRun(R): visual-directions.json, run record, views,
 * applyTransition + withArtifacts + freshen. A reused run sends and writes nothing.
 */
export async function runDirectionPropose(
  ctx: AppContext,
  input: DirectionProposeInput,
): Promise<UseCaseResult<DirectionProposeData>> {
  try {
    const loaded = loadWorkspace(ctx, input.path);
    if (!loaded.ok) return loaded.result;
    const ws = loaded.workspace;
    const event = { type: "directions-proposed" } as const;
    const checked = canTransition({ ...ws.state, mode: ws.mode }, event, {
      validDirections: 3,
      ...collectDirectionFacts(ws.store, ws.state),
    });
    if (!checked.ok) return failure(ExitCode.Blocked, rejectionToFinding(checked, ws.blocked));

    const research = readResearch(ws.store);
    const references = activeOf(research.references?.references ?? []);
    const notes = new Map(
      freshAnalyses(research.analysis, references).map((entry) => [entry.reference, entry]),
    );
    const brief = research.brief;
    const items: ContextItem[] = [
      textItem(
        "task-input",
        "task-input",
        "heron",
        0,
        `Valid reference ids: ${references.map((reference) => reference.id).join(", ")}\nDirection ids: ${DIRECTION_IDS.join(", ")}`,
      ),
      textItem("contrast-policy", "contrast-policy", "heron", 0, contrastPolicy()),
      ...(brief?.queries ?? []).map((query) =>
        textItem(
          "brief-query",
          query.id,
          query.origin === "provided" ? "operator" : "untrusted",
          2,
          queryContent(query),
        ),
      ),
      ...brandItems(research.brand?.inputs ?? []),
      ...references.flatMap((reference) => directionItems(reference, notes.get(reference.id))),
    ];

    const runId = ctx.ids.runId(ctx.clock.now());
    const step = await executeAgentStep(
      ctx,
      {
        workspace: ws,
        spec: AGENT_TASKS["direction-propose"],
        items,
        inputs: boundInputs(ws, [
          RESEARCH_FILES.references,
          RESEARCH_FILES.brand,
          RESEARCH_FILES.brief,
          RESEARCH_FILES.analysis,
          RESEARCH_FILES.directions,
        ]),
        references: references.map((reference) => reference.id),
        validate: (output) =>
          validateDirectionsOutput(output, {
            activeReferences: references.map((reference) => reference.id),
            checkContrast,
          }),
        command: "direction propose",
        overBudgetRemedy:
          "Remove references (heron references remove) or raise agents.contextBudgetChars.",
        previous:
          research.directions === null
            ? null
            : { run: research.directions.run, documentPath: RESEARCH_FILES.directions },
        userFields: ["selection"],
        force: input.force,
      },
      runId,
    );
    if (!step.ok) return stepFailure(step);
    const next = [`heron direction select <DIR-x> ${input.path}`];
    if (step.reused) {
      if (research.directions === null) throw new Error("a reused run implies stored directions");
      return {
        ok: true,
        data: {
          directions: research.directions,
          run: reusedSummary(ctx, input.path, step.run, "direction-propose"),
          phase: { from: ws.state.phase, to: ws.state.phase },
          written: [],
          stateRevision: ws.state.stateRevision,
        },
        findings: step.findings,
        next,
      };
    }

    const scoped: AppContext = { ...ctx, ids: { runId: () => runId } };
    return await withWriteRun(
      scoped,
      ws.root,
      {
        path: input.path,
        command: "direction propose",
        create: false,
        requireState: true,
        expectedRevision: ws.state.stateRevision,
      },
      ({ store, tx, previous, meta }): WriteBodyResult<DirectionProposeData> => {
        if (previous === null) throw new Error("withWriteRun requireState guarantees state.json");
        const snapshot = readResearch(store);
        const state: HeronState = { ...previous, mode: ws.mode };
        const outcome = applyTransition(
          state,
          event,
          { validDirections: 3, ...collectDirectionFacts(store, state) },
          meta,
        );
        if (!outcome.ok) {
          return {
            kind: "skip",
            result: failure(ExitCode.Blocked, rejectionToFinding(outcome, ws.blocked)),
          };
        }
        const draft = step.draft;
        const first = draft.invocations[0];
        if (first === undefined) throw new Error("a succeeded run has at least one invocation");
        const ref: AgentRunRef = {
          runId,
          path: runPath(runId),
          provider: draft.provider,
          template: first.template,
          cacheKey: draft.cacheKey,
        };
        const activeRefs = activeOf(snapshot.references?.references ?? []);
        const directions = buildVisualDirections(step.output, {
          checkContrast,
          proposedAt: meta.at,
          run: ref,
          basis: {
            references: activeRefs.map((reference) => reference.id),
            brief: store.sha256(RESEARCH_FILES.brief),
            analysis: store.sha256(RESEARCH_FILES.analysis),
          },
        });
        const sha = tx.putDocument(
          RESEARCH_FILES.directions,
          VISUAL_DIRECTIONS_DOCUMENT,
          directions,
        );
        const run = finalizeAgentRun(
          draft,
          [{ path: RESEARCH_FILES.directions, sha256: sha }],
          [
            {
              kind: "VisualDirections",
              schemaVersion: VISUAL_DIRECTIONS_DOCUMENT.schemaVersion,
            },
          ],
        );
        tx.putDocument(ref.path, AGENT_RUN_DOCUMENT, run);
        const staged = stageResearchOutputs(tx, store, {
          references: snapshot.references?.references ?? [],
          brand: snapshot.brand?.inputs ?? [],
          currentMode: ws.mode,
          locale: ws.project.product?.locale ?? null,
          minimum: ctx.research.minReferences,
          agent: { ...agentDocuments(snapshot), directions },
        });
        const committed = freshen(
          withArtifacts(
            { ...outcome.state, mode: previous.mode },
            [{ path: RESEARCH_FILES.directions, sha256: sha }, ...staged.artifacts],
            DIRECTIONS_REASON,
          ),
          [RESEARCH_FILES.directions],
        );
        const findings: Finding[] = [...step.findings];
        const cleared = snapshot.directions?.selection;
        if (cleared !== null && cleared !== undefined) {
          findings.push(
            makeFinding(
              "DIRECTION_PREFERENCE_CLEARED",
              "warning",
              `The previous preference (${cleared.direction}) belonged to the replaced directions and was cleared.`,
            ),
          );
        }
        if (researchMode(snapshot.references?.references ?? [], ws.mode) === "full") {
          findings.push(
            makeFinding(
              "DIRECTIONS_WITHOUT_UX_CONTEXT",
              "info",
              "Directions are exploratory (reference-only): full-mode directions with ux.json context arrive with P5.",
            ),
          );
        }
        return {
          kind: "commit",
          state: committed,
          data: {
            directions,
            run: runSummary(run),
            phase: { from: previous.phase, to: committed.phase },
            written: [
              RESEARCH_FILES.directions,
              ref.path,
              ...staged.outputs.filter((output) => output.written).map((output) => output.path),
            ],
            stateRevision: committed.stateRevision,
          },
          findings,
          next,
        };
      },
    );
  } catch (error) {
    const mapped = storeErrorResult<DirectionProposeData>(error);
    if (mapped === null) throw error;
    return mapped;
  }
}

/**
 * identity (IDENTITY_REQUIRED, exit 3) -> loadWorkspace -> withWriteRun(null):
 * visual-directions.json (absent: TRANSITION_NOT_ALLOWED, exit 3) -> selectDirection (DIRECTION_NOT_FOUND, exit 2) ->
 * recordCommand + withArtifacts. Records a preference; never approves the direction gate.
 */
export async function runDirectionSelect(
  ctx: AppContext,
  input: DirectionSelectInput,
): Promise<UseCaseResult<DirectionSelectData>> {
  const decidedBy = ctx.identity.current()?.trim() ?? "";
  if (decidedBy === "") {
    return failure(
      ExitCode.Blocked,
      makeFinding(
        "IDENTITY_REQUIRED",
        "error",
        "Cannot determine who is selecting the direction (OS user is empty).",
      ),
    );
  }
  try {
    const loaded = loadWorkspace(ctx, input.path);
    if (!loaded.ok) return loaded.result;
    const ws = loaded.workspace;
    return await withWriteRun(
      ctx,
      ws.root,
      {
        path: input.path,
        command: "direction select",
        create: false,
        requireState: true,
        expectedRevision: null,
      },
      ({ store, tx, previous, meta }): WriteBodyResult<DirectionSelectData> => {
        if (previous === null) throw new Error("withWriteRun requireState guarantees state.json");
        const snapshot = readResearch(store);
        const document = snapshot.directions;
        if (document === null) {
          return {
            kind: "skip",
            result: failure(
              ExitCode.Blocked,
              makeFinding(
                "TRANSITION_NOT_ALLOWED",
                "error",
                `No visual directions to select from. Run: heron direction propose ${input.path}`,
              ),
            ),
          };
        }
        const selected = selectDirection(document, input.direction, {
          mode: ws.mode,
          decidedBy,
          decidedAt: meta.at,
          note: input.note,
          stateRevision: previous.stateRevision + 1,
        });
        if ("error" in selected) {
          return {
            kind: "skip",
            result: failure(
              ExitCode.Usage,
              makeFinding(
                "DIRECTION_NOT_FOUND",
                "error",
                `Direction ${input.direction} not found; expected one of: ${DIRECTION_IDS.join(", ")}.`,
              ),
            ),
          };
        }
        const selection = selected.selection;
        const picked = selected.directions.find((entry) => entry.id === selection?.direction);
        if (selection === null || picked === undefined) {
          throw new Error("selectDirection returns a selection for a found direction");
        }
        const sha = tx.putDocument(RESEARCH_FILES.directions, VISUAL_DIRECTIONS_DOCUMENT, selected);
        const staged = stageResearchOutputs(tx, store, {
          references: snapshot.references?.references ?? [],
          brand: snapshot.brand?.inputs ?? [],
          currentMode: ws.mode,
          locale: ws.project.product?.locale ?? null,
          minimum: ctx.research.minReferences,
          agent: { ...agentDocuments(snapshot), directions: selected },
        });
        const state = withArtifacts(
          recordCommand(previous, meta),
          [{ path: RESEARCH_FILES.directions, sha256: sha }, ...staged.artifacts],
          DIRECTIONS_REASON,
        );
        return {
          kind: "commit",
          state,
          data: {
            selection,
            name: picked.name,
            phase: state.phase,
            written: [
              RESEARCH_FILES.directions,
              ...staged.outputs.filter((output) => output.written).map((output) => output.path),
            ],
            stateRevision: state.stateRevision,
          },
          findings: [],
          next: [`heron status ${input.path}`],
        };
      },
    );
  } catch (error) {
    const mapped = storeErrorResult<DirectionSelectData>(error);
    if (mapped === null) throw error;
    return mapped;
  }
}
