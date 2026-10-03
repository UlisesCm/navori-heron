// Covers: R8, R9, R10
import { describe, expect, test } from "bun:test";
import type { BoundArtifact, HeronState } from "../../src/core/contracts/index.ts";
import { createInitialState, recordInit } from "../../src/core/state/lifecycle.ts";
import { markStaleAfter, matchesGlob, propagateStale } from "../../src/core/state/stale.ts";
import type { TransitionMeta } from "../../src/core/state/transitions.ts";

const H1 = "1".repeat(64);
const H2 = "2".repeat(64);
const meta: TransitionMeta = {
  runId: "run-20260930T120000Z-3f9a1c2b",
  at: "2026-09-30T12:00:00.000Z",
  command: "init",
  heronVersion: "0.0.0",
};
const art = (path: string, sha256 = H1): BoundArtifact => ({ path, sha256 });
const paths = (state: HeronState): string[] => state.stale.map((s) => s.path);

describe("matchesGlob segment wildcards", () => {
  test("multiple stars, edges and alone", () => {
    expect(matchesGlob("axxbyyc", "a*b*c")).toBe(true);
    expect(matchesGlob("axxbyy", "a*b*c")).toBe(false);
    expect(matchesGlob("abc", "*c")).toBe(true);
    expect(matchesGlob("abc", "a*")).toBe(true);
    expect(matchesGlob("abc", "*")).toBe(true);
    expect(matchesGlob("", "*")).toBe(true);
    expect(matchesGlob("", "a")).toBe(false);
  });
  test("regex metacharacters are literal", () => {
    expect(matchesGlob("axb", "a.b")).toBe(false);
    expect(matchesGlob("a.b", "a.b")).toBe(true);
    expect(matchesGlob("x", "[x]")).toBe(false);
    expect(matchesGlob("[x]", "[x]")).toBe(true);
    expect(matchesGlob("a?", "a?")).toBe(true);
    expect(matchesGlob("ab", "a?")).toBe(false);
  });
  test("no catastrophic backtracking", () => {
    const start = performance.now();
    expect(matchesGlob("a".repeat(5000), "*a*a*a*a*a*a*a*a*b")).toBe(false);
    expect(performance.now() - start).toBeLessThan(2_000); // exponential backtracking would take minutes; linear is < 5 ms
  });
});

describe("matchesGlob", () => {
  test("supports ** across segments and * within one", () => {
    expect(matchesGlob("design/tokens/colors.json", "design/tokens/**")).toBe(true);
    expect(matchesGlob("design/tokens", "design/tokens/**")).toBe(true);
    expect(matchesGlob("design/a/b/c.json", "design/**")).toBe(true);
    expect(matchesGlob("design/a.json", "design/*.json")).toBe(true);
    expect(matchesGlob("design/x/a.json", "design/*.json")).toBe(false);
    expect(matchesGlob("intake/mode.json", "intake/mode.json")).toBe(true);
    expect(matchesGlob("intake/mode.jsonx", "intake/mode.json")).toBe(false);
    expect(matchesGlob("a.b", "a.b")).toBe(true);
    expect(matchesGlob("axb", "a.b")).toBe(false);
  });
});

describe("stale propagation", () => {
  const state = {
    ...createInitialState({
      mode: "full",
      meta,
      artifacts: [
        art("intake/mode.json"),
        art("intake/product-context.json"),
        art("research/visual-directions.json"),
        art("design/tokens/colors.json"),
        art("design/screens/home.json"),
        art("penpot/sync-state.json"),
      ],
    }),
    stateRevision: 4,
  };

  test("propagates transitively through dependencies", () => {
    const next = propagateStale(state, ["intake/mode.json"], "mode changed");
    expect(paths(next)).toEqual([
      "design/screens/home.json",
      "design/tokens/colors.json",
      "intake/product-context.json",
      "penpot/sync-state.json",
      "research/visual-directions.json",
    ]);
    expect(next.stale.every((s) => s.since === 4 && s.reason === "mode changed")).toBe(true);
  });

  test("does not touch independent artifacts and keeps entries unique", () => {
    const next = propagateStale(state, ["design/screens/home.json"], "screen changed");
    expect(paths(next)).toEqual(["penpot/sync-state.json"]);
    const again = propagateStale(next, ["design/screens/home.json"], "other reason");
    expect(again.stale).toEqual(next.stale);
    expect(propagateStale(state, [], "none")).toBe(state);
  });

  test("marks artifacts produced by later phases stale after a regression", () => {
    const next = markStaleAfter(state, "directions-ready", "regressed");
    expect(paths(next)).toEqual([
      "design/screens/home.json",
      "design/tokens/colors.json",
      "penpot/sync-state.json",
    ]);
    expect(markStaleAfter(state, "exported", "x").stale).toEqual([]);
  });
});

