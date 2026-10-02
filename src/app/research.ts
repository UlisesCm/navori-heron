import { analysisInputKey } from "../agents/cache.ts";
import { PACK_LIMITS, referenceItems } from "../agents/context-pack.ts";
import type { ContextItem } from "../agents/ports.ts";
import { providerIdForRole, resolveAgentSettings } from "../agents/settings.ts";
import { AGENT_TASKS } from "../agents/tasks.ts";
import {
  AGENT_RUN_DOCUMENT,
  ExitCode,
  RESEARCH_ANALYSIS_DOCUMENT,
  RESEARCH_BRIEF_DOCUMENT,
  RESEARCH_FACETS,
  type AgentRun,
  type AgentRunRef,
  type AgentRunSummary,
  type AgentUsage,
  type BoundArtifact,
  type BrandInput,
  type BriefQuery,
  type Finding,
  type HeronMode,
  type ReferenceId,
  type RelativeArtifactPath,
  type ResearchAnalysis,
  type ResearchAnalyzeData,
  type ResearchBrief,
  type ResearchBriefData,
  type ResearchFacet,
  type ResearchReference,
  type ResearchRenderData,
  type Sha256Hex,
} from "../core/contracts/index.ts";
import { freshen, recordCommand, withArtifacts } from "../core/state/lifecycle.ts";
import { canTransition } from "../core/state/transitions.ts";
import {
  referenceDigest,
  referencesToAnalyze,
  validateAnalysisOutput,
  mergeAnalysis,
} from "../research/analysis.ts";
import {
  buildBrief,
  parseQueryFlag,
  queryId,
  validateBriefOutput,
  type QueryIssue,
} from "../research/brief.ts";
import { RESEARCH_FILES, runPath } from "../research/layout.ts";
import { byIdNumber, researchMode } from "../research/provenance.ts";
import {
  executeAgentStep,
  finalizeAgentRun,
  outputSchemaRef,
  type AgentStepResult,
} from "./agent-task.ts";
import type { AppContext } from "./context.ts";
import {
  agentDocuments,
  readResearch,
  researchCounts,
  stageResearchOutputs,
} from "./research-store.ts";
import { failure, makeFinding, storeErrorResult, type UseCaseResult } from "./result.ts";
import { loadWorkspace, type Workspace } from "./workspace.ts";
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

export type ResearchBriefInput = {
  path: string;
  queries: string[];
  resetQueries: boolean;
  force: boolean;
};
export type ResearchAnalyzeInput = { path: string; refs: string[]; force: boolean };

const FACET_LIST = RESEARCH_FACETS.join(", ");
const AGENT_REASON = "An upstream research artifact changed.";

const SUM_ZERO: AgentUsage = {
  inputTokens: 0,
  outputTokens: 0,
  cachedInputTokens: 0,
  costUsd: null,
  costIsEstimate: false,
};

/** Sum that keeps null only when no attempt reported the field. */
const addNullable = (a: number | null, b: number | null): number | null =>
  a === null && b === null ? null : (a ?? 0) + (b ?? 0);

function runSummary(run: AgentRun): AgentRunSummary {
  const usage = run.invocations.reduce<AgentUsage | null>(
    (sum, invocation) =>
      sum === null
        ? invocation.usage
        : {
            inputTokens: addNullable(sum.inputTokens, invocation.usage.inputTokens),
            outputTokens: addNullable(sum.outputTokens, invocation.usage.outputTokens),
            cachedInputTokens: addNullable(
              sum.cachedInputTokens,
              invocation.usage.cachedInputTokens,
            ),
            costUsd: addNullable(sum.costUsd, invocation.usage.costUsd),
            costIsEstimate: sum.costIsEstimate || invocation.usage.costIsEstimate,
          },
    null,
  );
  const first = run.invocations[0];
  return {
    runId: run.runId,
    task: run.task,
    provider: run.provider,
    role: run.role,
    attempts: run.invocations.length,
    durationMs: run.invocations.reduce((sum, invocation) => sum + invocation.durationMs, 0),
    model: first?.model.reported[0] ?? first?.model.requested ?? null,
    path: runPath(run.runId),
    reused: false,
    usage: usage ?? SUM_ZERO,
  };
}

