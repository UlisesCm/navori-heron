import {
  canonicalJson,
  ExitCode,
  PENPOT_SYNC_STATE_DOCUMENT,
  RESEARCH_REFERENCES_DOCUMENT,
  VISUAL_DIRECTIONS_DOCUMENT,
  type Finding,
  type PenpotSyncData,
} from "../core/contracts/index.ts";
import { freshen, recordCommand, withArtifacts } from "../core/state/lifecycle.ts";
import { activeReferences } from "../penpot/compiler/ids.ts";
import { buildProposalPage } from "../penpot/compiler/proposal-page.ts";
import { buildReferencesPage } from "../penpot/compiler/references-page.ts";
import { resolvePenpotCopy } from "../penpot/compiler/copy.ts";
import { planReviewSync, reviewRecord } from "../penpot/compiler/plan.ts";
import { renderScript, reviewScriptData } from "../penpot/compiler/script.ts";
import { penpotTemplate } from "../penpot/compiler/templates.ts";
import type { ReviewPage } from "../penpot/compiler/nodes.ts";
import type { PenpotFailure, PenpotSession } from "../penpot/ports.ts";
import type { AppContext } from "./context.ts";
import {
  readPenpotLink,
  resolvePenpotKey,
  resolvePenpotUrl,
  penpotRedactor,
} from "./penpot-config.ts";
import { penpotFailureResult, withPenpotSession } from "./penpot-session.ts";
import { desiredReviewPages, penpotFileMismatch, penpotVersionFindings } from "./penpot.ts";
import { failure, makeFinding, storeErrorResult, type UseCaseResult } from "./result.ts";
import { loadWorkspace, type Workspace } from "./workspace.ts";
import { withWriteRun } from "./write-run.ts";

export type PenpotSyncInput = {
  path: string;
  proposals: boolean;
  references: boolean;
  dryRun: boolean;
};
const RECORD_FILE = "penpot/review-sync.json";
function sourceFailure(message: string): UseCaseResult<never> {
  return failure(ExitCode.Blocked, makeFinding("PENPOT_SOURCE_UNAVAILABLE", "error", message));
}
function syncPages(
  ws: Workspace,
  input: PenpotSyncInput,
): { ok: true; pages: ReviewPage[] } | { ok: false; result: UseCaseResult<never> } {
  const context = {
    mode: ws.mode,
    copy: resolvePenpotCopy(ws.project.product?.locale ?? null),
    template: penpotTemplate("review-page", 3),
  };
  const pages: ReviewPage[] = [];
  if (input.proposals) {
    const directions = ws.store.readDocument(
      "research/visual-directions.json",
      VISUAL_DIRECTIONS_DOCUMENT,
    );
    if (directions === null)
      return {
        ok: false,
        result: sourceFailure(
          `No visual directions to write. Run: heron direction propose ${input.path}`,
        ),
      };
    if (ws.state.stale.some((entry) => entry.path === "research/visual-directions.json"))
      return {
        ok: false,
        result: sourceFailure(
          `The visual directions are stale because the research changed. Run: heron direction propose ${input.path}`,
        ),
      };
    pages.push(...directions.directions.map((direction) => buildProposalPage(direction, context)));
  }
  if (input.references) {
    const document = ws.store.readDocument(
      "research/references.json",
      RESEARCH_REFERENCES_DOCUMENT,
    );
    const references = activeReferences(document?.references ?? []);
    if (references.length === 0)
      return {
        ok: false,
        result: sourceFailure(
          `No active references to write. Run: heron references add ${input.path} …`,
        ),
      };
    pages.push(buildReferencesPage(references, context));
  }
  for (const page of pages) {
    // UUID target reservation matches the compiler's byte budget (DR11/DR30).
    const rendered = renderScript(
      penpotTemplate("review-page", 3),
      reviewScriptData(page, "x".repeat(36)),
    );
    if (!rendered.ok)
      return {
        ok: false,
        result: failure(
          ExitCode.ValidationFailed,
          makeFinding(
            "PENPOT_SCRIPT_TOO_LARGE",
            "error",
            `${page.heronId} exceeds the 32768-byte Penpot script budget (${rendered.bytes} bytes).`,
          ),
        ),
      };
  }
  return { ok: true, pages };
}

