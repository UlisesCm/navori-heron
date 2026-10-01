import { filesystemAdapter } from "./adapters/filesystem/index.ts";
import { manualAdapter } from "./adapters/manual/index.ts";
import { markdownAdapter } from "./adapters/markdown/index.ts";
import { navoriMasterAdapter } from "./adapters/navori-master/index.ts";
import type { AdapterId, DetectionReport } from "../core/contracts/index.ts";
import type { DetectRequest, ProductContextAdapter, StageError } from "./ports.ts";

export const DEFAULT_ADAPTERS: readonly ProductContextAdapter[] = [
  navoriMasterAdapter,
  filesystemAdapter,
];

/** Adapters that only run when `init` selected them explicitly (DR28); `detectProject` never tries them
 * on its own. */
export const OPT_IN_ADAPTERS: Readonly<Partial<Record<AdapterId, ProductContextAdapter>>> = {
  markdown: markdownAdapter,
  manual: manualAdapter,
};

export type ProjectDetection = { kind: "detected"; report: DetectionReport } | StageError;

/** An explicit `request.selection` runs that opt-in adapter only (no fallback); otherwise the first adapter
 * returning "detected" or "stage-error" wins and filesystemAdapter always detects. */
export function detectProject(
  request: DetectRequest,
  adapters: readonly ProductContextAdapter[] = DEFAULT_ADAPTERS,
): ProjectDetection {
  const selected = request.selection;
  if (selected !== undefined && selected !== null) {
    const result = OPT_IN_ADAPTERS[selected.adapter]?.detect(request);
    if (result === undefined || result.kind === "not-detected") {
      throw new Error(`the ${selected.adapter} adapter must detect an explicit selection`);
    }
    return result;
  }
  for (const adapter of adapters) {
    const result = adapter.detect(request);
    if (result.kind !== "not-detected") return result;
  }
  const fallback = filesystemAdapter.detect(request);
  if (fallback.kind === "not-detected") throw new Error("filesystem adapter must always detect");
  return fallback;
}

/** The adapter that owns `id` (default or opt-in), or null when none does. */
export function adapterFor(id: AdapterId): ProductContextAdapter | null {
  return DEFAULT_ADAPTERS.find((adapter) => adapter.id === id) ?? OPT_IN_ADAPTERS[id] ?? null;
}
