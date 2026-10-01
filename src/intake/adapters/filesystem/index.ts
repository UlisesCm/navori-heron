import { createDraftKit } from "../../draft-kit.ts";
import {
  type AdapterDetection,
  type AdapterLoadResult,
  type DetectRequest,
  type LoadRequest,
  type ProductContextAdapter,
} from "../../ports.ts";
import { checkUxFiles } from "../../ux-contract.ts";
import { extractUxMarkdown } from "../../ux-markdown.ts";

const UX_FILES = { markdown: "UX.md", json: "ux.json" } as const;

function detectFilesystem(request: DetectRequest): AdapterDetection {
  const ux = checkUxFiles(request.fs, request.root, UX_FILES, null, request.limits);
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

/** Sources, in draft order: `ux.json` then `UX.md` at the repo root, both only in `full` (otherwise a present
 * file is `unused`; one file alone is enough to reach `full`). `ux.json` bytes that differ from
 * `report.uxJson.sha256` fail with INPUTS_CHANGED. */
function loadFilesystem(request: LoadRequest): AdapterLoadResult {
  const kit = createDraftKit(request);
  const full = request.mode === "full";
  const changed = kit.uxJson(
    { path: UX_FILES.json, expectedStage: null, detectedSha256: request.report.uxJson.sha256 },
    full,
  );
  if (changed !== null) return changed;
  kit.markdown(
    UX_FILES.markdown,
    "UX.md",
    (doc) => extractUxMarkdown(doc, UX_FILES.markdown),
    full,
  );
  return kit.finish();
}

/** Repo without a master-plan: always detected; UX.md and ux.json at the repo root. */
export const filesystemAdapter: ProductContextAdapter = {
  id: "filesystem",
  detect: detectFilesystem,
  load: loadFilesystem,
};
