import type {
  ContextSourceRecord,
  DetectedArtifact,
  DetectionReport,
  Extension,
  Finding,
  HarnessArtifactName,
  HarnessDeclaration,
  RelativeArtifactPath,
  SourceKind,
} from "../../../core/contracts/index.ts";
import { candidateSink } from "../../candidates.ts";
import { extractRoleSections, parseMarkdown, type MarkdownDoc } from "../../markdown.ts";
import {
  type AdapterDetection,
  type AdapterLoadResult,
  type Candidate,
  type ContextDraft,
  type DetectRequest,
  type LoadRequest,
  type ProductContextAdapter,
} from "../../ports.ts";
import { decodeUtf8, probeFile } from "../../probe.ts";
import { listContextMarkdown, readSource, settleSource } from "../../sources.ts";
import { ACTIVE_UX_READER, checkUxFiles } from "../../ux-contract.ts";
import { extractUxMarkdown } from "../../ux-markdown.ts";
import { uxCandidates } from "../../ux-model.ts";
import { parseDecisions } from "./decisions.ts";
import {
  CONFIG_PATH,
  HARNESS_UX_DECLARATIONS,
  readMasterIndex,
  readNavoriConfig,
  readParts,
  readStageState,
  type HarnessReadResult,
} from "./harness.ts";
import { selectStage } from "./stage.ts";

const ARTIFACT_FILES: readonly [HarnessArtifactName, string][] = [
  ["MASTER.md", "MASTER.md"],
  ["DECISIONS.md", "DECISIONS.md"],
  ["parts.json", "parts.json"],
  ["UX.md", "UX.md"],
  ["ux.json", "ux.json"],
  ["DIGEST.md", "context/DIGEST.md"],
  ["CODEBASE.md", "context/CODEBASE.md"],
];

function info(code: Finding["code"], path: string, message: string): Finding {
  return { code, severity: "info", message, paths: [path], issues: [] };
}

function detectNavoriMaster(request: DetectRequest): AdapterDetection {
  const { fs, root, limits } = request;
  const findings: Finding[] = [];
  const config = readNavoriConfig(fs, root, limits);
  if (config.status === "absent") return { kind: "not-detected" };
  if (config.status !== "ok") findings.push(config.finding);
  const specsDir = config.status === "ok" ? config.value.specsDir : "specs";
  const indexPath = `${specsDir}/_master/index.json`;
  const index = readMasterIndex(fs, root, specsDir, limits);
  if (index.status === "absent") return { kind: "not-detected" };

  const base = {
    adapter: "navori-master" as const,
    navoriMaster: true,
    specsDir,
    stage: null,
    artifacts: [],
    uxMarkdown: {
      path: `${specsDir}/_master/UX.md`,
      present: false,
      valid: null,
      sha256: null,
      issues: [],
    },
    uxJson: {
      path: `${specsDir}/_master/ux.json`,
      present: false,
      valid: null,
      sha256: null,
      issues: [],
      reader: "provisional-1" as const,
      summary: null,
    },
    findings,
  };
  const noStage = (status: DetectionReport["stageStatus"]): AdapterDetection => ({
    kind: "detected",
    report: { ...base, stageStatus: status, stageNotice: null, harness: null },
  });

  if (index.status === "unreadable" || index.status === "unsupported-version") {
    findings.push(index.finding);
    return noStage("unknown");
  }
  findings.push(...index.value.skipped);
  const selected = selectStage(index.value, request.stage, indexPath);
  if (!selected.ok) return selected.error;
  if (selected.stage === null) {
    findings.push({
      code: "NO_STAGE",
      severity: "warning",
      message: `${indexPath} has no stages.`,
      paths: [indexPath],
      issues: [],
    });
    return noStage("none");
  }

  const { stage } = selected;
  const dir = `${specsDir}/_master/${stage.dir}`;
  const artifacts: DetectedArtifact[] = ARTIFACT_FILES.map(([name, file]) => {
    const probe = probeFile(fs, root, `${dir}/${file}`, limits);
    if (probe.finding !== null && name !== "UX.md" && name !== "ux.json")
      findings.push(probe.finding);
    return { name, path: probe.path, present: probe.present, sha256: probe.sha256 };
  });
  const ux = checkUxFiles(
    fs,
    root,
    { markdown: `${dir}/UX.md`, json: `${dir}/ux.json` },
    stage.dir,
    limits,
  );
  findings.push(...ux.findings);

  const statePath = `${dir}/state.json`;
  const state = readStageState(fs, root, dir, limits);
  let harness: HarnessDeclaration | null = null;
  if (state.status === "ok") {
    const { phase, mode, ux: declared } = state.value;
    harness = { phase, mode, ux: declared };
    if (declared !== null && !(HARNESS_UX_DECLARATIONS as readonly string[]).includes(declared)) {
      findings.push(
        info(
          "HARNESS_UNKNOWN_VALUE",
          statePath,
          `${statePath} declares ux = "${declared}", which Heron does not recognize; the declaration is ignored.`,
        ),
      );
    }
  } else if (state.status !== "absent") {
    findings.push(state.finding);
  }

  return {
    kind: "detected",
    report: {
      ...base,
      stage: {
        number: stage.number,
        slug: stage.slug,
        dir: stage.dir,
        state: stage.state,
        selection: selected.selection,
      },
      stageStatus: "selected",
      stageNotice: selected.notice,
      harness,
      artifacts,
      uxMarkdown: ux.uxMarkdown,
      uxJson: ux.uxJson,
    },
  };
}

