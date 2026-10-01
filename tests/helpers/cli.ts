import { DEFAULT_LOCK_OPTIONS, defaultIsProcessAlive } from "../../src/core/store/lock.ts";
import { nodeFs } from "../../src/core/store/fs-port.ts";
import { DEFAULT_INPUT_LIMITS } from "../../src/intake/ports.ts";
import type { AppContext } from "../../src/app/context.ts";
import { HERON_VERSION } from "../../src/app/version.ts";
import type { ExitCode, RunId } from "../../src/core/contracts/index.ts";
import { runCli } from "../../src/cli/main.ts";

export type CapturedRun = { code: ExitCode; stdout: string; stderr: string };

/** Fixed clock (2026-09-30T12:00:00.000Z unless given), sequential run ids, identity "tester", isTTY false,
 * confirm resolving to `confirmAnswer`, lock.isProcessAlive overridable. */
export function fixedContext(
  overrides: Partial<AppContext> & { confirmAnswer?: boolean } = {},
): AppContext {
  const { confirmAnswer = false, ...rest } = overrides;
  let counter = 0;
  const context: AppContext = {
    fs: nodeFs,
    clock: { now: () => new Date("2026-09-30T12:00:00.000Z") },
    ids: {
      runId: (): RunId => {
        counter += 1;
        return `run-20260930T120000Z-${counter.toString(16).padStart(8, "0")}`;
      },
    },
    identity: { current: () => "tester" },
    process: { pid: process.pid, hostname: "test-host", bunVersion: process.versions.bun ?? null },
    heronVersion: HERON_VERSION,
    isTTY: false,
    confirm: async () => confirmAnswer,
    lock: { ...DEFAULT_LOCK_OPTIONS, isProcessAlive: defaultIsProcessAlive },
    limits: DEFAULT_INPUT_LIMITS,
  };
  return { ...context, ...rest };
}

export async function runCliCaptured(
  argv: readonly string[],
  ctx: AppContext = fixedContext(),
): Promise<CapturedRun> {
  let stdout = "";
  let stderr = "";
  const code = await runCli(
    argv,
    {
      stdout: (text) => void (stdout += text),
      stderr: (text) => void (stderr += text),
      isTTY: ctx.isTTY,
      readLine: async () => null,
    },
    ctx,
  );
  return { code, stdout, stderr };
}
