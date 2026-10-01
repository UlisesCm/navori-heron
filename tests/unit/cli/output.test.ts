// Covers: R2
import { describe, expect, test } from "bun:test";
import { failure, makeFinding, type UseCaseResult } from "../../../src/app/result.ts";
import {
  CliEnvelopeSchema,
  ExitCode,
  type DoctorData,
  type Finding,
  type GateData,
  type RunId,
} from "../../../src/core/contracts/index.ts";
import type { CliIo } from "../../../src/cli/io.ts";
import { emitResult, splitNotices, type EmitOptions } from "../../../src/cli/output.ts";

const RUN_ID: RunId = "run-20260930T120000Z-00000001";

function capture(): { io: CliIo; out: () => { stdout: string; stderr: string } } {
  let stdout = "";
  let stderr = "";
  const io: CliIo = {
    stdout: (text) => void (stdout += text),
    stderr: (text) => void (stderr += text),
    isTTY: false,
    readLine: async () => null,
  };
  return { io, out: () => ({ stdout, stderr }) };
}

const GATE: GateData = {
  gate: "intake",
  decision: "rejected",
  from: "initialized",
  to: "initialized",
  stateRevision: 2,
  artifacts: [],
};
const DOCTOR: DoctorData = { checks: [] };
const NOTICE: Finding = makeFinding("STAGING_RECOVERED", "info", "Removed orphan staging.");
const WARNING: Finding = makeFinding("LOCK_RECLAIMED", "warning", "Reclaimed a stale lock.");

const render = (): string => "report";

function options<D>(
  over: Partial<EmitOptions<D>> & Pick<EmitOptions<D>, "render">,
): EmitOptions<D> {
  return { command: "gate", json: false, started: performance.now(), runId: RUN_ID, ...over };
}

describe("emitResult", () => {
  test("emits one envelope in json mode and routes text to stdout or stderr", () => {
    const ok: UseCaseResult<GateData> = {
      ok: true,
      data: GATE,
      findings: [NOTICE],
      next: ["heron status"],
    };
    const failed = failure<GateData>(
      ExitCode.Blocked,
      makeFinding("PRECONDITION_UNMET", "error", "no"),
    );

    // --json: exactly one envelope line on stdout, nothing on stderr, for success and failure alike.
    for (const [result, code] of [
      [ok, 0],
      [failed, 3],
    ] as const) {
      const json = capture();
      expect(emitResult(json.io, options({ json: true, render: () => "ignored" }), result)).toBe(
        code,
      );
      const { stdout, stderr } = json.out();
      expect(stderr).toBe("");
      expect(stdout.endsWith("\n") && stdout.indexOf("\n") === stdout.length - 1).toBe(true);
      const envelope = CliEnvelopeSchema.parse(JSON.parse(stdout));
      expect(envelope).toMatchObject({ command: "gate", ok: code === 0, code, runId: RUN_ID });
    }

    // Text, ok: a string goes to stdout only; a TextOutput routes each stream and skips the empty one.
    const text = capture();
    expect(emitResult(text.io, options({ render: () => "done" }), ok)).toBe(0);
    expect(text.out()).toEqual({ stdout: "done\n", stderr: "" });
    const split = capture();
    emitResult(split.io, options({ render: () => ({ stdout: "body", stderr: "notice" }) }), ok);
    expect(split.out()).toEqual({ stdout: "body\n", stderr: "notice\n" });
    const quiet = capture();
    emitResult(quiet.io, options({ render: () => ({ stdout: "", stderr: "" }) }), ok);
    expect(quiet.out()).toEqual({ stdout: "", stderr: "" });

    // Text, failure: the message goes to stderr and the code is returned.
    const bad = capture();
    expect(emitResult(bad.io, options({ render: () => "never" }), failed)).toBe(3);
    expect(bad.out()).toEqual({ stdout: "", stderr: "no\n" });
  });

  test("renders the data of a failed result only when renderFailedData is set", () => {
    const withData: UseCaseResult<DoctorData> = {
      ok: false,
      code: ExitCode.DependencyUnavailable,
      message: "a check failed",
      findings: [],
      data: DOCTOR,
    };
    const on = capture();
    expect(
      emitResult(on.io, options({ command: "doctor", render, renderFailedData: true }), withData),
    ).toBe(5);
    expect(on.out()).toEqual({ stdout: "report\n", stderr: "" });
    const off = capture();
    emitResult(off.io, options({ command: "doctor", render }), withData);
    expect(off.out()).toEqual({ stdout: "", stderr: "a check failed\n" });
    const noData = capture();
    emitResult(
      noData.io,
      options({ command: "doctor", render, renderFailedData: true }),
      failure<DoctorData>(ExitCode.Blocked, makeFinding("UNEXPECTED_ERROR", "error", "no data")),
    );
    expect(noData.out()).toEqual({ stdout: "", stderr: "no data\n" });
  });

  test("splitNotices separates the app-only findings", () => {
    const other = makeFinding("PRECONDITION_UNMET", "error", "x");
    expect(splitNotices([WARNING, other, NOTICE])).toEqual({
      notices: [WARNING, NOTICE],
      rest: [other],
    });
  });
});
