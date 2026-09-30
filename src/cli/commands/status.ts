import { runStatus } from "../../app/status.ts";
import type { AppContext } from "../../app/context.ts";
import { ExitCode } from "../../core/contracts/index.ts";
import type { ParsedCommand } from "../args.ts";
import { buildEnvelope } from "../envelope.ts";
import type { CliIo } from "../io.ts";
import { renderStatusText } from "../render.ts";

export async function handleStatus(
  parsed: Extract<ParsedCommand, { command: "status" }>,
  ctx: AppContext,
  io: CliIo,
): Promise<ExitCode> {
  const started = performance.now();
  const result = await runStatus(ctx, { path: parsed.path });
  if (parsed.json) {
    const envelope = buildEnvelope({
      command: "status",
      result,
      runId: ctx.ids.runId(ctx.clock.now()),
      durationMs: Math.round(performance.now() - started),
    });
    io.stdout(`${JSON.stringify(envelope)}\n`);
    return result.ok ? ExitCode.Ok : result.code;
  }
  if (!result.ok) {
    io.stderr(`${result.message}\n`);
    return result.code;
  }
  io.stdout(`${renderStatusText(result.data, result.findings)}\n`);
  return ExitCode.Ok;
}