const role = (path: RelativeArtifactPath, source: SourceKind) => (doc: MarkdownDoc) =>
  extractRoleSections(doc, { source, path });

type Extraction = { candidates: Candidate[]; findings: Finding[] };

/** Reads the sources of the selected stage in draft order (DR3, § Contracts 7) and turns them into
 * candidates; merging, precedence and conflicts belong to `buildProductContext`. A source that cannot be
 * read is reported and skipped, never thrown. `ux.json` and `UX.md` contribute only in `full`
 * (otherwise a present file is `unused`); `ux.json` bytes that differ from `report.uxJson.sha256` fail
 * with INPUTS_CHANGED. */
export function loadNavoriMaster(request: LoadRequest): AdapterLoadResult {
  const { fs, root, limits, report, mode } = request;
  const { stage, specsDir } = report;
  if (!report.navoriMaster || stage === null || specsDir === null) {
    return {
      ok: false,
      code: "LOAD_NOT_AVAILABLE",
      message: "navori-master cannot load without a selected stage.",
      findings: [],
    };
  }
  const dir = `${specsDir}/_master/${stage.dir}`;
  const sources: ContextSourceRecord[] = [];
  const candidates: Candidate[] = [];
  const findings: Finding[] = [];
  let uxExtensions: Extension[] = [];
  let uxReader: ContextDraft["uxReader"] = null;
  let parts: ContextDraft["parts"];

  const take = (record: ContextSourceRecord, extracted: Extraction | null): void => {
    const settled = settleSource(record, extracted?.candidates.length ?? 0);
    sources.push(settled.record);
    if (extracted !== null) {
      candidates.push(...extracted.candidates);
      findings.push(...extracted.findings);
    }
    if (settled.finding !== null) findings.push(settled.finding);
  };
  const markdown = (
    path: RelativeArtifactPath,
    source: SourceKind,
    extract: (doc: MarkdownDoc) => Extraction,
    enabled = true,
  ): void => {
    const { loaded, finding } = readSource(fs, root, path, source, limits);
    if (finding !== null) findings.push(finding);
    if (loaded.text === null) return take(loaded.record, null);
    if (!enabled) return take({ ...loaded.record, status: "unused" }, null);
    take(loaded.record, extract(parseMarkdown(loaded.text)));
  };
  const full = mode === "full";

  const decisionsPath = `${dir}/DECISIONS.md`;
  markdown(decisionsPath, "DECISIONS.md", (doc) => parseDecisions(doc, decisionsPath));
  const masterPath = `${dir}/MASTER.md`;
  markdown(masterPath, "MASTER.md", role(masterPath, "MASTER.md"));

  const partsPath = `${dir}/parts.json`;
  const partsRead = readParts(fs, root, dir, limits);
  if (partsRead.status === "ok") {
    parts = partsRead.value.parts.map((part) => ({
      id: part.id,
      criteria: part.acceptance,
    }));
    take(
      { source: "parts.json", path: partsPath, status: "read" },
      partsCandidates(partsRead.value.parts, partsPath, partsRead.value.skipped),
    );
  } else {
    take(...unsettled("parts.json", partsPath, partsRead, findings));
  }

  const uxJsonPath = `${dir}/ux.json`;
  const uxProbe = probeFile(fs, root, uxJsonPath, limits);
  if (uxProbe.finding !== null) findings.push(uxProbe.finding);
  if (full && uxProbe.sha256 !== report.uxJson.sha256) {
    return {
      ok: false,
      code: "INPUTS_CHANGED",
      message: `${uxJsonPath} changed since it was detected; run the command again.`,
      findings: [],
    };
  }
  const uxRecord = (status: ContextSourceRecord["status"]): ContextSourceRecord => ({
    source: "ux.json",
    path: uxJsonPath,
    status,
  });
  if (uxProbe.finding !== null) {
    take(uxRecord("unreadable"), null);
  } else if (uxProbe.bytes === null) {
    take(uxRecord("absent"), null);
  } else if (!full) {
    take(uxRecord("unused"), null);
  } else {
    const read = ACTIVE_UX_READER.read(uxProbe.bytes, {
      expectedStage: stage.dir,
    });
    // the reader accepted these bytes, so they decode and parse to an object
    const raw: unknown = read.ok ? JSON.parse(decodeUtf8(uxProbe.bytes) ?? "null") : null;
    if (!read.ok || typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      findings.push({
        code: "UX_CONTRACT_INVALID",
        severity: "warning",
        message: `${uxJsonPath} does not satisfy the UX contract reader; it is ignored.`,
        paths: [uxJsonPath],
        issues: read.ok ? [] : read.issues,
      });
      take(uxRecord("unreadable"), null);
    } else {
      const mapped = uxCandidates(raw as Record<string, unknown>, read.contract, uxJsonPath);
      uxExtensions = mapped.extensions;
      uxReader = ACTIVE_UX_READER.id;
      take(uxRecord("read"), {
        candidates: mapped.candidates,
        findings: mapped.findings,
      });
    }
  }

  const uxMarkdownPath = `${dir}/UX.md`;
  markdown(uxMarkdownPath, "UX.md", (doc) => extractUxMarkdown(doc, uxMarkdownPath), full);

  for (const [name, source] of [
    ["DIGEST.md", "DIGEST.md"],
    ["CODEBASE.md", "CODEBASE.md"],
  ] as const) {
    const path = `${dir}/context/${name}`;
    markdown(path, source, role(path, source));
  }
  const listed = listContextMarkdown(fs, root, `${dir}/context/md`, limits);
  findings.push(...listed.findings);
  for (const path of listed.paths) markdown(path, "context", role(path, "context"));

  const config = readNavoriConfig(fs, root, limits);
  if (config.status === "ok") {
    const sink = candidateSink({
      source: "navori.config.json",
      path: CONFIG_PATH,
    });
    if (config.value.name !== null) {
      sink.add("product", "name", { key: "name", value: config.value.name }, "/name");
    }
    if (config.value.language !== null) {
      sink.add(
        "product",
        "language",
        { key: "language", value: config.value.language },
        "/language",
      );
    }
    take(
      { source: "navori.config.json", path: CONFIG_PATH, status: "read" },
      { candidates: sink.items, findings: [] },
    );
  } else {
    take(...unsettled("navori.config.json", CONFIG_PATH, config, findings));
  }

  return {
    ok: true,
    draft: {
      sources,
      candidates,
      uxReader,
      uxExtensions,
      findings,
      ...(parts === undefined ? {} : { parts }),
    },
  };
}

