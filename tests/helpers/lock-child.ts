// Test-only stand-in for `bun bin/heron.ts` (arrives in T10): acquires the lock like a second writer
// and exits with the store's exit code (LockBusy -> 6).
import { ExitCode } from "../../src/core/contracts/index.ts";
import { nodeFs } from "../../src/core/store/fs-port.ts";
import {
  DEFAULT_LOCK_OPTIONS,
  LockBusyError,
  acquireLock,
  defaultIsProcessAlive,
} from "../../src/core/store/lock.ts";
import { hostname } from "node:os";

const heronDir = process.argv[2];
if (heronDir === undefined) process.exit(ExitCode.Usage);
try {
  const { handle } = acquireLock(
    nodeFs,
    heronDir,
    {
      runId: "run-20260930T120001Z-aaaaaaaa",
      pid: process.pid,
      hostname: hostname(),
      command: "init",
      acquiredAt: new Date().toISOString(),
    },
    {
      ...DEFAULT_LOCK_OPTIONS,
      hostname: hostname(),
      now: () => Date.now(),
      isProcessAlive: defaultIsProcessAlive,
    },
  );
  handle.release();
  process.exit(ExitCode.Ok);
} catch (error) {
  process.exit(error instanceof LockBusyError ? ExitCode.LockBusy : ExitCode.Unexpected);
}
