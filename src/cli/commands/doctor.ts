import { runDoctor } from "../../app/doctor.ts";
import { parsePathCommand, type CommandSpec, type DoctorParsed } from "../command.ts";
import { emitResult } from "../output.ts";
import { renderDoctorText } from "../render.ts";

export const doctorCommand: CommandSpec<DoctorParsed> = {
  name: "doctor",
  usage: [
    "  doctor [path] [--json]",
    "      Check the local environment and the .heron/ workspace",
  ],
  parse: (args, json) => parsePathCommand("doctor", args, json),
  async handle(parsed, ctx, io) {
    const started = performance.now();
    const result = await runDoctor(ctx, { path: parsed.path });
    // The report is the output even when a check failed; the exit code carries the failure.
    return emitResult(
      io,
      {
        command: "doctor",
        json: parsed.json,
        started,
        runId: ctx.ids.runId(ctx.clock.now()),
        render: renderDoctorText,
        renderFailedData: true,
      },
      result,
    );
  },
};
