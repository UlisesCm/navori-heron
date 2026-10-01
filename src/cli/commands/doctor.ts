import { runDoctor } from "../../app/doctor.ts";
import type { AppContext } from "../../app/context.ts";
import { ExitCode } from "../../core/contracts/index.ts";
import type { ParsedCommand } from "../args.ts";
import { buildEnvelope } from "../envelope.ts";
import type { CliIo } from "../io.ts";
import { renderDoctorText } from "../render.ts";

export async function handleDoctor(
  parsed: Extract<ParsedCommand, { command: "doctor" }>,
  ctx: AppContext,
  io: CliIo,
): Promise<ExitCode> {
  const started = performance.now();
  const result = await runDoctor(ctx, { path: parsed.path });
  const code = result.ok ? ExitCode.Ok : result.code;
  if (parsed.json) {
    const envelope = buildEnvelope({
      command: "doctor",
      result,
      runId: ctx.ids.runId(ctx.clock.now()),
      durationMs: Math.round(performance.now() - started),
    });
    io.stdout(`${JSON.stringify(envelope)}\n`);
    return code;
  }
  // The report is the output even when a check failed; the exit code carries the failure.
  if (result.data === null) {
    io.stderr(`${result.ok ? "" : result.message}\n`);
    return code;
  }
  io.stdout(`${renderDoctorText(result.data)}\n`);
  return code;
}
