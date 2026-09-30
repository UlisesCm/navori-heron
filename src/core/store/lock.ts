import { join } from "node:path";
import {
  IsoDateTimeSchema,
  RunIdSchema,
  canonicalJson,
  type IsoDateTime,
  type RunId,
} from "../contracts/index.ts";
import { errorCode, type FsPort, type ReadonlyFs } from "./fs-port.ts";

const LOCK_NAME = ".lock";
const RECLAIM_NAME = ".lock.reclaim";

export type LockOwner = {
  runId: RunId;
  pid: number;
  hostname: string;
  command: string;
  acquiredAt: IsoDateTime;
};

export type LockOptions = {
  staleAfterMs: number; // other host only; default 3_600_000
  corruptGraceMs: number; // unreadable lock or orphan .lock.reclaim; default 30_000
  hostname: string;
  now: () => number;
  isProcessAlive: (pid: number) => boolean;
};

export const DEFAULT_LOCK_OPTIONS: Omit<LockOptions, "hostname" | "now" | "isProcessAlive"> = {
  staleAfterMs: 3_600_000,
  corruptGraceMs: 30_000,
};

/** process.kill(pid, 0): only ESRCH means dead; EPERM or success mean alive (safe side). */
export function defaultIsProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return errorCode(error) !== "ESRCH";
  }
}

export interface LockHandle {
  readonly path: string;
  readonly owner: LockOwner;
  release(): void;
}
export type AcquiredLock = { handle: LockHandle; reclaimed: LockOwner | null };

export class LockBusyError extends Error {
  readonly holder: LockOwner | null;
  constructor(holder: LockOwner | null) {
    super(
      holder
        ? `another Heron command holds the lock (pid ${holder.pid} on ${holder.hostname}, run ${holder.runId}, since ${holder.acquiredAt})`
        : "another Heron command holds the lock (owner unreadable)",
    );
    this.name = "LockBusyError";
    this.holder = holder;
  }
}

function parseOwner(text: string): LockOwner | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof raw !== "object" || raw === null) return null;
  const o = raw as Record<string, unknown>;
  const runId = RunIdSchema.safeParse(o["runId"]);
  const at = IsoDateTimeSchema.safeParse(o["acquiredAt"]);
  const pid = o["pid"];
  const hostname = o["hostname"];
  const command = o["command"];
  if (
    !runId.success ||
    !at.success ||
    typeof pid !== "number" ||
    !Number.isInteger(pid) ||
    typeof hostname !== "string" ||
    typeof command !== "string"
  ) {
    return null;
  }
  return { runId: runId.data, pid, hostname, command, acquiredAt: at.data };
}

/** null when the lock is absent or unreadable. */
export function readLockOwner(fs: ReadonlyFs, heronDir: string): LockOwner | null {
  try {
    return parseOwner(new TextDecoder().decode(fs.readFileSync(join(heronDir, LOCK_NAME))));
  } catch {
    return null;
  }
}

/** Stale when: unreadable and older than corruptGraceMs; same host and dead pid; other host and older than staleAfterMs. */
export function isLockStale(
  owner: LockOwner | null,
  lockMtimeMs: number,
  options: LockOptions,
): boolean {
  if (owner === null) return options.now() - lockMtimeMs > options.corruptGraceMs;
  if (owner.hostname === options.hostname) return !options.isProcessAlive(owner.pid);
  const acquired = Date.parse(owner.acquiredAt);
  return options.now() - acquired > options.staleAfterMs;
}

function tryCreate(fs: FsPort, path: string, content: string): boolean {
  let fd: number;
  try {
    fd = fs.openSync(path, "wx");
  } catch (error) {
    if (errorCode(error) === "EEXIST") return false;
    throw error;
  }
  try {
    fs.writeSync(fd, new TextEncoder().encode(content));
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  return true;
}

function mtimeOf(fs: FsPort, path: string): number | null {
  try {
    return fs.lstatSync(path).mtimeMs;
  } catch {
    return null;
  }
}

function makeHandle(fs: FsPort, heronDir: string, owner: LockOwner): LockHandle {
  const path = join(heronDir, LOCK_NAME);
  return {
    path,
    owner,
    release(): void {
      if (readLockOwner(fs, heronDir)?.runId !== owner.runId) return; // never delete someone else's lock
      try {
        fs.unlinkSync(path);
      } catch (error) {
        if (errorCode(error) !== "ENOENT") throw error;
      }
    },
  };
}

/** Never waits. Throws LockBusyError when held and not stale (DP5). */
export function acquireLock(
  fs: FsPort,
  heronDir: string,
  owner: LockOwner,
  options: LockOptions,
): AcquiredLock {
  const lockPath = join(heronDir, LOCK_NAME);
  const reclaimPath = join(heronDir, RECLAIM_NAME);
  const content = canonicalJson(owner);
  const acquired = (reclaimed: LockOwner | null): AcquiredLock => ({
    handle: makeHandle(fs, heronDir, owner),
    reclaimed,
  });

  if (tryCreate(fs, lockPath, content)) return acquired(null);

  const holder = readLockOwner(fs, heronDir);
  const mtime = mtimeOf(fs, lockPath);
  if (mtime === null) {
    // Released between open and stat: one more attempt, then busy.
    if (tryCreate(fs, lockPath, content)) return acquired(null);
    throw new LockBusyError(readLockOwner(fs, heronDir));
  }
  if (!isLockStale(holder, mtime, options)) throw new LockBusyError(holder);

  // Reclaim under the .lock.reclaim mutex.
  if (!tryCreate(fs, reclaimPath, content)) {
    const reclaimMtime = mtimeOf(fs, reclaimPath);
    if (reclaimMtime === null || options.now() - reclaimMtime <= options.corruptGraceMs) {
      throw new LockBusyError(holder);
    }
    fs.unlinkSync(reclaimPath); // orphan mutex from a crashed reclaimer
    if (!tryCreate(fs, reclaimPath, content)) throw new LockBusyError(holder);
  }
  try {
    const again = readLockOwner(fs, heronDir);
    const againMtime = mtimeOf(fs, lockPath);
    const sameHolder = again?.runId === holder?.runId;
    if (againMtime === null || !sameHolder || !isLockStale(again, againMtime, options)) {
      throw new LockBusyError(again);
    }
    fs.unlinkSync(lockPath);
    // Created while the mutex is still held (strictly safer than the DP5 order).
    if (!tryCreate(fs, lockPath, content)) throw new LockBusyError(readLockOwner(fs, heronDir));
    return acquired(holder);
  } finally {
    try {
      fs.unlinkSync(reclaimPath);
    } catch {
      // mutex already gone
    }
  }
}
