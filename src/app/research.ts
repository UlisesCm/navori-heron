import { ExitCode, type Finding, type ResearchRenderData } from "../core/contracts/index.ts";
import { recordCommand, withArtifacts } from "../core/state/lifecycle.ts";
import { canTransition } from "../core/state/transitions.ts";
import { RESEARCH_FILES } from "../research/layout.ts";
import { researchMode } from "../research/provenance.ts";
import type { AppContext } from "./context.ts";
import {
  agentDocuments,
  readResearch,
  researchCounts,
  stageResearchOutputs,
} from "./research-store.ts";
import { failure, makeFinding, storeErrorResult, type UseCaseResult } from "./result.ts";
import { loadWorkspace } from "./workspace.ts";
import { withWriteRun, type WriteBodyResult } from "./write-run.ts";

export type ResearchRenderInput = { path: string };

const RESEARCH_REASON = "An upstream research artifact changed.";
const GATED_OUTPUTS: readonly string[] = [RESEARCH_FILES.references, RESEARCH_FILES.provenance];

function fallbackFinding(locale: string | null, path: string): Finding {
  return makeFinding(
    "LOCALE_FALLBACK",
    "warning",
    locale === null
      ? `No product locale is set; research artifacts are rendered in en. Run: heron init ${path} --locale <bcp47>`
      : `No research copy for locale "${locale}"; artifacts are rendered in en.`,
  );
}

/** loadWorkspace -> withWriteRun(expectedRevision null): stageResearchOutputs; nothing changed -> skip (written false, same
 * revision); production phase and references.json or provenance.json would change -> TRANSITION_NOT_ALLOWED (exit 3, DR4);
 * else recordCommand + withArtifacts -> commit. LOCALE_FALLBACK (warning) when the catalog falls back to en. */
export async function runResearchRender(
  ctx: AppContext,
  input: ResearchRenderInput,
): Promise<UseCaseResult<ResearchRenderData>> {
  let root: string;
  try {
    const loaded = loadWorkspace(ctx, input.path);
    if (!loaded.ok) return loaded.result;
    root = loaded.workspace.root;
    const { workspace: ws } = loaded;
    return await withWriteRun(
      ctx,
      root,
      {
        path: input.path,
        command: "research render",
        create: false,
        requireState: true,
        expectedRevision: null,
      },
      ({ store, tx, previous, meta }): WriteBodyResult<ResearchRenderData> => {
        if (previous === null) throw new Error("withWriteRun requireState guarantees state.json");
        const research = readResearch(store);
        const references = research.references?.references ?? [];
        const brand = research.brand?.inputs ?? [];
        const locale = ws.project.product?.locale ?? null;
        const staged = stageResearchOutputs(tx, store, {
          references,
          brand,
          currentMode: ws.mode,
          locale,
          minimum: ctx.research.minReferences,
          agent: agentDocuments(research),
        });
        const production = !canTransition(
          previous,
          { type: "reference-added" },
          { referenceComplete: true },
        ).ok;
        if (
          production &&
          staged.outputs.some((output) => output.written && GATED_OUTPUTS.includes(output.path))
        ) {
          return {
            kind: "skip",
            result: failure(
              ExitCode.Blocked,
              makeFinding(
                "TRANSITION_NOT_ALLOWED",
                "error",
                `Research outputs cannot be regenerated from phase "${previous.phase}": references.json or provenance.json would change and research is frozen once a direction is selected.`,
              ),
            ),
          };
        }
        const findings = staged.fallback ? [fallbackFinding(locale, input.path)] : [];
        const changed = staged.outputs.some((output) => output.written);
        const state = changed
          ? withArtifacts(recordCommand(previous, meta), staged.artifacts, RESEARCH_REASON)
          : previous;
        const data: ResearchRenderData = {
          mode: researchMode(references, ws.mode),
          locale: staged.locale,
          outputs: staged.outputs,
          counts: researchCounts(references, brand, ctx.research.minReferences),
          stateRevision: state.stateRevision,
        };
        const next = [`heron status ${input.path}`];
        return changed
          ? { kind: "commit", state, data, findings, next }
          : { kind: "skip", result: { ok: true, data, findings, next } };
      },
    );
  } catch (error) {
    const mapped = storeErrorResult<ResearchRenderData>(error);
    if (mapped === null) throw error;
    return mapped;
  }
}
