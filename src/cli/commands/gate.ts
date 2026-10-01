import { runGate } from "../../app/gate.ts";
import type { AppContext } from "../../app/context.ts";
import { ExitCode } from "../../core/contracts/index.ts";
import type { ParsedCommand } from "../args.ts";
import { buildEnvelope } from "../envelope.ts";
import type { CliIo } from "../io.ts";
import { renderFindings, renderGateText } from "../render.ts";

export async function handleGate(
  parsed: Extract<ParsedCommand, { command: "gate" }>,
  ctx: AppContext,
  io: CliIo,
): Promise<ExitCode> {
  const started = performance.now();
  const result = await runGate(ctx, {
    path: parsed.path,
    gate: parsed.gate,
    decision: parsed.decision,
    note: parsed.note,
    reason: parsed.reason,
    yes: parsed.yes,
  });
  if (parsed.json) {
    const envelope = buildEnvelope({
      command: "gate",
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
  const warnings = renderFindings(result.findings);
  io.stdout(
    `${renderGateText(result.data, ctx.identity.current()?.trim() ?? "")}\n${warnings === "" ? "" : `\n${warnings}\n`}`,
  );
  return ExitCode.Ok;
}
