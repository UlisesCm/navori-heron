import {
  loadNotAvailable,
  type AdapterDetection,
  type DetectRequest,
  type ProductContextAdapter,
} from "../../ports.ts";
import { checkUxFiles } from "../../ux-contract.ts";

function detectFilesystem(request: DetectRequest): AdapterDetection {
  const ux = checkUxFiles(
    request.fs,
    request.root,
    { markdown: "UX.md", json: "ux.json" },
    null,
    request.limits,
  );
  return {
    kind: "detected",
    report: {
      adapter: "filesystem",
      navoriMaster: false,
      specsDir: null,
      stage: null,
      stageStatus: "not-applicable",
      stageNotice: null,
      harness: null,
      artifacts: [],
      uxMarkdown: ux.uxMarkdown,
      uxJson: ux.uxJson,
      findings: ux.findings,
    },
  };
}

/** Repo without a master-plan: always detected; UX.md and ux.json at the repo root. */
export const filesystemAdapter: ProductContextAdapter = {
  id: "filesystem",
  detect: detectFilesystem,
  load: () => loadNotAvailable("filesystem"),
};