describe("direction dependencies", () => {
  // Covers: R10, R11
  test("marks directions stale when the brief or the analysis changes", () => {
    const state = createInitialState({
      mode: "full",
      meta,
      artifacts: [
        art("research/references.json"),
        art("research/brief.json"),
        art("research/analysis.json"),
        art("research/visual-directions.json"),
      ],
    });
    expect(paths(propagateStale(state, ["research/brief.json"], "brief changed"))).toEqual([
      "research/visual-directions.json",
    ]);
    expect(paths(propagateStale(state, ["research/analysis.json"], "analysis changed"))).toEqual([
      "research/visual-directions.json",
    ]);
    // the analysis depends on references only (DR28): a new brief never leaves it stale
    expect(paths(propagateStale(state, ["research/references.json"], "refs changed"))).toEqual([
      "research/analysis.json",
      "research/visual-directions.json",
    ]);
    // brief and analysis are research artifacts (DR34): a regression before researching stales them
    expect(paths(markStaleAfter(state, "intake-ready", "regressed"))).toEqual([
      "research/analysis.json",
      "research/brief.json",
      "research/references.json",
      "research/visual-directions.json",
    ]);
  });
});

describe("review sync dependencies", () => {
  // Covers: R15
  test("marks the review sync stale when the directions or the references change", () => {
    const state = createInitialState({
      mode: "full",
      meta,
      artifacts: [
        art("research/references.json"),
        art("research/visual-directions.json"),
        art("penpot/review-sync.json"),
      ],
    });
    expect(
      paths(propagateStale(state, ["research/visual-directions.json"], "directions changed")),
    ).toEqual(["penpot/review-sync.json"]);
    expect(paths(propagateStale(state, ["research/references.json"], "refs changed"))).toEqual([
      "penpot/review-sync.json",
      "research/visual-directions.json",
    ]);
    // a regression before directions-ready stales it, like any artifact of a later phase
    expect(paths(markStaleAfter(state, "research-ready", "regressed"))).toContain(
      "penpot/review-sync.json",
    );
  });
});

describe("lifecycle", () => {
  test("createInitialState starts at revision 1 in initialized", () => {
    const created = createInitialState({
      mode: "reference-only",
      meta,
      artifacts: [art("project.json"), art("intake/mode.json")],
    });
    expect(created.phase).toBe("initialized");
    expect(created.stateRevision).toBe(1);
    expect(created.artifacts.map((a) => a.path)).toEqual(["intake/mode.json", "project.json"]);
    expect(created.history).toHaveLength(1);
    expect(created.history[0]?.transition).toBeNull();
  });

  test("recordInit bumps the revision, keeps the phase and stales dependents of changed files", () => {
    const created = createInitialState({
      mode: "full",
      meta,
      artifacts: [art("intake/mode.json"), art("intake/product-context.json")],
    });
    const next = recordInit(created, {
      mode: "reference-only",
      meta: { ...meta, runId: "run-20260930T130000Z-aaaaaaaa" },
      artifacts: [art("intake/mode.json", H2), art("intake/product-context.json")],
    });
    expect(next.stateRevision).toBe(2);
    expect(next.phase).toBe("initialized");
    expect(next.mode).toBe("reference-only");
    expect(next.history).toHaveLength(2);
    expect(paths(next)).toEqual(["intake/product-context.json"]);
    const same = recordInit(next, { mode: "reference-only", meta, artifacts: next.artifacts });
    expect(same.stale).toEqual(next.stale);
  });
});
