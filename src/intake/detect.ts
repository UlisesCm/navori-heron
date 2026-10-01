import { filesystemAdapter } from "./adapters/filesystem/index.ts";
import { navoriMasterAdapter } from "./adapters/navori-master/index.ts";
import type { AdapterId, DetectionReport } from "../core/contracts/index.ts";
import type { DetectRequest, ProductContextAdapter, StageError } from "./ports.ts";

export const DEFAULT_ADAPTERS: readonly ProductContextAdapter[] = [
  navoriMasterAdapter,
  filesystemAdapter,
];

export type ProjectDetection = { kind: "detected"; report: DetectionReport } | StageError;

/** First adapter returning "detected" or "stage-error" wins; filesystemAdapter always detects. */
export function detectProject(
  request: DetectRequest,
  adapters: readonly ProductContextAdapter[] = DEFAULT_ADAPTERS,
): ProjectDetection {
  for (const adapter of adapters) {
    const result = adapter.detect(request);
    if (result.kind !== "not-detected") return result;
  }
  const fallback = filesystemAdapter.detect(request);
  if (fallback.kind === "not-detected") throw new Error("filesystem adapter must always detect");
  return fallback;
}

/** The default adapter that owns `id`, or null when none does (opt-in adapters arrive with T10). */
export function adapterFor(id: AdapterId): ProductContextAdapter | null {
  return DEFAULT_ADAPTERS.find((adapter) => adapter.id === id) ?? null;
}
