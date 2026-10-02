import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  bunProcessRunner,
  createProcessRunner,
  type RunnerHost,
} from "../../../src/agents/process/bun-runner.ts";
import type { ProcessOutcome, ProcessSpec } from "../../../src/agents/ports.ts";
import { fakeBinEnv, writeFakeAgentBin } from "../../helpers/agents.ts";

// Real child processes (shell scripts): spawn, SIGTERM/SIGKILL escalation and pipe cancellation take wall-clock time,
// so every case below carries an explicit 15 000 ms timeout, well above the 0.3-2 s each one needs.
const REAL_PROCESS_TIMEOUT = 15_000;
const root = realpathSync(mkdtempSync(join(tmpdir(), "heron-runner-")));
const binDir = join(root, "bin");
afterAll(() => rmSync(root, { recursive: true, force: true }));

const spec = (command: string, overrides: Partial<ProcessSpec> = {}): ProcessSpec => ({
  command,
  args: [],
  cwd: root,
  env: fakeBinEnv(binDir),
  stdin: null,
  timeoutMs: 5_000,
  killGraceMs: 400,
  maxOutputBytes: 1_000_000,
  captureStdout: true,
  ...overrides,
});
const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

describe("process runner", () => {
  test(
    "kills a hung agent at the configured timeout",
    async () => {
      // Covers: R4
      // the script ignores SIGTERM, forks a grandchild and records both pids: only the group SIGKILL ends them
      writeFakeAgentBin(
        binDir,
        "hung",
        'trap "" TERM\nsleep 60 &\necho "$$ $!" > "$PWD/pids"\nwait',
      );
      const cwd = realpathSync(mkdtempSync(join(root, "hung-")));
      const outcome = await bunProcessRunner.run(
        spec("hung", { cwd, timeoutMs: 2_000, killGraceMs: 300 }),
      );
      expect(outcome.kind).toBe("timeout");
      // P3.A3: 2 s configured -> timeout reported in <= 7 s (generous ceiling, robust to machine load)
      expect(outcome.kind === "timeout" ? outcome.durationMs : 0).toBeLessThan(7_000);
      const [child, grandchild] = readFileSync(join(cwd, "pids"), "utf8")
        .trim()
        .split(" ")
        .map(Number);
      await Bun.sleep(100);
      expect(alive(child ?? 0)).toBe(false);
      expect(alive(grandchild ?? 0)).toBe(false);
    },
    REAL_PROCESS_TIMEOUT,
  );

  test(
    "reports exit status, stdout and a bounded stderr tail",
    async () => {
      // Covers: R4
      writeFakeAgentBin(
        binDir,
        "chatty",
        'echo out\ni=0; while [ $i -lt 3000 ]; do echo "err-line-$i" >&2; i=$((i+1)); done\nexit 3',
      );
      const outcome = await bunProcessRunner.run(spec("chatty"));
      expect(outcome).toMatchObject({ kind: "exited", exitCode: 3, stdout: "out\n" });
      const tail = outcome.kind === "exited" ? outcome.stderrTail : "";
      expect(tail.length).toBeLessThanOrEqual(2_048);
      expect(tail).toContain("err-line-2999");
      expect(await bunProcessRunner.run(spec("missing-binary"))).toEqual({
        kind: "not-found",
        command: "missing-binary",
      });
    },
    REAL_PROCESS_TIMEOUT,
  );

  test(
    "passes stdin and only the given environment to the child",
    async () => {
      // Covers: R4
      writeFakeAgentBin(binDir, "echoenv", 'cat; echo "|${HERON_PARENT_ONLY:-unset}|$EXTRA"');
      process.env["HERON_PARENT_ONLY"] = "leaked";
      try {
        const outcome = await bunProcessRunner.run(
          spec("echoenv", { stdin: "hello", env: fakeBinEnv(binDir, { EXTRA: "given" }) }),
        );
        expect(outcome).toMatchObject({
          kind: "exited",
          exitCode: 0,
          stdout: "hello|unset|given\n",
        });
      } finally {
        delete process.env["HERON_PARENT_ONLY"];
      }
    },
    REAL_PROCESS_TIMEOUT,
  );

  test(
    "stops draining a child that floods stdout",
    async () => {
      // Covers: R4
      writeFakeAgentBin(binDir, "flood", "yes 0123456789");
      const outcome = await bunProcessRunner.run(spec("flood", { maxOutputBytes: 100_000 }));
      expect(outcome.kind).toBe("output-too-large");
      writeFakeAgentBin(binDir, "flood-silent", "yes 0123456789");
      const silent = await bunProcessRunner.run(
        spec("flood-silent", { maxOutputBytes: 100_000, captureStdout: false }),
      );
      expect(silent.kind).toBe("output-too-large");
    },
    REAL_PROCESS_TIMEOUT,
  );

  test(
    "kills the child when the line monitor returns stop, without leaking the line",
    async () => {
      // Covers: R4
      writeFakeAgentBin(binDir, "events", "echo ok\necho SECRET-LINE\nsleep 30");
      const seen: string[] = [];
      const outcome = await bunProcessRunner.run(
        spec("events", {
          captureStdout: false,
          onStdoutLine: (line) => {
            seen.push(line);
            return line === "ok" ? "continue" : { stop: "unknown-event" };
          },
        }),
      );
      expect(outcome).toMatchObject({ kind: "stopped", reason: "unknown-event" });
      expect(JSON.stringify(outcome)).not.toContain("SECRET-LINE");
      expect(seen).toEqual(["ok", "SECRET-LINE"]);
    },
    REAL_PROCESS_TIMEOUT,
  );

  test(
    "does not hang on a grandchild that keeps the pipes open after the child exits",
    async () => {
      // Covers: R4
      writeFakeAgentBin(binDir, "orphan", "sleep 15 &\necho done");
      const started = performance.now();
      const outcome = await bunProcessRunner.run(spec("orphan", { killGraceMs: 300 }));
      expect(outcome).toMatchObject({ kind: "exited", exitCode: 0, stdout: "done\n" });
      expect(performance.now() - started).toBeLessThan(7_000);
    },
    REAL_PROCESS_TIMEOUT,
  );

  test(
    "reports a child that closes stdin without reading as a failure",
    async () => {
      // Covers: R4
      writeFakeAgentBin(binDir, "deaf", "exec 0<&-\nsleep 1");
      const outcome: ProcessOutcome = await bunProcessRunner.run(
        spec("deaf", { stdin: "x".repeat(4_000_000), killGraceMs: 300 }),
      );
      expect(outcome.kind).toBe("exited");
      expect(outcome.kind === "exited" ? outcome.exitCode : 0).not.toBe(0);
    },
    REAL_PROCESS_TIMEOUT,
  );

  test(
    "kills the group, removes its handlers and re-emits a parent signal",
    async () => {
      // Covers: R4
      const listeners = new Map<string, () => void>();
      const reemitted: string[] = [];
      const host: RunnerHost = {
        on: (signal, handler) => void listeners.set(signal, handler),
        off: (signal) => void listeners.delete(signal),
        reemit: (signal) => void reemitted.push(signal),
      };
      writeFakeAgentBin(binDir, "sleeper", "sleep 60");
      const running = createProcessRunner(host).run(spec("sleeper", { timeoutMs: 10_000 }));
      await Bun.sleep(300);
      expect([...listeners.keys()].toSorted()).toEqual(["SIGINT", "SIGTERM"]);
      listeners.get("SIGINT")?.();
      expect(listeners.size).toBe(0);
      expect(reemitted).toEqual(["SIGINT"]);
      const outcome = await running;
      expect(outcome).toMatchObject({ kind: "exited", signal: "SIGKILL" });
    },
    REAL_PROCESS_TIMEOUT,
  );

  test(
    "leaves no signal listeners behind after a run",
    async () => {
      // Covers: R4
      const before = [process.listenerCount("SIGINT"), process.listenerCount("SIGTERM")];
      writeFakeAgentBin(binDir, "quick", "exit 0");
      writeFakeAgentBin(binDir, "hung", "sleep 60");
      await bunProcessRunner.run(spec("quick"));
      await bunProcessRunner.run(spec("hung", { timeoutMs: 1_000, killGraceMs: 200 }));
      expect([process.listenerCount("SIGINT"), process.listenerCount("SIGTERM")]).toEqual(before);
    },
    REAL_PROCESS_TIMEOUT,
  );
});