/** DR39: nothing was sent, so attempts, duration and usage are zero; the model comes from the stored run when readable. */
function reusedSummary(ctx: AppContext, path: string, ref: AgentRunRef): AgentRunSummary {
  let stored: AgentRun | null = null;
  try {
    const loaded = loadWorkspace(ctx, path);
    stored = loaded.ok ? loaded.workspace.store.readDocument(ref.path, AGENT_RUN_DOCUMENT) : null;
  } catch {
    stored = null;
  }
  const first = stored?.invocations[0];
  return {
    runId: ref.runId,
    task: stored?.task ?? "research-brief",
    provider: ref.provider,
    role: stored?.role ?? "creator",
    attempts: 0,
    durationMs: 0,
    model: first?.model.reported[0] ?? first?.model.requested ?? null,
    path: ref.path,
    reused: true,
    usage: SUM_ZERO,
  };
}

function queryProblem(raw: string, issue: QueryIssue): Finding {
  const cut = raw.indexOf(":");
  const message =
    issue.code === "missing-facet"
      ? `Query "${raw}" names no research facet; use <facet>:<text> with one of: ${FACET_LIST}.`
      : issue.code === "unknown-facet"
        ? `Query "${raw}" uses an unknown facet "${raw.slice(0, cut).trim()}"; expected one of: ${FACET_LIST}.`
        : `Query "${raw}" has only generic terms; name what the interface does (for example screen-type:membership card).`;
  return makeFinding("RESEARCH_QUERY_INVALID", "error", message);
}

/** Research is open only while the `reference-added` row exists (before a direction is selected). */
function frozen(ws: Workspace): UseCaseResult<never> | null {
  if (canTransition(ws.state, { type: "reference-added" }, { referenceComplete: true }).ok) {
    return null;
  }
  return failure(
    ExitCode.Blocked,
    makeFinding(
      "TRANSITION_NOT_ALLOWED",
      "error",
      `Research is frozen from phase "${ws.state.phase}"; research brief and analyze run before a direction is selected.`,
    ),
  );
}

const textItem = (
  kind: ContextItem["kind"],
  id: string,
  trust: ContextItem["trust"],
  priority: number,
  content: string,
): ContextItem => ({ kind, id, trust, priority, content, findings: 0 });

function brandItems(inputs: readonly BrandInput[]): ContextItem[] {
  return inputs.map((input) =>
    textItem(
      "brand-input",
      input.id,
      "operator",
      1,
      [
        `kind: ${input.kind}`,
        `origin: ${input.origin}`,
        `value: ${input.value}`,
        ...(input.note === null ? [] : [`note: ${input.note}`]),
      ].join("\n"),
    ),
  );
}

const queryContent = (query: Pick<BriefQuery, "facet" | "query" | "job">): string =>
  `facet: ${query.facet}\nquery: ${query.query}\njob: ${query.job}`;

/** Bound `.heron` files that exist, as the run record's `inputs`. */
function boundInputs(ws: Workspace, paths: readonly RelativeArtifactPath[]): BoundArtifact[] {
  return paths.flatMap((path) => {
    const sha256 = ws.store.sha256(path);
    return sha256 === null ? [] : [{ path, sha256 }];
  });
}

const activeOf = (references: readonly ResearchReference[]): ResearchReference[] =>
  byIdNumber(references.filter((reference) => reference.removed === null));

/** Failure results of executeAgentStep keep their data null. */
const stepFailure = <T>(step: Extract<AgentStepResult<unknown>, { ok: false }>): UseCaseResult<T> =>
  step.result;

type Provided = { facet: ResearchFacet; text: string };

