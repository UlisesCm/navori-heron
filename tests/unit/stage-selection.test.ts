// Covers: R6
import { describe, expect, test } from "bun:test";
import type {
  MasterIndexView,
  MasterStageView,
} from "../../src/intake/adapters/navori-master/harness.ts";
import { selectStage, STAGE_DIR_PATTERN } from "../../src/intake/adapters/navori-master/stage.ts";

const IDX = "specs/_master/index.json";
const stage = (number: number, slug: string, state: string): MasterStageView => ({
  number,
  slug,
  dir: `${String(number).padStart(2, "0")}-${slug}`,
  state,
  closedAt: state === "activa" ? null : "2026-09-30",
});
const view = (...stages: MasterStageView[]): MasterIndexView => ({
  version: 1,
  stages,
  skipped: [],
});

describe("selectStage", () => {
  test("picks the last closed stage and never uses converted or abandoned stages without --stage", () => {
    // Covers: R6
    const closed = view(
      stage(1, "alpha", "cerrada"),
      stage(2, "beta", "cerrada"),
      stage(3, "gamma", "abandonada"),
      stage(4, "delta", "convertida"),
    );
    expect(selectStage(closed, null, IDX)).toEqual({
      ok: true,
      stage: stage(2, "beta", "cerrada"),
      selection: "last-closed",
      notice: "No active stage; using last closed: 02-beta",
    });
    // highest number wins, regardless of index order
    const unordered = view(stage(5, "e", "cerrada"), stage(2, "b", "cerrada"));
    expect(selectStage(unordered, null, IDX)).toMatchObject({ stage: { dir: "05-e" } });
    // explicit selection reaches any state, with no notice
    for (const dir of ["01-alpha", "03-gamma", "04-delta"]) {
      expect(selectStage(closed, dir, IDX)).toMatchObject({
        ok: true,
        selection: "explicit",
        notice: null,
        stage: { dir },
      });
    }
    // only converted/abandoned -> not selectable implicitly
    const onlyDead = view(stage(1, "a", "convertida"), stage(2, "b", "abandonada"));
    expect(selectStage(onlyDead, null, IDX)).toMatchObject({
      ok: false,
      error: {
        code: "NO_SELECTABLE_STAGE",
        message: `No active or closed stage in ${IDX}; pass --stage <NN-slug>.`,
        available: [
          { dir: "01-a", state: "convertida" },
          { dir: "02-b", state: "abandonada" },
        ],
      },
    });
  });

  test("prefers the active stage, even with closed ones after it", () => {
    // Covers: R6
    const r = selectStage(view(stage(1, "a", "activa"), stage(2, "b", "cerrada")), null, IDX);
    expect(r).toMatchObject({
      ok: true,
      selection: "active",
      notice: null,
      stage: { dir: "01-a" },
    });
  });

  test("an empty index selects nothing; unknown or malformed requests are errors", () => {
    // Covers: R6
    expect(selectStage(view(), null, IDX)).toEqual({
      ok: true,
      stage: null,
      selection: null,
      notice: null,
    });
    expect(selectStage(view(stage(1, "a", "activa")), "99-x", IDX)).toMatchObject({
      ok: false,
      error: {
        code: "STAGE_NOT_FOUND",
        requested: "99-x",
        message: `Stage "99-x" not found in ${IDX}.`,
        available: [{ dir: "01-a", state: "activa" }],
      },
    });
    for (const bad of ["x", "1-a", "01_a", "../01-a", "01-A", ""]) {
      expect(selectStage(view(stage(1, "a", "activa")), bad, IDX)).toMatchObject({
        ok: false,
        error: {
          code: "INVALID_STAGE",
          message: `Invalid stage "${bad}": expected NN-slug, for example 01-mvp.`,
        },
      });
    }
  });

  test("STAGE_DIR_PATTERN accepts NN-slug forms only", () => {
    // Covers: R6
    for (const ok of ["01-mvp", "10-a-b-c", "100-x1"])
      expect(STAGE_DIR_PATTERN.test(ok)).toBe(true);
    for (const bad of ["1-mvp", "01-", "01-mvp-", "01--mvp", "01-mvp/x"])
      expect(STAGE_DIR_PATTERN.test(bad)).toBe(false);
  });
});
