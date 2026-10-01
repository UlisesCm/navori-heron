import type { UseCaseResult } from "../app/result.ts";
import {
  ExitCode,
  type CliCommand,
  type CliEnvelope,
  type Finding,
  type RunId,
} from "../core/contracts/index.ts";
import { buildEnvelope } from "./envelope.ts";
import type { CliIo } from "./io.ts";

/** "" = nothing is written to that stream. */
export type TextOutput = { stdout: string; stderr: string };

export type EmitOptions<D> = {
  command: CliCommand | "unknown";
  json: boolean;
  /** performance.now() when the handler started. */
  started: number;
  runId: RunId;
  /** A plain string goes to stdout only. */
  render: (data: D, findings: readonly Finding[]) => string | TextOutput;
  /** doctor: a failed result that carries data renders it to stdout instead of the message. */
  renderFailedData?: boolean;
};

const NOTICE_CODES: readonly string[] = ["LOCK_RECLAIMED", "STAGING_RECOVERED"];

/** Splits LOCK_RECLAIMED and STAGING_RECOVERED (rendered to stderr) from the rest (the stdout block). */
export function splitNotices(findings: readonly Finding[]): {
  notices: Finding[];
  rest: Finding[];
} {
  return {
    notices: findings.filter((finding) => NOTICE_CODES.includes(finding.code)),
    rest: findings.filter((finding) => !NOTICE_CODES.includes(finding.code)),
  };
}

function writeText(io: CliIo, rendered: string | TextOutput, code: ExitCode): ExitCode {
  const { stdout, stderr } =
    typeof rendered === "string" ? { stdout: rendered, stderr: "" } : rendered;
  if (stdout !== "") io.stdout(`${stdout}\n`);
  if (stderr !== "") io.stderr(`${stderr}\n`);
  return code;
}

/**
 * The only place that writes command results to CliIo (R2). `--json`: exactly one CliEnvelope + "\n" on stdout.
 * Text: ok renders the output (each non-empty stream terminated by "\n"); a failure writes `${message}\n` to stderr,
 * or renders its data to stdout when `renderFailedData` is set and the result carries data.
 * Returns 0 when ok, else the result code.
 */
export function emitResult<D extends CliEnvelope["data"]>(
  io: CliIo,
  options: EmitOptions<D>,
  result: UseCaseResult<D>,
): ExitCode {
  const code = result.ok ? ExitCode.Ok : result.code;
  if (options.json) {
    const durationMs = Math.round(performance.now() - options.started);
    const envelope = buildEnvelope({
      command: options.command,
      result,
      runId: options.runId,
      durationMs,
    });
    io.stdout(`${JSON.stringify(envelope)}\n`);
    return code;
  }
  if (result.ok) return writeText(io, options.render(result.data, result.findings), code);
  if (options.renderFailedData === true && result.data !== null) {
    return writeText(io, options.render(result.data, result.findings), code);
  }
  io.stderr(`${result.message}\n`);
  return code;
}