/**
 * parseQueryFlag each (RESEARCH_QUERY_INVALID, exit 2) -> loadWorkspace (R) -> research still open (else
 * TRANSITION_NOT_ALLOWED, exit 3) -> pack: provided queries (kept ones plus new), brand inputs and active references (none
 * at all: AGENT_CONTEXT_EMPTY, exit 2) -> executeAgentStep (cache, DR39) -> withWriteRun(R): brief.json, run record,
 * views, recordCommand + withArtifacts + freshen. A reused run sends and writes nothing.
 */
export async function runResearchBrief(
  ctx: AppContext,
  input: ResearchBriefInput,
): Promise<UseCaseResult<ResearchBriefData>> {
  const operator: Provided[] = [];
  for (const raw of input.queries) {
    const parsed = parseQueryFlag(raw);
    if ("code" in parsed) return failure(ExitCode.Usage, queryProblem(raw, parsed));
    operator.push(parsed);
  }
  try {
    const loaded = loadWorkspace(ctx, input.path);
    if (!loaded.ok) return loaded.result;
    const ws = loaded.workspace;
    const blocked = frozen(ws);
    if (blocked !== null) return blocked;
    const research = readResearch(ws.store);
    const references = activeOf(research.references?.references ?? []);
    const brand = research.brand?.inputs ?? [];

    const provided = new Map<string, BriefQuery | Provided>();
    if (!input.resetQueries) {
      for (const query of research.brief?.queries ?? []) {
        if (query.origin === "provided") provided.set(query.id, query);
      }
    }
    for (const query of operator) {
      const id = queryId(query.facet, query.text);
      if (!provided.has(id)) provided.set(id, query);
    }
    if (provided.size === 0 && brand.length === 0 && references.length === 0) {
      return failure(
        ExitCode.Usage,
        makeFinding(
          "AGENT_CONTEXT_EMPTY",
          "error",
          "Nothing to send to the agent: add a --query, a brand input (heron brand add) or a reference (heron references add).",
        ),
      );
    }
    const items: ContextItem[] = [
      textItem(
        "task-input",
        "task-input",
        "heron",
        0,
        `Research facets: ${FACET_LIST}\nValid reference ids: ${references.map((reference) => reference.id).join(", ") || "none"}`,
      ),
      ...[...provided.entries()].map(([id, query]) =>
        textItem(
          "operator-query",
          id,
          "operator",
          1,
          queryContent("text" in query ? { ...query, query: query.text, job: query.text } : query),
        ),
      ),
      ...brandItems(brand),
      ...references.flatMap((reference) => referenceItems(reference)),
    ];

    const runId = ctx.ids.runId(ctx.clock.now());
    const step = await executeAgentStep(
      ctx,
      {
        workspace: ws,
        spec: AGENT_TASKS["research-brief"],
        items,
        inputs: boundInputs(ws, [
          RESEARCH_FILES.references,
          RESEARCH_FILES.brand,
          RESEARCH_FILES.brief,
        ]),
        references: references.map((reference) => reference.id),
        validate: validateBriefOutput,
        command: "research brief",
        overBudgetRemedy:
          "Remove references (heron references remove) or raise agents.contextBudgetChars.",
        previous:
          research.brief === null
            ? null
            : { run: research.brief.run, documentPath: RESEARCH_FILES.brief },
        force: input.force,
      },
      runId,
    );
    if (!step.ok) return stepFailure(step);
    if (step.reused) {
      if (research.brief === null) throw new Error("a reused run implies a stored brief");
      return {
        ok: true,
        data: {
          brief: research.brief,
          run: reusedSummary(ctx, input.path, step.run),
          written: [],
          stateRevision: ws.state.stateRevision,
        },
        findings: step.findings,
        next: [`heron research analyze ${input.path}`],
      };
    }

    const scoped: AppContext = { ...ctx, ids: { runId: () => runId } };
    const result = await withWriteRun(
      scoped,
      ws.root,
      {
        path: input.path,
        command: "research brief",
        create: false,
        requireState: true,
        expectedRevision: ws.state.stateRevision,
      },
      ({ store, tx, previous, meta }): WriteBodyResult<ResearchBriefData> => {
        if (previous === null) throw new Error("withWriteRun requireState guarantees state.json");
        const snapshot = readResearch(store);
        const mode: HeronMode = researchMode(snapshot.references?.references ?? [], ws.mode);
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
        const brief: ResearchBrief = buildBrief({
          previous: snapshot.brief,
          operator,
          resetQueries: input.resetQueries,
          output: step.output,
          mode,
          briefedAt: meta.at,
          run: ref,
        });
        const briefSha = tx.putDocument(RESEARCH_FILES.brief, RESEARCH_BRIEF_DOCUMENT, brief);
        const run = finalizeAgentRun(
          draft,
          [{ path: RESEARCH_FILES.brief, sha256: briefSha }],
          [{ kind: "ResearchBrief", schemaVersion: RESEARCH_BRIEF_DOCUMENT.schemaVersion }],
        );
        tx.putDocument(ref.path, AGENT_RUN_DOCUMENT, run);
        const staged = stageResearchOutputs(tx, store, {
          references: snapshot.references?.references ?? [],
          brand: snapshot.brand?.inputs ?? [],
          currentMode: ws.mode,
          locale: ws.project.product?.locale ?? null,
          minimum: ctx.research.minReferences,
          agent: { ...agentDocuments(snapshot), brief },
        });
        const state = freshen(
          withArtifacts(
            recordCommand(previous, meta),
            [{ path: RESEARCH_FILES.brief, sha256: briefSha }, ...staged.artifacts],
            AGENT_REASON,
          ),
          [RESEARCH_FILES.brief],
        );
        return {
          kind: "commit",
          state,
          data: {
            brief,
            run: runSummary(run),
            written: [
              RESEARCH_FILES.brief,
              ref.path,
              ...staged.outputs.filter((output) => output.written).map((output) => output.path),
            ],
            stateRevision: state.stateRevision,
          },
          findings: step.findings,
          next: [`heron research analyze ${input.path}`],
        };
      },
    );
    return result;
  } catch (error) {
    const mapped = storeErrorResult<ResearchBriefData>(error);
    if (mapped === null) throw error;
    return mapped;
  }
}