/** One traceability candidate per seeded requirement, listing the parts that seed it (file order). */
function partsCandidates(
  parts: { id: string; seedRequirements: string[]; pointer: string }[],
  path: RelativeArtifactPath,
  skipped: Finding[],
): Extraction {
  const sink = candidateSink({ source: "parts.json", path });
  const byRequirement = new Map<string, { parts: string[]; pointer: string }>();
  for (const part of parts) {
    for (const requirement of part.seedRequirements) {
      const entry = byRequirement.get(requirement) ?? {
        parts: [],
        pointer: part.pointer,
      };
      if (!entry.parts.includes(part.id)) entry.parts.push(part.id);
      byRequirement.set(requirement, entry);
    }
  }
  for (const [requirement, entry] of byRequirement) {
    sink.add(
      "traceability",
      requirement,
      {
        requirement,
        parts: entry.parts,
        journeys: [],
        flows: [],
        screens: [],
        patterns: [],
      },
      `${entry.pointer}/seedRequirements`,
    );
  }
  return { candidates: sink.items, findings: skipped };
}

/** Record and findings of a harness JSON source that did not parse: absent, or unreadable with its finding. */
function unsettled<T>(
  source: SourceKind,
  path: RelativeArtifactPath,
  result: Exclude<HarnessReadResult<T>, { status: "ok" }>,
  findings: Finding[],
): [ContextSourceRecord, null] {
  if (result.status === "absent") return [{ source, path, status: "absent" }, null];
  findings.push(result.finding);
  return [{ source, path, status: "unreadable" }, null];
}

/** Detected iff navori.config.json and {specsDir}/_master/index.json both exist. Never throws on hostile input. */
export const navoriMasterAdapter: ProductContextAdapter = {
  id: "navori-master",
  detect: detectNavoriMaster,
  load: loadNavoriMaster,
};