/** Plan and execute outside the lock, then persist only pages confirmed by a fresh read. */
export async function runPenpotSync(
  ctx: AppContext,
  input: PenpotSyncInput,
): Promise<UseCaseResult<PenpotSyncData>> {
  if (!input.proposals && !input.references)
    return failure(
      ExitCode.Usage,
      makeFinding(
        "PENPOT_CONFIG_INVALID",
        "error",
        "Select at least one of --proposals or --references.",
      ),
    );
  try {
    const loaded = loadWorkspace(ctx, input.path);
    if (!loaded.ok) return loaded.result;
    const ws = loaded.workspace;
    const link = readPenpotLink(ws.project, input.path);
    if (!link.ok) return link.result;
    const url = resolvePenpotUrl(ctx);
    if (!url.ok) return url.result;
    const key = resolvePenpotKey(ctx);
    if (!key.ok) return key.result;
    const desired = syncPages(ws, input);
    if (!desired.ok) return desired.result;
    // Flags select writes, not which confirmed pages remain tracked (R15).
    const recordPages = desiredReviewPages(ws).filter(
      (page) =>
        page.kind !== "proposal-page" ||
        !ws.state.stale.some((entry) => entry.path === "research/visual-directions.json"),
    );
    return await withPenpotSession(
      ctx,
      {
        baseUrl: url.baseUrl,
        key: key.key,
        command: "penpot sync",
        runId: ctx.ids.runId(ctx.clock.now()),
        log: !input.dryRun,
        heronDir: ws.store.heronDir,
      },
      async (session) =>
        syncSession(
          ctx,
          ws,
          input,
          desired.pages,
          recordPages,
          link.link.fileId,
          key.key,
          key.warnings,
          session,
        ),
    );
  } catch (error) {
    const mapped = storeErrorResult<PenpotSyncData>(error);
    if (mapped === null) throw error;
    return mapped;
  }
}

