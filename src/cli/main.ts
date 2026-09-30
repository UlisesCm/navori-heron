import type { AppContext } from "../app/context.ts";
import { createDefaultContext } from "../app/context.ts";
import { failure } from "../app/result.ts";
import { HERON_VERSION } from "../app/version.ts";
import { ExitCode, type CliCommand, type Finding } from "../core/contracts/index.ts";
import { UsageError, USAGE_TEXT, parseCliArgs } from "./args.ts";
import { handleInit } from "./commands/init.ts";
import { handleStatus } from "./commands/status.ts";
import { buildEnvelope } from "./envelope.ts";
import type { CliIo } from "./io.ts";

function errorFinding(code: Finding["code"], message: string): Finding {
  return { code, severity: "error", message, paths: [], issues: [] };
}

/** Text mode: result to stdout, failures to stderr. --json: exactly one CliEnvelope + "\n" to stdout, nothing else.
 * Unexpected exception -> exit 1, UNEXPECTED_ERROR (stack only when HERON_DEBUG=1). */
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
    text: string,
    json: boolean,
  ): ExitCode => {
    if (json) {
      const result = failure<null>(code, finding);
      const durationMs = Math.round(performance.now() - started);
      io.stdout(`${JSON.stringify(buildEnvelope({ command, result, runId, durationMs }))}\n`);
    } else {
      io.stderr(`${text}\n`);
    }
    return code;
  };

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
    switch (parsed.command) {
      case "init":
        return await handleInit(parsed, scoped, io);
      case "status":
        return await handleStatus(parsed, scoped, io);
      default: {
        // TODO(T11): dispatch doctor and gate once their handlers exist.
        const message = `Command "${parsed.command}" is not available yet.`;
        return fail(
          parsed.command,
          ExitCode.Usage,
          errorFinding("USAGE", message),
          message,
          parsed.json,
        );
      }
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    const stack =
      error instanceof Error && process.env["HERON_DEBUG"] === "1" ? `\n${error.stack ?? ""}` : "";
    const command = parsed.command;
    return fail(
      command,
      ExitCode.Unexpected,
      errorFinding("UNEXPECTED_ERROR", `Unexpected error: ${detail}`),
      `Unexpected error: ${detail}${stack}`,
      "json" in parsed && parsed.json,
    );
  }
}
