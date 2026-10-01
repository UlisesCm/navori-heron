import { runStatus } from "../../app/status.ts";
import { parsePathCommand, type CommandSpec, type StatusParsed } from "../command.ts";
import { emitResult } from "../output.ts";
import { renderStatusText } from "../render.ts";

export const statusCommand: CommandSpec<StatusParsed> = {
  name: "status",
  usage: ["  status [path] [--json]", "      Show mode, stage, phase, gates and stale artifacts"],
  parse: (args, json) => parsePathCommand("status", args, json),
  async handle(parsed, ctx, io) {
    const started = performance.now();
    const result = await runStatus(ctx, { path: parsed.path });
    return emitResult(
      io,
      {
        command: "status",
        json: parsed.json,
        started,
        runId: ctx.ids.runId(ctx.clock.now()),
        render: renderStatusText,
      },
      result,
    );
  },
};
