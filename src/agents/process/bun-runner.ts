import type { LineVerdict, ProcessOutcome, ProcessRunner, ProcessSpec } from "../ports.ts";

/** The only file with `Bun.spawn`, `Bun.which` and `process.on|off|once` (boundary table, DR5). */

const STDERR_TAIL_BYTES = 2_048;
const PARENT_SIGNALS = ["SIGINT", "SIGTERM"] as const;
type ParentSignal = (typeof PARENT_SIGNALS)[number];

/** Seams for the parent-signal handling; the real ones are `process` and `process.kill(process.pid, …)`. */
export type RunnerHost = {
  on(signal: ParentSignal, handler: () => void): void;
  off(signal: ParentSignal, handler: () => void): void;
  /** Re-emits the signal at Heron itself once the child group is dead and the handlers are removed. */
  reemit(signal: ParentSignal): void;
};

const processHost: RunnerHost = {
  on: (signal, handler) => void process.on(signal, handler),
  off: (signal, handler) => void process.off(signal, handler),
  reemit: (signal) => void process.kill(process.pid, signal),
};

const sleep = (ms: number): { promise: Promise<void>; cancel: () => void } => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const promise = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, ms);
  });
  return { promise, cancel: () => clearTimeout(timer) };
};

type StopReason = { kind: "timeout" } | { kind: "stopped"; token: string } | { kind: "too-large" };

/** SIGTERM/SIGKILL to the whole group, never after the child exited (pid reuse); ESRCH is "already dead". */
function killGroup(proc: Bun.Subprocess, signal: "SIGTERM" | "SIGKILL"): void {
  if (proc.exitCode !== null || proc.signalCode !== null) return;
  try {
    process.kill(-proc.pid, signal);
  } catch {
    // ESRCH or EPERM: nothing left to kill from here
  }
}

/** Reads a pipe to the end (or until cancelled), handing every chunk to `onChunk`. */
async function drain(
  stream: ReadableStream<Uint8Array>,
  readers: { cancel(): Promise<void> }[],
  onChunk: (chunk: Uint8Array) => void,
): Promise<void> {
  const reader = stream.getReader();
  readers.push(reader);
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      onChunk(value);
    }
  } catch {
    // cancelled or broken pipe: whatever arrived stays
  }
}

