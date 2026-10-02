import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ProcessOutcome, ProcessRunner, ProcessSpec } from "../../src/agents/ports.ts";

/** Writes an executable POSIX shell script `<dir>/<name>` (a fake agent CLI) and returns its path. */
export function writeFakeAgentBin(dir: string, name: string, body: string): string {
  mkdirSync(dir, { recursive: true });
  const path = join(dir, name);
  writeFileSync(path, `#!/bin/sh\n${body}\n`);
  chmodSync(path, 0o755);
  return path;
}

/** The child environment for a fake-bin run: only `binDir` and the system tools on PATH, no parent variables. */
export function fakeBinEnv(
  binDir: string,
  extra: Record<string, string> = {},
): Record<string, string> {
  return { PATH: `${binDir}:/usr/bin:/bin`, HOME: binDir, ...extra };
}

/** What `fixedContext` injects (DR30): any attempt to launch a real agent CLI fails the test. */
export const refusingRunner: ProcessRunner = {
  run(spec: ProcessSpec): Promise<ProcessOutcome> {
    throw new Error(`refusingRunner: tests must not spawn ${spec.command}`);
  },
};
