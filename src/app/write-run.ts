import { HERON_STATE_DOCUMENT, type Finding, type HeronState } from "../core/contracts/index.ts";
import type { TransitionMeta } from "../core/state/transitions.ts";
import {
  STATE_FILE,
  StateRevisionConflictError,
  openFileStore,
  type FileStore,
  type StoreTransaction,
} from "../core/store/file-store.ts";
import { acquireLock } from "../core/store/lock.ts";
import type { AppContext } from "./context.ts";
import { makeFinding, notInitialized, storeErrorResult, type UseCaseResult } from "./result.ts";

export type WriteRunOptions = {
  /** User-supplied path, only for messages ("Run: heron init {path}"). */
  path: string;
  /** LockOwner.command and HistoryEntry.command, e.g. "references add". */
  command: string;
  /** openFileStore({ create }); true only for init. */
  create: boolean;
  /** False only for init; true -> NOT_INITIALIZED (exit 3) when state.json is absent. */
  requireState: boolean;
  /** Snapshot revision R taken before a long step; null = whatever is on disk. */
  expectedRevision: number | null;
};

export type WriteRun = {
  readonly store: FileStore;
  /** Begun with meta.runId; committed or aborted only by withWriteRun. */
  readonly tx: StoreTransaction;
  /** state.json read under the lock; null only when requireState is false. */
  readonly previous: HeronState | null;
  /** { runId, at: ctx.clock.now() taken once, command, heronVersion }. */
  readonly meta: TransitionMeta;
};

export type WriteBodyResult<T> =
  | { kind: "commit"; state: HeronState; data: T; findings: Finding[]; next: string[] }
  /** Failure or no-op: staging is discarded and nothing is written. */
  | { kind: "skip"; result: UseCaseResult<T> };

/**
 * The single envelope for every use case that writes `.heron/` (R1).
 *
 * openFileStore -> (requireState and no state.json: NOT_INITIALIZED, exit 3, before locking) -> acquireLock (never
 * waits; busy -> exit 6) -> recoverOrphanStaging -> read state.json -> expectedRevision differs: exit 6 -> begin ->
 * body (synchronous: store reads, tx writes, pure core/state) -> commit | abort -> release in `finally`.
 * A throw in the body aborts the transaction and releases the lock; store and document errors are mapped once with
 * storeErrorResult, anything else is rethrown. LOCK_RECLAIMED (warning) and STAGING_RECOVERED (info) are appended,
 * in that order, to the findings of the returned result, ok or not.
 */
export async function withWriteRun<T>(
  ctx: AppContext,
  root: string,
  options: WriteRunOptions,
  body: (run: WriteRun) => WriteBodyResult<T>,
): Promise<UseCaseResult<T>> {
  const notices: Finding[] = [];
  let result: UseCaseResult<T>;
  try {
    result = execute(ctx, root, options, body, notices);
  } catch (error) {
    const mapped = storeErrorResult<T>(error);
    if (mapped === null) throw error;
    result = mapped;
  }
  return notices.length === 0 ? result : { ...result, findings: [...result.findings, ...notices] };
}

function execute<T>(
  ctx: AppContext,
  root: string,
  options: WriteRunOptions,
  body: (run: WriteRun) => WriteBodyResult<T>,
  notices: Finding[],
): UseCaseResult<T> {
  const now = ctx.clock.now();
  const runId = ctx.ids.runId(now);
  const store = openFileStore(ctx.fs, root, { create: options.create });
  if (options.requireState && store.readDocument(STATE_FILE, HERON_STATE_DOCUMENT) === null) {
    return notInitialized(options.path);
  }
  const acquired = acquireLock(
    ctx.fs,
    store.heronDir,
    {
      runId,
      pid: ctx.process.pid,
      hostname: ctx.process.hostname,
      command: options.command,
      acquiredAt: now.toISOString(),
    },
    { ...ctx.lock, hostname: ctx.process.hostname, now: () => Date.now() },
  );
  try {
    if (acquired.reclaimed !== null) {
      const { pid, hostname, runId: staleRun } = acquired.reclaimed;
      notices.push(
        makeFinding(
          "LOCK_RECLAIMED",
          "warning",
          `Reclaimed a stale lock from pid ${pid} on ${hostname} (run ${staleRun}).`,
        ),
      );
    }
    const recovered = store.recoverOrphanStaging(runId);
    if (recovered.length > 0) {
      notices.push(
        makeFinding(
          "STAGING_RECOVERED",
          "info",
          `Removed orphan staging from interrupted run(s): ${recovered.join(", ")}.`,
        ),
      );
    }
    const previous = store.readDocument(STATE_FILE, HERON_STATE_DOCUMENT);
    if (options.requireState && previous === null) return notInitialized(options.path);
    const found = previous?.stateRevision ?? 0;
    if (options.expectedRevision !== null && found !== options.expectedRevision) {
      throw new StateRevisionConflictError(options.expectedRevision, found);
    }

    const tx = store.begin(runId);
    try {
      const meta: TransitionMeta = {
        runId,
        at: now.toISOString(),
        command: options.command,
        heronVersion: ctx.heronVersion,
      };
      const outcome = body({ store, tx, previous, meta });
      if (outcome.kind === "skip") {
        tx.abort();
        return outcome.result;
      }
      tx.commit(outcome.state, found);
      return { ok: true, data: outcome.data, findings: outcome.findings, next: outcome.next };
    } catch (error) {
      tx.abort();
      throw error;
    }
  } finally {
    acquired.handle.release();
  }
}