function join(chunks: readonly Uint8Array[], total: number): Uint8Array {
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

/** Builds a runner; tests inject the signal host, production uses `bunProcessRunner`. */
export function createProcessRunner(host: RunnerHost = processHost): ProcessRunner {
  return {
    async run(spec: ProcessSpec): Promise<ProcessOutcome> {
      const started = performance.now();
      const elapsed = (): number => Math.round(performance.now() - started);
      const resolved = Bun.which(spec.command, { PATH: spec.env["PATH"] ?? "", cwd: spec.cwd });
      if (resolved === null) return { kind: "not-found", command: spec.command };

      let proc: Bun.Subprocess<"pipe", "pipe", "pipe">;
      try {
        proc = Bun.spawn([resolved, ...spec.args], {
          cwd: spec.cwd,
          env: { ...spec.env },
          stdin: "pipe",
          stdout: "pipe",
          stderr: "pipe",
          detached: true,
        });
      } catch (error) {
        const code = (error as { code?: unknown }).code;
        if (code === "ENOENT") return { kind: "not-found", command: spec.command };
        const message = error instanceof Error ? error.message : "spawn failed";
        return {
          kind: "exited",
          exitCode: null,
          signal: null,
          stdout: "",
          stderrTail: `spawn failed: ${message}`.slice(-STDERR_TAIL_BYTES),
          durationMs: elapsed(),
        };
      }

      const state: { reason: StopReason | null; stdinFailed: string | null } = {
        reason: null,
        stdinFailed: null,
      };
      let killTimer: ReturnType<typeof setTimeout> | undefined;
      let timeoutTimer: ReturnType<typeof setTimeout> | undefined;
      let giveUpTimer: ReturnType<typeof setTimeout> | undefined;
      const giveUp = Promise.withResolvers<void>();

      /** First reason wins; SIGTERM now, SIGKILL after the grace period, give up on the exit wait after twice that. */
      const terminate = (why: StopReason): void => {
        if (state.reason !== null) return;
        state.reason = why;
        killGroup(proc, "SIGTERM");
        killTimer = setTimeout(() => killGroup(proc, "SIGKILL"), spec.killGraceMs);
        giveUpTimer = setTimeout(giveUp.resolve, spec.killGraceMs * 2);
      };

      const handlers: Record<ParentSignal, () => void> = {
        SIGINT: () => onParentSignal("SIGINT"),
        SIGTERM: () => onParentSignal("SIGTERM"),
      };
      /** Kills the group, removes both handlers (no leak) and re-emits the signal so Heron ends with its conventional status. */
      const onParentSignal = (signal: ParentSignal): void => {
        for (const name of PARENT_SIGNALS) host.off(name, handlers[name]);
        killGroup(proc, "SIGKILL");
        host.reemit(signal);
      };
      for (const name of PARENT_SIGNALS) host.on(name, handlers[name]);

      const readers: { cancel(): Promise<void> }[] = [];
      try {
        timeoutTimer = setTimeout(() => terminate({ kind: "timeout" }), spec.timeoutMs);

        // stdin goes concurrently: a child that never reads must not block the exit wait
        const stdinDone = (async (): Promise<void> => {
          try {
            if (spec.stdin !== null) proc.stdin.write(spec.stdin);
            await proc.stdin.end();
          } catch (error) {
            state.stdinFailed =
              (error as { code?: unknown }).code === "EPIPE" ? "EPIPE" : "write error";
          }
        })();

        const decoder = new TextDecoder();
        const stdoutChunks: Uint8Array[] = [];
        let stdoutTotal = 0;
        let received = 0;
        let pending = "";
        let monitor = spec.onStdoutLine;
        const feedLines = (text: string, flush: boolean): void => {
          if (monitor === undefined || state.reason !== null) return;
          const parts = (pending + text).split("\n");
          pending = parts.pop() ?? "";
          if (flush && pending !== "") {
            parts.push(pending);
            pending = "";
          }
          for (const line of parts) {
            const verdict: LineVerdict = monitor(line);
            if (verdict !== "continue") {
              monitor = undefined;
              terminate({ kind: "stopped", token: verdict.stop });
              return;
            }
          }
        };
        const stdoutDone = drain(proc.stdout, readers, (chunk) => {
          received += chunk.byteLength;
          if (received > spec.maxOutputBytes) return terminate({ kind: "too-large" });
          if (state.reason !== null) return;
          if (spec.captureStdout) {
            stdoutChunks.push(chunk);
            stdoutTotal += chunk.byteLength;
          }
          feedLines(decoder.decode(chunk, { stream: true }), false);
        });

        let tail: Uint8Array = new Uint8Array(0);
        const stderrDone = drain(proc.stderr, readers, (chunk) => {
          tail = join([tail, chunk], tail.byteLength + chunk.byteLength).slice(-STDERR_TAIL_BYTES);
        });

        // the child exits, or (SIGKILL ignored: not expected) the give-up timer ends the wait
        await Promise.race([proc.exited, giveUp.promise]);

        // bounded drain: a grandchild that keeps the pipes open must not hang Heron
        const grace = sleep(spec.killGraceMs);
        await Promise.race([Promise.all([stdoutDone, stderrDone, stdinDone]), grace.promise]);
        grace.cancel();
        for (const reader of readers) void reader.cancel().catch(() => undefined);

        feedLines(decoder.decode(), true);
        const stderrTail = new TextDecoder().decode(tail);
        const { reason, stdinFailed } = state;
        if (reason?.kind === "timeout")
          return { kind: "timeout", stderrTail, durationMs: elapsed() };
        if (reason?.kind === "stopped") {
          return { kind: "stopped", reason: reason.token, durationMs: elapsed() };
        }
        if (reason?.kind === "too-large")
          return { kind: "output-too-large", durationMs: elapsed() };
        const code = proc.exitCode;
        return {
          kind: "exited",
          exitCode: stdinFailed !== null && code === 0 ? 1 : code,
          signal: proc.signalCode,
          stdout: spec.captureStdout
            ? new TextDecoder().decode(join(stdoutChunks, stdoutTotal))
            : "",
          stderrTail: (stdinFailed === null
            ? stderrTail
            : `stdin ${stdinFailed}: ${stderrTail}`
          ).slice(-STDERR_TAIL_BYTES),
          durationMs: elapsed(),
        };
      } finally {
        clearTimeout(timeoutTimer);
        clearTimeout(killTimer);
        clearTimeout(giveUpTimer);
        for (const name of PARENT_SIGNALS) host.off(name, handlers[name]);
      }
    },
  };
}

export const bunProcessRunner: ProcessRunner = createProcessRunner();
