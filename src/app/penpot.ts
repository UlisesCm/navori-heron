import {
  canonicalJson,
  ExitCode,
  HERON_PROJECT_DOCUMENT,
  type Finding,
  type PenpotFileRef,
  type PenpotInspectData,
  type PenpotLinkData,
} from "../core/contracts/index.ts";
import { recordCommand, withArtifacts } from "../core/state/lifecycle.ts";
import { PROJECT_FILE } from "../core/store/file-store.ts";
import { isTestedVersion, PENPOT_TESTED_VERSIONS } from "../penpot/compatibility.ts";
import { buildProposalPage } from "../penpot/compiler/proposal-page.ts";
import { buildReferencesPage } from "../penpot/compiler/references-page.ts";
import { activeReferences } from "../penpot/compiler/ids.ts";
import { resolvePenpotCopy } from "../penpot/compiler/copy.ts";
import { pageStatuses } from "../penpot/compiler/plan.ts";
import { penpotTemplate } from "../penpot/compiler/templates.ts";
import type { ReviewPage } from "../penpot/compiler/nodes.ts";
import type { AppContext } from "./context.ts";
import {
  readPenpotLink,
  resolvePenpotConnection,
  resolvePenpotKey,
  resolvePenpotUrl,
  penpotRedactor,
} from "./penpot-config.ts";
import { penpotFailureResult, withPenpotSession } from "./penpot-session.ts";
import { readResearch } from "./research-store.ts";
import { failure, makeFinding, storeErrorResult, type UseCaseResult } from "./result.ts";
import { loadWorkspace, type Workspace } from "./workspace.ts";
import { withWriteRun } from "./write-run.ts";

export type PenpotLinkInput = { path: string; fileId: string | null };
export type PenpotInspectInput = { path: string };

/** Inspect can report available sources even before any direction was proposed. */
export function desiredReviewPages(workspace: Workspace): ReviewPage[] {
  const sources = readResearch(workspace.store);
  const context = {
    mode: workspace.mode,
    copy: resolvePenpotCopy(workspace.project.product?.locale ?? null),
    template: penpotTemplate("review-page", 4),
    // Read-only sizing without a link must never become an execution binding.
    expectedFileId: workspace.project.penpot.fileId ?? "UNBOUND_READ_ONLY_SIZING",
  };
  const pages =
    sources.directions?.directions.map((direction) => buildProposalPage(direction, context)) ?? [];
  const references = activeReferences(sources.references?.references ?? []);
  if (references.length > 0) pages.push(buildReferencesPage(references, context));
  return pages;
}

export function penpotVersionFindings(version: string): Finding[] {
  return isTestedVersion(version)
    ? []
    : [
        makeFinding(
          "PENPOT_VERSION_UNTESTED",
          "warning",
          `Penpot ${version} is not a tested version (tested: ${PENPOT_TESTED_VERSIONS.join(", ")}); see docs/penpot.md.`,
        ),
      ];
}
export function penpotFileMismatch(
  file: PenpotFileRef,
  fileId: string,
  severity: "warning" | "error",
): Finding {
  return makeFinding(
    "PENPOT_FILE_MISMATCH",
    severity,
    `The connected Penpot file is "${file.name}" (${file.id}), not the bound file ${fileId}. Open the bound file or run heron penpot link again.`,
  );
}

