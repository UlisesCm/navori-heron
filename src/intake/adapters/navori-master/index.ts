import type {
  DetectedArtifact,
  DetectionReport,
  Finding,
  HarnessArtifactName,
  HarnessDeclaration,
} from "../../../core/contracts/index.ts";
import {
  loadNotAvailable,
  type AdapterDetection,
  type DetectRequest,
  type ProductContextAdapter,
} from "../../ports.ts";
import { probeFile } from "../../probe.ts";
import { checkUxFiles } from "../../ux-contract.ts";
import {
  HARNESS_UX_DECLARATIONS,
  readMasterIndex,
  readNavoriConfig,
  readStageState,
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

/** Detected iff navori.config.json and {specsDir}/_master/index.json both exist. Never throws on hostile input. */
export const navoriMasterAdapter: ProductContextAdapter = {
  id: "navori-master",
  detect: detectNavoriMaster,
  load: () => loadNotAvailable("navori-master"),
};
