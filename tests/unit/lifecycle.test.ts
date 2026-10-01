// Covers: R6, R8
import { describe, expect, test } from "bun:test";
import type { BoundArtifact, HeronState } from "../../src/core/contracts/index.ts";
import {
  createInitialState,
  freshen,
  recordCommand,
  recordInit,
  withArtifacts,
} from "../../src/core/state/lifecycle.ts";
import type { TransitionMeta } from "../../src/core/state/transitions.ts";

const sha = (char: string): string => char.repeat(64);
const meta: TransitionMeta = {
  runId: "run-20260930T120000Z-3f9a1c2b",
  at: "2026-09-30T12:00:00.000Z",
  command: "references add",
  heronVersion: "0.0.0",
};
const initArtifacts: BoundArtifact[] = [
  { path: "project.json", sha256: sha("1") },
  { path: "intake/mode.json", sha256: sha("2") },
];
const research: BoundArtifact[] = [
  { path: "research/references.json", sha256: sha("3") },
  { path: "research/assets/" + sha("4") + ".webp", sha256: sha("4") },
];

function base(): HeronState {
  const initial = createInitialState({ mode: "reference-only", artifacts: initArtifacts, meta });
  return withArtifacts(initial, research, "test");
}

describe("lifecycle", () => {
  test("upserts artifacts and records commands without dropping research files", () => {
    const state = base();
    expect(state.artifacts.map((a) => a.path)).toEqual([
      "intake/mode.json",
      "project.json",
      "research/assets/" + sha("4") + ".webp",
      "research/references.json",
    ]);

    // recordInit keeps research files and updates the init ones
    const reinit = recordInit(state, {
      mode: "full",
      artifacts: [{ path: "project.json", sha256: sha("9") }, initArtifacts[1]!],
      meta: { ...meta, command: "init" },
    });
    expect(reinit.stateRevision).toBe(2);
    expect(reinit.mode).toBe("full");
    expect(reinit.artifacts.find((a) => a.path === "project.json")?.sha256).toBe(sha("9"));
    expect(reinit.artifacts.filter((a) => a.path.startsWith("research/"))).toHaveLength(2);

    // recordCommand: revision + 1, history entry without transition, mode kept
    const recorded = recordCommand(state, meta);
    expect(recorded.stateRevision).toBe(state.stateRevision + 1);
    expect(recorded.mode).toBe(state.mode);
    expect(recorded.history.at(-1)).toMatchObject({
      stateRevision: recorded.stateRevision,
      command: "references add",
      transition: null,
    });
    expect(recorded.artifacts).toEqual(state.artifacts);

    // withArtifacts never mutates and upserts by path
    const snapshot = structuredClone(state);
    const changed = withArtifacts(
      state,
      [{ path: "research/references.json", sha256: sha("5") }],
      "references changed",
    );
    expect(state).toEqual(snapshot);
    expect(changed.artifacts).toHaveLength(state.artifacts.length);
    expect(changed.artifacts.find((a) => a.path === "research/references.json")?.sha256).toBe(
      sha("5"),
    );
    // identical bytes: nothing becomes stale
    expect(withArtifacts(state, research, "same").stale).toEqual(state.stale);
  });

  test("marks dependents stale only for artifacts whose sha256 changed", () => {
    const foundations: BoundArtifact = { path: "design/foundations/colors.json", sha256: sha("6") };
    const state = withArtifacts(base(), [foundations], "seed");
    const next = withArtifacts(
      recordCommand(state, meta),
      [{ path: "research/references.json", sha256: sha("7") }],
      "An upstream research artifact changed.",
    );
    expect(next.stale).toEqual([
      {
        path: "design/foundations/colors.json",
        reason: "An upstream research artifact changed.",
        since: next.stateRevision,
      },
    ]);
  });

  // Covers: R8
  test("freshens regenerated artifacts and marks their dependents stale", () => {
    const foundations: BoundArtifact = { path: "design/foundations/colors.json", sha256: sha("6") };
    const state = withArtifacts(base(), [foundations], "seed");
    const stale = withArtifacts(
      recordCommand(state, meta),
      [
        { path: "research/references.json", sha256: sha("7") },
        { path: "intake/mode.json", sha256: sha("8") },
      ],
      "An upstream artifact changed.",
    );
    // withArtifacts marks the dependents of what changed; freshen drops only the regenerated path.
    expect(stale.stale.map((entry) => entry.path)).toContain("design/foundations/colors.json");
    const snapshot = structuredClone(stale);
    const fresh = freshen(stale, ["design/foundations/colors.json"]);
    expect(stale).toEqual(snapshot);
    expect(fresh.stale.map((entry) => entry.path)).not.toContain("design/foundations/colors.json");
    expect(fresh.stale).toEqual(
      stale.stale.filter((entry) => entry.path !== "design/foundations/colors.json"),
    );
    expect(fresh.artifacts).toEqual(stale.artifacts);
    expect(fresh.stateRevision).toBe(stale.stateRevision);
    // Paths that are not stale are ignored.
    expect(freshen(stale, ["research/references.json"]).stale).toEqual(stale.stale);
  });
});
