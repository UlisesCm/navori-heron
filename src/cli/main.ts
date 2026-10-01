import type { AppContext } from "../app/context.ts";
import { createDefaultContext } from "../app/context.ts";
import { failure } from "../app/result.ts";
import { HERON_VERSION } from "../app/version.ts";
import { ExitCode, type CliCommand, type Finding } from "../core/contracts/index.ts";
import { USAGE_TEXT, commandFor, parseCliArgs } from "./args.ts";
import { UsageError } from "./command.ts";
import type { CliIo } from "./io.ts";
import { emitResult } from "./output.ts";

function errorFinding(code: Finding["code"], message: string): Finding {
  return { code, severity: "error", message, paths: [], issues: [] };
}

/** Text mode: result to stdout, failures to stderr. --json: exactly one CliEnvelope + "\n" to stdout, nothing else.
 * Every output goes through emitResult. Unexpected exception -> exit 1, UNEXPECTED_ERROR (stack only when
 * HERON_DEBUG=1). */
export async function runCli(
  argv: readonly string[],
  io: CliIo,
  ctx: AppContext = createDefaultContext(io),
): Promise<ExitCode> {
  const started = performance.now();
  const parsed = parseCliArgs(argv);
  // One run id per invocation: the use case and the envelope report the same one.
  const runId = ctx.ids.runId(ctx.clock.now());
  const scoped: AppContext = { ...ctx, ids: { runId: () => runId } };

  const fail = (
    command: CliCommand | "unknown",
    code: Exclude<ExitCode, 0>,
    finding: Finding,
    message: string,
    json: boolean,
  ): ExitCode =>
    emitResult(
      io,
      { command, json, started, runId, render: () => "" },
      failure<null>(code, finding, message),
    );

  if (parsed instanceof UsageError) {
    return fail(
      "unknown",
      ExitCode.Usage,
      errorFinding("USAGE", parsed.message),
      `${parsed.message}\n\n${USAGE_TEXT}`.trimEnd(),
      parsed.json,
    );
  }
  if (parsed.command === "help") {
    io.stdout(USAGE_TEXT);
    return ExitCode.Ok;
  }
  if (parsed.command === "version") {
    io.stdout(`${HERON_VERSION}\n`);
    return ExitCode.Ok;
  }
  try {
    return await commandFor(parsed.command).handle(parsed, scoped, io);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    const stack =
      error instanceof Error && process.env["HERON_DEBUG"] === "1" ? `\n${error.stack ?? ""}` : "";
    return fail(
      parsed.command,
      ExitCode.Unexpected,
      errorFinding("UNEXPECTED_ERROR", `Unexpected error: ${detail}`),
      `Unexpected error: ${detail}${stack}`,
      parsed.json,
    );
  }
}
