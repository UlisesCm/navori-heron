import type {
  ContextSourceRecord,
  Extension,
  Finding,
  RelativeArtifactPath,
  SourceKind,
} from "../core/contracts/index.ts";
import { parseMarkdown, type MarkdownDoc } from "./markdown.ts";
import type { AdapterLoadResult, Candidate, ContextDraft, DetectRequest } from "./ports.ts";
import { decodeUtf8, probeFile } from "./probe.ts";
import { readSource, settleSource } from "./sources.ts";
import { ACTIVE_UX_READER } from "./ux-contract.ts";
import { uxCandidates } from "./ux-model.ts";

export type Extraction = { candidates: Candidate[]; findings: Finding[] };

/** Where an adapter keeps its UX files and what `detect` recorded about them. */
export type UxJsonSource = {
  path: RelativeArtifactPath;
  expectedStage: string | null;
  /** `report.uxJson.sha256`: bytes that differ at load time fail with INPUTS_CHANGED. */
  detectedSha256: string | null;
};

/** Accumulates the sources of one `load` in draft order (DR3); shared by the adapters that read files from
 * the repository. A source that cannot be read is reported and skipped, never thrown. */
export type DraftKit = {
  /** Settles `record` and merges the candidates and findings of its extraction (null: nothing extracted). */
  take(record: ContextSourceRecord, extracted: Extraction | null): void;
  /** Reads a Markdown source; when `enabled` is false a present file is recorded as `unused`. */
  markdown(
    path: RelativeArtifactPath,
    source: SourceKind,
    extract: (doc: MarkdownDoc) => Extraction,
    enabled?: boolean,
  ): void;
  /** Reads `ux.json` through the active UX reader; only `full` contributes (otherwise a present file is
   * `unused`). Returns the failure to propagate when the bytes changed since detection. */
  uxJson(source: UxJsonSource, full: boolean): Extract<AdapterLoadResult, { ok: false }> | null;
  findings: Finding[];
  /** Builds the draft; `parts` only for adapters that read `parts.json`. */
  finish(parts?: ContextDraft["parts"]): AdapterLoadResult;
};

export function createDraftKit(request: DetectRequest): DraftKit {
  const { fs, root, limits } = request;
  const sources: ContextSourceRecord[] = [];
  const candidates: Candidate[] = [];
  const findings: Finding[] = [];
  let uxExtensions: Extension[] = [];
  let uxReader: ContextDraft["uxReader"] = null;

  const take: DraftKit["take"] = (record, extracted) => {
    const settled = settleSource(record, extracted?.candidates.length ?? 0);
    sources.push(settled.record);
    if (extracted !== null) {
      candidates.push(...extracted.candidates);
      findings.push(...extracted.findings);
    }
    if (settled.finding !== null) findings.push(settled.finding);
  };

  const markdown: DraftKit["markdown"] = (path, source, extract, enabled = true) => {
    const { loaded, finding } = readSource(fs, root, path, source, limits);
    if (finding !== null) findings.push(finding);
    if (loaded.text === null) return take(loaded.record, null);
    if (!enabled) return take({ ...loaded.record, status: "unused" }, null);
    take(loaded.record, extract(parseMarkdown(loaded.text)));
  };

  const uxJson: DraftKit["uxJson"] = ({ path, expectedStage, detectedSha256 }, full) => {
    const probe = probeFile(fs, root, path, limits);
    if (probe.finding !== null) findings.push(probe.finding);
    if (full && probe.sha256 !== detectedSha256) {
      return {
        ok: false,
        code: "INPUTS_CHANGED",
        message: `${path} changed since it was detected; run the command again.`,
        findings: [],
      };
    }
    const record = (status: ContextSourceRecord["status"]): ContextSourceRecord => ({
      source: "ux.json",
      path,
      status,
    });
    if (probe.finding !== null) {
      take(record("unreadable"), null);
    } else if (probe.bytes === null) {
      take(record("absent"), null);
    } else if (!full) {
      take(record("unused"), null);
    } else {
      const read = ACTIVE_UX_READER.read(probe.bytes, { expectedStage });
      // the reader accepted these bytes, so they decode and parse to an object
      const raw: unknown = read.ok ? JSON.parse(decodeUtf8(probe.bytes) ?? "null") : null;
      if (!read.ok || typeof raw !== "object" || raw === null || Array.isArray(raw)) {
        findings.push({
          code: "UX_CONTRACT_INVALID",
          severity: "warning",
          message: `${path} does not satisfy the UX contract reader; it is ignored.`,
          paths: [path],
          issues: read.ok ? [] : read.issues,
        });
        take(record("unreadable"), null);
      } else {
        const mapped = uxCandidates(raw as Record<string, unknown>, read.contract, path);
        uxExtensions = mapped.extensions;
        uxReader = ACTIVE_UX_READER.id;
        take(record("read"), { candidates: mapped.candidates, findings: mapped.findings });
      }
    }
    return null;
  };

  return {
    take,
    markdown,
    uxJson,
    findings,
    finish: (parts) => ({
      ok: true,
      draft: {
        sources,
        candidates,
        uxReader,
        uxExtensions,
        findings,
        ...(parts === undefined ? {} : { parts }),
      },
    }),
  };
}
