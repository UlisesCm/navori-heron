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

/** Upserts `updates` by path (result sorted by path) and propagateStale(reason) over the paths whose sha256 changed.
 * Never mutates; the revision is untouched (call it after recordInit/recordCommand so `since` is the new revision). */
export function withArtifacts(
  state: HeronState,
  updates: readonly BoundArtifact[],
  reason: string,
): HeronState {
  const merged = new Map(state.artifacts.map((artifact) => [artifact.path, artifact]));
  const changed: string[] = [];
  for (const update of updates) {
    const before = merged.get(update.path);
    if (before !== undefined && before.sha256 !== update.sha256) changed.push(update.path);
    merged.set(update.path, update);
  }
  const next: HeronState = { ...state, artifacts: [...merged.values()].toSorted(byPath) };
  return propagateStale(next, changed, reason);
}

function appendHistory(state: HeronState, mode: HeronMode, meta: TransitionMeta): HeronState {
  const stateRevision = state.stateRevision + 1;
  return {
    ...state,
    stateRevision,
    mode,
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
}

/** stateRevision + 1 and a history entry with transition null (a command that writes without a table event). */
export function recordCommand(state: HeronState, meta: TransitionMeta): HeronState {
  return appendHistory(state, state.mode, meta);
}

/** stateRevision + 1, mode updated, then withArtifacts(init artifacts): research and brand artifacts are kept.
 * Phase never changes here (RN-29: the mode guard blocks). */
export function recordInit(state: HeronState, input: LifecycleInput): HeronState {
  const { mode, artifacts, meta } = input;
  return withArtifacts(
    appendHistory(state, mode, meta),
    artifacts,
    "An upstream artifact changed since the last heron init.",
  );
}