/** Untrusted captured text of a reference, when the capture kept any (`research/sources/**`). */
function externalTextItem(ws: Workspace, reference: ResearchReference): ContextItem[] {
  const { capture } = reference;
  if (!("content" in capture)) return [];
  const bytes = ws.store.readBytes(capture.content.path);
  if (bytes === null) return [];
  return [textItem("external-text", reference.id, "untrusted", 3, new TextDecoder().decode(bytes))];
}

/** Freshness key of one reference for the configured provider (DR39); null when the provider cannot be resolved here
 * (executeAgentStep reports that failure when a step runs). */
function inputKeyFor(
  ctx: AppContext,
  ws: Workspace,
): ((reference: ResearchReference) => Sha256Hex) | null {
  const resolved = resolveAgentSettings(ws.project.agents);
  if (!resolved.ok) return null;
  const spec = AGENT_TASKS["research-analyze"];
  const providerId = providerIdForRole(resolved.settings, spec.role);
  const provider = ctx.agents.providers[providerId];
  if (provider === undefined) return null;
  const schema = outputSchemaRef(provider, spec);
  return (reference) =>
    analysisInputKey({
      referenceDigest: referenceDigest(reference),
      template: spec.template.ref,
      schema: { dialect: schema.dialect, sha256: schema.sha256 },
      provider: providerId,
      model: resolved.settings.models[providerId] ?? null,
    });
}

/** The run behind the latest write of analysis.json (entries of older runs stay in the document). */
function latestAnalysisRun(analysis: ResearchAnalysis | null): AgentRunRef | null {
  const runs = (analysis?.analyses ?? []).map((entry) => entry.run);
  return runs.toSorted((a, b) => (a.runId < b.runId ? 1 : a.runId > b.runId ? -1 : 0))[0] ?? null;
}