/** Verify the live file outside the lock; persist only its identity, never the credential destination. */
export async function runPenpotLink(
  ctx: AppContext,
  input: PenpotLinkInput,
): Promise<UseCaseResult<PenpotLinkData>> {
  try {
    const url = resolvePenpotUrl(ctx);
    if (!url.ok) return url.result;
    const key = resolvePenpotKey(ctx);
    if (!key.ok) return key.result;
    const loaded = loadWorkspace(ctx, input.path);
    if (!loaded.ok) return loaded.result;
    const ws = loaded.workspace;
    return await withPenpotSession(
      ctx,
      {
        baseUrl: url.baseUrl,
        key: key.key,
        command: "penpot link",
        runId: ctx.ids.runId(ctx.clock.now()),
        log: true,
        heronDir: ws.store.heronDir,
      },
      async (session) => {
        const result = await session.inspect(ctx.penpot.readTimeoutMs);
        if (!result.ok)
          return penpotFailureResult(result.failure, {
            template: "inspect@v1",
            timeoutMs: ctx.penpot.readTimeoutMs,
          });
        if (result.value.file === null)
          return penpotFailureResult(
            { kind: "plugin-not-connected", detail: "No file connected" },
            { template: "inspect@v1", timeoutMs: ctx.penpot.readTimeoutMs },
          );
        const redact = penpotRedactor(ctx, key.key);
        const file = { ...result.value.file, name: redact(result.value.file.name) };
        const penpotVersion = redact(result.value.penpotVersion);
        if (input.fileId !== null && input.fileId !== file.id) {
          const finding = penpotFileMismatch(file, input.fileId, "error");
          return failure(ExitCode.Blocked, { ...finding, message: redact(finding.message) });
        }
        const previousFileId = ws.project.penpot.fileId;
        const project = {
          ...ws.project,
          penpot: { enabled: true, url: null, fileId: file.id, version: null },
        };
        const findings = [...key.warnings, ...penpotVersionFindings(penpotVersion)];
        if (previousFileId !== null && previousFileId !== file.id)
          findings.push(
            makeFinding(
              "PENPOT_FILE_REBOUND",
              "warning",
              `The workspace was linked to file ${previousFileId}; it now points to ${file.id}. Pages written to ${previousFileId} are no longer tracked.`,
            ),
          );
        const data: PenpotLinkData = {
          file,
          penpotVersion,
          previousFileId,
          written: [],
          stateRevision: null,
        };
        return withWriteRun(
          ctx,
          ws.root,
          {
            path: input.path,
            command: "penpot link",
            create: false,
            requireState: true,
            expectedRevision: ws.state.stateRevision,
          },
          ({ tx, previous, meta }) => {
            if (canonicalJson(project) === canonicalJson(ws.project))
              return { kind: "skip", result: { ok: true, data, findings, next: [] } };
            if (previous === null) throw new Error("initialized workspace lost its state");
            const sha256 = tx.putDocument(PROJECT_FILE, HERON_PROJECT_DOCUMENT, project);
            const state = withArtifacts(
              recordCommand(previous, meta),
              [{ path: PROJECT_FILE, sha256 }],
              "Penpot file binding changed.",
            );
            return {
              kind: "commit",
              state,
              data: { ...data, written: [PROJECT_FILE], stateRevision: state.stateRevision },
              findings,
              next: [`heron penpot inspect ${input.path}`],
            };
          },
        );
      },
    );
  } catch (error) {
    const mapped = storeErrorResult<PenpotLinkData>(error);
    if (mapped === null) throw error;
    return mapped;
  }
}

/** Read page statuses without logs, local transactions or Penpot mutations. */
export async function runPenpotInspect(
  ctx: AppContext,
  input: PenpotInspectInput,
): Promise<UseCaseResult<PenpotInspectData>> {
  try {
    const loaded = loadWorkspace(ctx, input.path);
    if (!loaded.ok) return loaded.result;
    const ws = loaded.workspace;
    const link = readPenpotLink(ws.project, input.path);
    if (!link.ok) return link.result;
    const connection = resolvePenpotConnection(ctx);
    if (!connection.ok) return connection.result;
    const desired = desiredReviewPages(ws);
    return await withPenpotSession(
      ctx,
      {
        baseUrl: connection.baseUrl,
        key: connection.key,
        command: "penpot inspect",
        runId: ctx.ids.runId(ctx.clock.now()),
        log: false,
      },
      async (session) => {
        const result = await session.inspect(ctx.penpot.readTimeoutMs);
        if (!result.ok)
          return penpotFailureResult(result.failure, {
            template: "inspect@v1",
            timeoutMs: ctx.penpot.readTimeoutMs,
          });
        const redact = penpotRedactor(ctx, connection.key);
        const inspected = {
          ...result.value,
          penpotVersion: redact(result.value.penpotVersion),
          file:
            result.value.file === null
              ? null
              : { ...result.value.file, name: redact(result.value.file.name) },
          pages: result.value.pages.map((page) => ({ ...page, name: redact(page.name) })),
        };
        const findings = [
          ...connection.warnings,
          ...penpotVersionFindings(inspected.penpotVersion),
        ];
        const matches = inspected.file?.id === link.link.fileId;
        if (inspected.file !== null && !matches)
          findings.push(penpotFileMismatch(inspected.file, link.link.fileId, "warning"));
        return {
          ok: true,
          data: {
            penpotVersion: inspected.penpotVersion,
            file: inspected.file,
            bound: { fileId: link.link.fileId, matches },
            pages: pageStatuses(desired, inspected),
            unmanagedPages: inspected.unmanagedPages,
          },
          findings,
          next: [],
        };
      },
    );
  } catch (error) {
    const mapped = storeErrorResult<PenpotInspectData>(error);
    if (mapped === null) throw error;
    return mapped;
  }
}
