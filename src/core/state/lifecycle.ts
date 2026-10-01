import type { BoundArtifact, HeronMode, HeronState } from "../contracts/index.ts";
import { compareStrings, propagateStale } from "./stale.ts";
import type { TransitionMeta } from "./transitions.ts";

type LifecycleInput = { mode: HeronMode; artifacts: BoundArtifact[]; meta: TransitionMeta };

const byPath = (a: BoundArtifact, b: BoundArtifact): number => compareStrings(a.path, b.path);

export function createInitialState(input: LifecycleInput): HeronState {
  const { mode, artifacts, meta } = input;
  return {
    kind: "HeronState",
    schemaVersion: 1,
    stateRevision: 1,
    mode,
    phase: "initialized",
    designRevision: 0,
    artifacts: artifacts.toSorted(byPath),
    gates: [],
    stale: [],
    history: [
      {
        stateRevision: 1,
        runId: meta.runId,
        command: meta.command,
        heronVersion: meta.heronVersion,
        at: meta.at,
        mode,
        transition: null,
      },
    ],
  };
}

/** stateRevision + 1, mode updated, artifacts replaced, history entry (transition null),
 * propagateStale over artifacts whose sha256 changed. Phase never changes here (RN-29: the mode guard blocks). */
export function recordInit(state: HeronState, input: LifecycleInput): HeronState {
  const { mode, artifacts, meta } = input;
  const previous = new Map(state.artifacts.map((artifact) => [artifact.path, artifact.sha256]));
  const changed = artifacts
    .filter((artifact) => {
      const before = previous.get(artifact.path);
      return before !== undefined && before !== artifact.sha256;
    })
    .map((artifact) => artifact.path);
  const stateRevision = state.stateRevision + 1;
  const next: HeronState = {
    ...state,
    stateRevision,
    mode,
    artifacts: artifacts.toSorted(byPath),
    history: [
      ...state.history,
      {
        stateRevision,
        runId: meta.runId,
        command: meta.command,
        heronVersion: meta.heronVersion,
        at: meta.at,
        mode,
        transition: null,
      },
    ],
  };
  return propagateStale(next, changed, "An upstream artifact changed since the last heron init.");
}
