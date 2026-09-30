import { runInit } from "../../app/init.ts";
import type { AppContext } from "../../app/context.ts";
import { ExitCode } from "../../core/contracts/index.ts";
import type { ParsedCommand } from "../args.ts";
import { buildEnvelope } from "../envelope.ts";
import type { CliIo } from "../io.ts";
import { renderFindings, renderInitText } from "../render.ts";

const APP_ONLY_CODES: readonly string[] = ["LOCK_RECLAIMED", "STAGING_RECOVERED"];

export async function handleInit(
  parsed: Extract<ParsedCommand, { command: "init" }>,
  ctx: AppContext,
  io: CliIo,
): Promise<ExitCode> {
  const started = performance.now();
  const result = await runInit(ctx, {
    path: parsed.path,
    stage: parsed.stage,
    dryRun: parsed.dryRun,
  });
  if (parsed.json) {
    const envelope = buildEnvelope({
      command: "init",
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
  io.stdout(`${renderInitText(result.data)}\n`);
  const notices = result.findings.filter((finding) => APP_ONLY_CODES.includes(finding.code));
  if (notices.length > 0) io.stderr(`${renderFindings(notices)}\n`);
  return ExitCode.Ok;
}
