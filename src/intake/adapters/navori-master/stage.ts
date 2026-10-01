import type { StageSelection } from "../../../core/contracts/index.ts";
import type { StageError } from "../../ports.ts";
import type { MasterIndexView, MasterStageView } from "./harness.ts";

export const STAGE_DIR_PATTERN: RegExp = /^\d{2,}-[a-z0-9]+(?:-[a-z0-9]+)*$/;

export type StageSelectionResult =
  | { ok: true; stage: MasterStageView; selection: StageSelection; notice: string | null }
  | { ok: true; stage: null; selection: null; notice: null } // index has 0 stages -> NO_STAGE
  | { ok: false; error: StageError };

function stageError(
  index: MasterIndexView,
  code: StageError["code"],
  requested: string | null,
  message: string,
): StageSelectionResult {
  return {
    ok: false,
    error: {
      kind: "stage-error",
      code,
      requested,
      available: index.stages.map((s) => ({ dir: s.dir, state: s.state })),
      message,
    },
  };
}

/** requested != null: must match STAGE_DIR_PATTERN (else INVALID_STAGE) and a stage dir in any state (else STAGE_NOT_FOUND).
 * requested == null: the "activa" stage; else the "cerrada" stage with the highest number, notice
 * "No active stage; using last closed: {dir}"; else NO_SELECTABLE_STAGE (D22: convertida/abandonada never implicit). */
export function selectStage(
  index: MasterIndexView,
  requested: string | null,
  indexPath: string,
): StageSelectionResult {
  if (requested !== null) {
    if (!STAGE_DIR_PATTERN.test(requested)) {
      return stageError(
        index,
        "INVALID_STAGE",
        requested,
        `Invalid stage "${requested}": expected NN-slug, for example 01-mvp.`,
      );
    }
    const found = index.stages.find((s) => s.dir === requested);
    if (found === undefined) {
      return stageError(
        index,
        "STAGE_NOT_FOUND",
        requested,
        `Stage "${requested}" not found in ${indexPath}.`,
      );
    }
    return { ok: true, stage: found, selection: "explicit", notice: null };
  }
  if (index.stages.length === 0) return { ok: true, stage: null, selection: null, notice: null };
  const active = index.stages.find((s) => s.state === "activa");
  if (active !== undefined) return { ok: true, stage: active, selection: "active", notice: null };
  const closed = index.stages
    .filter((s) => s.state === "cerrada")
    .reduce<MasterStageView | null>(
      (best, s) => (best === null || s.number > best.number ? s : best),
      null,
    );
  if (closed === null) {
    return stageError(
      index,
      "NO_SELECTABLE_STAGE",
      null,
      `No active or closed stage in ${indexPath}; pass --stage <NN-slug>.`,
    );
  }
  return {
    ok: true,
    stage: closed,
    selection: "last-closed",
    notice: `No active stage; using last closed: ${closed.dir}`,
  };
}
