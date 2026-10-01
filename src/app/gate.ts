import {
  ExitCode,
  type GateData,
  type GateName,
  type HeronMode,
  type HeronState,
  type StoredModeDecision,
} from "../core/contracts/index.ts";
import { approveGate, rejectGate, type GateOutcome } from "../core/state/gates.ts";
import { canTransition, type TransitionFacts } from "../core/state/transitions.ts";
import type { FileStore } from "../core/store/file-store.ts";
import type { AppContext } from "./context.ts";
import { boundArtifacts, collectResearchFacts, collectTransitionFacts } from "./facts.ts";
import {
  failure,
  makeFinding,
  rejectionToFinding,
  storeErrorResult,
  type UseCaseResult,
} from "./result.ts";
import { loadWorkspace, type WorkspaceLoad } from "./workspace.ts";
import { withWriteRun, type WriteBodyResult, type WriteRun } from "./write-run.ts";

export type GateInput = {
  path: string;
  gate: GateName;
  decision: "approve" | "reject";
  note: string | null;
  reason: string | null;
  yes: boolean;
};

function outcomeFailure(
  outcome: Extract<GateOutcome, { ok: false }>,
  blocked: StoredModeDecision,
): UseCaseResult<GateData> {
  switch (outcome.code) {
    case "IDENTITY_REQUIRED":
    case "REASON_REQUIRED":
      return failure(ExitCode.Usage, makeFinding(outcome.code, "error", outcome.reason));
    case "NO_BOUND_ARTIFACTS":
      return failure(ExitCode.Blocked, makeFinding("PRECONDITION_UNMET", "error", outcome.reason));
    default:
      return failure(ExitCode.Blocked, rejectionToFinding(outcome, blocked));
  }
}

/** Transition facts of the snapshot: the P1 ones plus the research reference counts (R15). May throw document errors. */
function gateFacts(
  ctx: AppContext,
  store: FileStore,
  state: HeronState,
  gate: GateName,
): TransitionFacts {
  return {
    ...collectTransitionFacts(store, state, gate, ctx.fs),
    ...collectResearchFacts(store, ctx.research),
  };
}

/** Order: parse -> state readable -> effective mode -> canTransition -> confirmation (no lock held) -> lock with
 * expectedRevision R -> decision -> commit (state.json only) -> release. */
export async function runGate(ctx: AppContext, input: GateInput): Promise<UseCaseResult<GateData>> {
  let loaded: WorkspaceLoad;
  let facts: TransitionFacts | null = null;
  try {
    loaded = loadWorkspace(ctx, input.path);
    if (loaded.ok) {
      const { store, state, mode } = loaded.workspace;
      facts = gateFacts(ctx, store, { ...state, mode }, input.gate);
    }
  } catch (error) {
    const mapped = storeErrorResult<GateData>(error);
    if (mapped === null) throw error;
    return mapped;
  }
  if (!loaded.ok) return loaded.result;
  const { root, store, state: stored, mode, blocked } = loaded.workspace;
  // The effective mode is recomputed from the live detection (RN-29); the persisted one is kept on disk.
  const snapshot: HeronState = { ...stored, mode };
  const event = {
    type: input.decision === "approve" ? "approve-gate" : "reject-gate",
    gate: input.gate,
  } as const;
  const checked = canTransition(snapshot, event, facts ?? {});
  if (!checked.ok) return failure(ExitCode.Blocked, rejectionToFinding(checked, blocked));

  const decidedBy = ctx.identity.current()?.trim() ?? "";
  if (decidedBy === "") {
    return failure(
      ExitCode.Usage,
      makeFinding(
        "IDENTITY_REQUIRED",
        "error",
        "Cannot determine who is deciding the gate (OS user is empty).",
      ),
    );
  }
  const reason = input.reason?.trim() ?? "";
  if (input.decision === "reject" && reason === "") {
    return failure(
      ExitCode.Usage,
      makeFinding(
        "REASON_REQUIRED",
        "error",
        `heron gate ${input.gate} reject requires --reason <text>.`,
      ),
    );
  }
  if (!input.yes) {
    if (!ctx.isTTY) {
      return failure(
        ExitCode.Usage,
        makeFinding(
          "CONFIRMATION_REQUIRED",
          "error",
          "Gate decisions need an interactive terminal or --yes.",
        ),
      );
    }
    const verb = input.decision === "approve" ? "Approve" : "Reject";
    const count = boundArtifacts(ctx.fs, store, input.gate).length;
    const confirmed = await ctx.confirm(
      `${verb} gate "${input.gate}" bound to ${count} artifact(s)? [y/N] `,
    );
    if (!confirmed) {
      return failure(
        ExitCode.Usage,
        makeFinding(
          "CONFIRMATION_REQUIRED",
          "error",
          "Gate decision cancelled; nothing was written.",
        ),
      );
    }
  }

  return withWriteRun(
    ctx,
    root,
    {
      path: input.path,
      command: "gate",
      create: false,
      requireState: true,
      expectedRevision: stored.stateRevision,
    },
    (run) => decide(ctx, run, input, { decidedBy, reason, mode, blocked }),
  );
}

/** Under the lock: facts and bound artifacts are recomputed, then the decision is applied and committed. */
function decide(
  ctx: AppContext,
  { store, previous, meta }: WriteRun,
  input: GateInput,
  who: { decidedBy: string; reason: string; mode: HeronMode; blocked: StoredModeDecision },
): WriteBodyResult<GateData> {
  if (previous === null) throw new Error("withWriteRun requireState guarantees state.json");
  const state: HeronState = { ...previous, mode: who.mode };
  const facts = gateFacts(ctx, store, state, input.gate);
  const artifacts = boundArtifacts(ctx.fs, store, input.gate);
  const outcome =
    input.decision === "approve"
      ? approveGate(
          state,
          { gate: input.gate, decidedBy: who.decidedBy, note: input.note, artifacts, meta },
          facts,
        )
      : rejectGate(
          state,
          { gate: input.gate, decidedBy: who.decidedBy, reason: who.reason, artifacts, meta },
          facts,
        );
  if (!outcome.ok) return { kind: "skip", result: outcomeFailure(outcome, who.blocked) };
  const next: HeronState = { ...outcome.state, mode: previous.mode };
  const data: GateData = {
    gate: input.gate,
    decision: input.decision === "approve" ? "approved" : "rejected",
    from: previous.phase,
    to: next.phase,
    stateRevision: next.stateRevision,
    artifacts: outcome.decision.artifacts,
  };
  return { kind: "commit", state: next, data, findings: [], next: [`heron status ${input.path}`] };
}