async function syncSession(
  ctx: AppContext,
  ws: Workspace,
  input: PenpotSyncInput,
  desired: ReviewPage[],
  recordPages: ReviewPage[],
  fileId: string,
  key: string,
  warnings: Finding[],
  session: PenpotSession,
): Promise<UseCaseResult<PenpotSyncData>> {
  const redact = penpotRedactor(ctx, key);
  const initial = await session.inspect(ctx.penpot.readTimeoutMs);
  if (!initial.ok)
    return penpotFailureResult(initial.failure, {
      template: "inspect@v1",
      timeoutMs: ctx.penpot.readTimeoutMs,
    });
  if (initial.value.file === null)
    return penpotFailureResult(
      { kind: "plugin-not-connected", detail: "No connected file" },
      { template: "inspect@v1", timeoutMs: ctx.penpot.readTimeoutMs },
    );
  if (initial.value.file.id !== fileId) {
    const finding = penpotFileMismatch(initial.value.file, fileId, "error");
    return failure(ExitCode.Blocked, { ...finding, message: redact(finding.message) });
  }
  const plan = planReviewSync(desired, initial.value);
  const findings = [
    ...warnings,
    ...penpotVersionFindings(redact(initial.value.penpotVersion)),
    ...desired.flatMap((page) =>
      page.issues.map((issue) => makeFinding(issue.code, "warning", redact(issue.message))),
    ),
  ];
  for (const duplicate of plan.duplicates)
    findings.push(
      makeFinding(
        "PENPOT_DUPLICATE_PAGE",
        "warning",
        `${duplicate.pageIds.length + 1} pages carry the mark ${duplicate.heronId}; Heron updates the first (${initial.value.pages.find((page) => page.marks.id === duplicate.heronId)?.pageId}) and leaves the others.`,
      ),
    );
  const data: PenpotSyncData = {
    dryRun: input.dryRun,
    mode: ws.mode,
    file: { ...initial.value.file, name: redact(initial.value.file.name) },
    pages: plan.unchanged.map((heronId) => ({
      heronId,
      action: "unchanged",
      pageId: initial.value.pages.find((page) => page.marks.id === heronId)?.pageId ?? null,
    })),
    writes: 0,
    written: [],
    stateRevision: null,
  };
  if (input.dryRun) {
    data.pages.push(
      ...plan.writes.map((write) => ({
        heronId: write.page.heronId,
        action: write.reason === "missing" ? ("would-create" as const) : ("would-update" as const),
        pageId: write.targetPageId,
      })),
    );
    data.pages.sort((a, b) => (a.heronId < b.heronId ? -1 : a.heronId > b.heronId ? 1 : 0));
    return { ok: true, data, findings, next: [] };
  }
  let failed: { heronId: string; failure: PenpotFailure } | null = null;
  let human: Finding | null = null;
  let attempted = false;
  for (const write of plan.writes) {
    attempted = true;
    const result = await session.apply(write.page, write.targetPageId, ctx.penpot.writeTimeoutMs);
    if (!result.ok) {
      failed = { heronId: write.page.heronId, failure: result.failure };
      break;
    }
    if (result.value.outcome === "human-shapes") {
      human = makeFinding(
        "PENPOT_HUMAN_SHAPES_INSIDE",
        "error",
        `${write.page.heronId}: ${result.value.humanShapes.length} shape(s) not made by Heron sit inside Heron boards (${result.value.humanShapes.map(redact).join(", ")}); move them out of those boards and run heron penpot sync again.`,
      );
      break;
    }
    data.writes += 1;
    data.pages.push({
      heronId: write.page.heronId,
      action: result.value.created ? "created" : "updated",
      pageId: result.value.pageId,
    });
    for (const family of result.value.fontFallbacks)
      findings.push(
        makeFinding(
          "PENPOT_FONT_FALLBACK",
          "warning",
          `Font "${redact(family)}" is not available in Penpot; ${write.page.heronId} uses the default font.`,
        ),
      );
  }
  const last = attempted ? await session.inspect(ctx.penpot.readTimeoutMs) : initial;
  if (!last.ok)
    return penpotFailureResult(last.failure, {
      template: "inspect@v1",
      timeoutMs: ctx.penpot.readTimeoutMs,
    });
  if (last.value.file?.id !== fileId)
    return failure(
      ExitCode.Blocked,
      makeFinding(
        "PENPOT_FILE_MISMATCH",
        "error",
        "The connected Penpot file changed during synchronization; no local record was written.",
      ),
    );
  const record = reviewRecord(recordPages, last.value);
  if (record === null) throw new Error("the bound file implies a review record");
  record.file.name = redact(record.file.name);
  record.penpotVersion = redact(record.penpotVersion);
  record.entries = record.entries.map((entry) => ({ ...entry, pageName: redact(entry.pageName) }));
  data.pages.sort((a, b) => (a.heronId < b.heronId ? -1 : a.heronId > b.heronId ? 1 : 0));
  const partial =
    failed === null
      ? null
      : makeFinding(
          "PENPOT_SYNC_PARTIAL",
          "error",
          `${data.writes} of ${plan.writes.length} page(s) were written before ${failed.heronId} failed; run heron penpot sync again to finish (pages already up to date are not rewritten).`,
        );
  if (failed !== null)
    findings.push(
      ...penpotFailureResult<never>(failed.failure, {
        template: "review-page@v1",
        timeoutMs: ctx.penpot.writeTimeoutMs,
      }).findings,
    );
  if (partial !== null) findings.push(partial);
  if (human !== null) findings.push(human);
  const finish = (finalData: PenpotSyncData): UseCaseResult<PenpotSyncData> =>
    human !== null || partial !== null
      ? {
          ok: false,
          code: human !== null ? ExitCode.Blocked : ExitCode.DependencyUnavailable,
          message: (human ?? partial)?.message ?? "Penpot synchronization failed.",
          findings,
          data: finalData,
        }
      : { ok: true, data: finalData, findings, next: [] };
  const stored = ws.store.readDocument(RECORD_FILE, PENPOT_SYNC_STATE_DOCUMENT);
  if (data.writes === 0 && canonicalJson(stored) === canonicalJson(record)) return finish(data);
  const committed = await withWriteRun(
    ctx,
    ws.root,
    {
      path: input.path,
      command: "penpot sync",
      create: false,
      requireState: true,
      expectedRevision: ws.state.stateRevision,
    },
    ({ tx, previous, meta }) => {
      if (previous === null) throw new Error("initialized workspace lost its state");
      const sha256 = tx.putDocument(RECORD_FILE, PENPOT_SYNC_STATE_DOCUMENT, record);
      const state = freshen(
        withArtifacts(
          recordCommand(previous, meta),
          [{ path: RECORD_FILE, sha256 }],
          "Penpot review pages changed.",
        ),
        [RECORD_FILE],
      );
      return {
        kind: "commit",
        state,
        data: { ...data, written: [RECORD_FILE], stateRevision: state.stateRevision },
        findings: [],
        next: [],
      };
    },
  );
  return committed.ok
    ? { ...finish(committed.data), findings: [...findings, ...committed.findings] }
    : committed;
}
