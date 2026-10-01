import {
  ExitCode,
  type CliCommand,
  type CliEnvelope,
  type RunId,
} from "../core/contracts/index.ts";
import type { UseCaseResult } from "../app/result.ts";

export type EnvelopeInput<T> = {
  command: CliCommand | "unknown";
  result: UseCaseResult<T>;
  runId: RunId;
  durationMs: number;
};

/** `--json` output: one envelope per command; `ok` is true iff the exit code is 0. */
export function buildEnvelope<T extends CliEnvelope["data"]>(input: EnvelopeInput<T>): CliEnvelope {
  const { command, result, runId, durationMs } = input;
  const base = { kind: "CliEnvelope", schemaVersion: 1, command, runId, durationMs } as const;
  if (result.ok) {
    return {
      ...base,
      ok: true,
      code: ExitCode.Ok,
      data: result.data,
      findings: result.findings,
      next: result.next,
    };
  }
  return {
    ...base,
    ok: false,
    code: result.code,
    data: result.data,
    findings: result.findings,
    next: [],
  };
}
