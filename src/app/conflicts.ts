import {
  ExitCode,
  INTAKE_CONFLICTS_DOCUMENT,
  canonicalJson,
  parseVersionedDocument,
  type ConflictsAckData,
  type ConflictsListData,
  type IntakeConflicts,
} from "../core/contracts/index.ts";
import { freshen, recordCommand, withArtifacts } from "../core/state/lifecycle.ts";
import { acknowledgeConflict, unacknowledgedCount } from "../intake/conflicts.ts";
import type { AppContext } from "./context.ts";
import { CONFLICTS_FILE } from "./intake.ts";
import { failure, makeFinding, storeErrorResult, type UseCaseResult } from "./result.ts";
import { loadWorkspace } from "./workspace.ts";
import { withWriteRun, type WriteBodyResult } from "./write-run.ts";

export type ConflictsListInput = { path: string; all: boolean };
export type ConflictsAckInput = { path: string; id: string; note: string | null; yes: boolean };

/** Same limit as ConflictAck.note in the persisted schema. */
const MAX_NOTE_LENGTH = 2000;
const STALE_REASON = "A conflict acknowledgement changed.";

/** Read-only, no lock: the conflicts of the last intake (open ones; resolved too with `all`). */
export async function runConflictsList(
  ctx: AppContext,
  input: ConflictsListInput,
): Promise<UseCaseResult<ConflictsListData>> {
  try {
    const loaded = loadWorkspace(ctx, input.path);
    if (!loaded.ok) return loaded.result;
    const doc = loaded.workspace.store.readDocument(CONFLICTS_FILE, INTAKE_CONFLICTS_DOCUMENT);
    const conflicts = (doc?.conflicts ?? []).filter((c) => input.all || c.status === "open");
    return {
      ok: true,
      data: { tracked: doc !== null, conflicts },
      findings: [],
      next: doc === null ? [`heron intake ${input.path}`] : [],
    };
  } catch (error) {
    const mapped = storeErrorResult<ConflictsListData>(error);
    if (mapped === null) throw error;
    return mapped;
  }
}

/** The reason `id` cannot be acknowledged in `doc`, or null when it is open and not acknowledged yet. */
function ackBlocker(doc: IntakeConflicts | null, id: string): UseCaseResult<never> | null {
  const found = doc?.conflicts.find((c) => c.id === id);
  if (found === undefined) {
    return failure(
      ExitCode.Usage,
      makeFinding("CONFLICT_NOT_FOUND", "error", `${id} not found in .heron/${CONFLICTS_FILE}.`),
    );
  }
  if (found.status !== "open") {
    return failure(
      ExitCode.Usage,
      makeFinding(
        "CONFLICT_NOT_FOUND",
        "error",
        `${id} is resolved; only open conflicts can be acknowledged.`,
      ),
    );
  }
  if (found.ack !== null) {
    return failure(
      ExitCode.Usage,
      makeFinding(
        "CONFLICT_ALREADY_ACKNOWLEDGED",
        "error",
        `${id} was already acknowledged by ${found.ack.by} at ${found.ack.at}.`,
      ),
    );
  }
  return null;
}

/**
 * note -> identity -> loadWorkspace -> open and not acknowledged -> confirmation (no lock) -> withWriteRun
 * (expectedRevision R): acknowledgeConflict -> tx.put conflicts.json -> recordCommand + withArtifacts + freshen ->
 * commit. Acknowledging after the intake gate was approved invalidates that approval (RN-28).
 */
export async function runConflictsAck(
  ctx: AppContext,
  input: ConflictsAckInput,
): Promise<UseCaseResult<ConflictsAckData>> {
  const note = input.note?.trim() ?? "";
  if (note === "") {
    return failure(
      ExitCode.Usage,
      makeFinding("NOTE_REQUIRED", "error", "heron conflicts ack requires --note <text>."),
    );
  }
  if (note.length > MAX_NOTE_LENGTH) {
    return failure(
      ExitCode.Usage,
      makeFinding("USAGE", "error", `--note is limited to ${MAX_NOTE_LENGTH} characters.`),
    );
  }
  const by = ctx.identity.current()?.trim() ?? "";
  if (by === "") {
    return failure(
      ExitCode.Usage,
      makeFinding(
        "IDENTITY_REQUIRED",
        "error",
        "Cannot determine who is acknowledging the conflict (OS user is empty).",
      ),
    );
  }
  try {
    const loaded = loadWorkspace(ctx, input.path);
    if (!loaded.ok) return loaded.result;
    const { root, store, state } = loaded.workspace;
    const blocked = ackBlocker(
      store.readDocument(CONFLICTS_FILE, INTAKE_CONFLICTS_DOCUMENT),
      input.id,
    );
    if (blocked !== null) return blocked;
    if (!input.yes) {
      if (!ctx.isTTY) {
        return failure(
          ExitCode.Usage,
          makeFinding(
            "CONFIRMATION_REQUIRED",
            "error",
            "Acknowledging a conflict needs an interactive terminal or --yes.",
          ),
        );
      }
      if (!(await ctx.confirm(`Acknowledge ${input.id} as ${by}? [y/N] `))) {
        return failure(
          ExitCode.Usage,
          makeFinding(
            "CONFIRMATION_REQUIRED",
            "error",
            "Acknowledgement cancelled; nothing was written.",
          ),
        );
      }
    }
    return await withWriteRun(
      ctx,
      root,
      {
        path: input.path,
        command: "conflicts ack",
        create: false,
        requireState: true,
        expectedRevision: state.stateRevision,
      },
      ({ store: locked, tx, previous, meta }): WriteBodyResult<ConflictsAckData> => {
        if (previous === null) throw new Error("withWriteRun requireState guarantees state.json");
        const doc = locked.readDocument(CONFLICTS_FILE, INTAKE_CONFLICTS_DOCUMENT);
        const again = ackBlocker(doc, input.id);
        if (again !== null) return { kind: "skip", result: again };
        if (doc === null) throw new Error("ackBlocker reports a missing conflicts.json");
        const outcome = acknowledgeConflict(doc, input.id, {
          by,
          at: meta.at,
          note,
          runId: meta.runId,
        });
        if (!outcome.ok) {
          return {
            kind: "skip",
            result: failure(ExitCode.Usage, makeFinding(outcome.code, "error", outcome.message)),
          };
        }
        const sha256 = tx.put(
          CONFLICTS_FILE,
          canonicalJson(
            parseVersionedDocument(outcome.doc, INTAKE_CONFLICTS_DOCUMENT, CONFLICTS_FILE),
          ),
        );
        const next = freshen(
          withArtifacts(
            recordCommand(previous, meta),
            [{ path: CONFLICTS_FILE, sha256 }],
            STALE_REASON,
          ),
          [CONFLICTS_FILE],
        );
        const data: ConflictsAckData = {
          conflict: outcome.conflict,
          stateRevision: next.stateRevision,
          unacknowledged: unacknowledgedCount(outcome.doc),
        };
        return {
          kind: "commit",
          state: next,
          data,
          findings: [],
          next: [`heron status ${input.path}`],
        };
      },
    );
  } catch (error) {
    const mapped = storeErrorResult<ConflictsAckData>(error);
    if (mapped === null) throw error;
    return mapped;
  }
}