/**
 * loadWorkspace (R) -> research still open (exit 3) -> references to analyze (unknown id: REFERENCE_NOT_FOUND, exit 2; no
 * active reference: AGENT_CONTEXT_EMPTY, exit 2; stale = changed digest or input key; nothing stale and no --force: ok,
 * nothing sent or written; over PACK_LIMITS: the first 30, the rest reported as pending) -> executeAgentStep ->
 * withWriteRun(R): merged analysis.json, run record, views, recordCommand + withArtifacts + freshen.
 */
export async function runResearchAnalyze(
  ctx: AppContext,
  input: ResearchAnalyzeInput,
): Promise<UseCaseResult<ResearchAnalyzeData>> {
  try {
    const loaded = loadWorkspace(ctx, input.path);
    if (!loaded.ok) return loaded.result;
    const ws = loaded.workspace;
    const blocked = frozen(ws);
    if (blocked !== null) return blocked;
    const research = readResearch(ws.store);
    const all = research.references?.references ?? [];
    const active = activeOf(all);
    if (active.length === 0) {
      return failure(
        ExitCode.Usage,
        makeFinding("AGENT_CONTEXT_EMPTY", "error", "No active references to analyze."),
      );
    }
    const split = referencesToAnalyze(all, research.analysis, input.refs);
    if (split.unknown.length > 0) {
      return failure(
        ExitCode.Usage,
        makeFinding(
          "REFERENCE_NOT_FOUND",
          "error",
          `Reference ${split.unknown.join(", ")} not found or removed; active references: ${active.map((reference) => reference.id).join(", ")}.`,
        ),
      );
    }
    const keyOf = inputKeyFor(ctx, ws);
    const stored = new Map(
      (research.analysis?.analyses ?? []).map((entry) => [entry.reference, entry]),
    );
    const byId = new Map(active.map((reference) => [reference.id, reference]));
    const staleIds = new Set<string>(split.ids);
    for (const id of split.fresh) {
      const reference = byId.get(id);
      if (
        keyOf !== null &&
        reference !== undefined &&
        stored.get(id)?.inputKey !== keyOf(reference)
      ) {
        staleIds.add(id);
      }
    }
    const inOrder = (ids: ReadonlySet<string>): ReferenceId[] =>
      active.filter((reference) => ids.has(reference.id)).map((reference) => reference.id);
    const freshIds = inOrder(new Set(split.fresh.filter((id) => !staleIds.has(id))));
    const requested = new Set<string>([...staleIds, ...split.fresh]);
    const wanted = input.force ? inOrder(requested) : inOrder(staleIds);
    const nothingSent = (
      findings: Finding[],
      run: AgentRunSummary | null,
    ): UseCaseResult<ResearchAnalyzeData> => ({
      ok: true,
      data: {
        analyzed: [],
        fresh: inOrder(requested),
        pending: [],
        analysis: research.analysis,
        run,
        written: [],
        stateRevision: ws.state.stateRevision,
      },
      findings,
      next: [`heron status ${input.path}`],
    });
    if (wanted.length === 0) return nothingSent([], null);

    const targets = wanted.slice(0, PACK_LIMITS.maxReferences);
    const pending = wanted.slice(PACK_LIMITS.maxReferences);
    const targetReferences = targets.flatMap((id) => byId.get(id) ?? []);
    const brief = research.brief;
    const items: ContextItem[] = [
      textItem(
        "task-input",
        "task-input",
        "heron",
        0,
        `Valid reference ids: ${targets.join(", ")}\nResearch facets: ${FACET_LIST}`,
      ),
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
      ...targetReferences.flatMap((reference) => [
        ...referenceItems(reference),
        ...externalTextItem(ws, reference),
      ]),
    ];

    const runId = ctx.ids.runId(ctx.clock.now());
    const step = await executeAgentStep(
      ctx,
      {
        workspace: ws,
        spec: AGENT_TASKS["research-analyze"],
        items,
        inputs: boundInputs(ws, [
          RESEARCH_FILES.references,
          RESEARCH_FILES.brand,
          RESEARCH_FILES.brief,
          RESEARCH_FILES.analysis,
        ]),
        references: targets,
        validate: (output) =>
          validateAnalysisOutput(
            output,
            targets,
            (brief?.queries ?? []).map((query) => query.id),
          ),
        command: "research analyze",
        overBudgetRemedy: "Pass fewer references with --ref or raise agents.contextBudgetChars.",
        previous: (() => {
          const run = latestAnalysisRun(research.analysis);
          return run === null ? null : { run, documentPath: RESEARCH_FILES.analysis };
        })(),
        force: input.force,
      },
      runId,
    );
    if (!step.ok) return stepFailure(step);
    if (step.reused) {
      return nothingSent(step.findings, reusedSummary(ctx, input.path, step.run));
    }

    const scoped: AppContext = { ...ctx, ids: { runId: () => runId } };
    return await withWriteRun(
      scoped,
      ws.root,
      {
        path: input.path,
        command: "research analyze",
        create: false,
        requireState: true,
        expectedRevision: ws.state.stateRevision,
      },
      ({ store, tx, previous, meta }): WriteBodyResult<ResearchAnalyzeData> => {
        if (previous === null) throw new Error("withWriteRun requireState guarantees state.json");
        const snapshot = readResearch(store);
        const references = snapshot.references?.references ?? [];
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
        const inputKeys: Record<string, Sha256Hex> = {};
        for (const reference of references) {
          if (!targets.includes(reference.id)) continue;
          inputKeys[reference.id] = analysisInputKey({
            referenceDigest: referenceDigest(reference),
            template: first.template,
            schema: { dialect: draft.outputSchema.dialect, sha256: draft.outputSchema.sha256 },
            provider: draft.provider,
            model: first.model.requested,
          });
        }
        const analysis = mergeAnalysis(snapshot.analysis, step.output, {
          references,
          inputKeys,
          mode: researchMode(references, ws.mode),
          analyzedAt: meta.at,
          run: ref,
        });
        const analysisSha = tx.putDocument(
          RESEARCH_FILES.analysis,
          RESEARCH_ANALYSIS_DOCUMENT,
          analysis,
        );
        const run = finalizeAgentRun(
          draft,
          [{ path: RESEARCH_FILES.analysis, sha256: analysisSha }],
          [{ kind: "ResearchAnalysis", schemaVersion: RESEARCH_ANALYSIS_DOCUMENT.schemaVersion }],
        );
        tx.putDocument(ref.path, AGENT_RUN_DOCUMENT, run);
        const staged = stageResearchOutputs(tx, store, {
          references,
          brand: snapshot.brand?.inputs ?? [],
          currentMode: ws.mode,
          locale: ws.project.product?.locale ?? null,
          minimum: ctx.research.minReferences,
          agent: { ...agentDocuments(snapshot), analysis },
        });
        const state = freshen(
          withArtifacts(
            recordCommand(previous, meta),
            [{ path: RESEARCH_FILES.analysis, sha256: analysisSha }, ...staged.artifacts],
            AGENT_REASON,
          ),
          [RESEARCH_FILES.analysis],
        );
        return {
          kind: "commit",
          state,
          data: {
            analyzed: targets,
            fresh: freshIds,
            pending,
            analysis,
            run: runSummary(run),
            written: [
              RESEARCH_FILES.analysis,
              ref.path,
              ...staged.outputs.filter((output) => output.written).map((output) => output.path),
            ],
            stateRevision: state.stateRevision,
          },
          findings: step.findings,
          next: [`heron status ${input.path}`],
        };
      },
    );
  } catch (error) {
    const mapped = storeErrorResult<ResearchAnalyzeData>(error);
    if (mapped === null) throw error;
    return mapped;
  }
}
