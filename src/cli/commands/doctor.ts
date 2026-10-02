import { runDoctor } from "../../app/doctor.ts";
import {
  parseOptions,
  unexpectedArgument,
  UsageError,
  type CommandSpec,
  type DoctorParsed,
} from "../command.ts";
import { emitResult } from "../output.ts";
import { renderDoctorText } from "../render.ts";

export const doctorCommand: CommandSpec<DoctorParsed> = {
  name: "doctor",
  usage: [
    "  doctor [path] [--deep] [--json]",
    "      Check the local environment, the .heron/ workspace and the agent CLIs (--deep: live schema-bound probe)",
  ],
  parse(args, json) {
    const parsed = parseOptions(args, { deep: { type: "boolean" } }, json);
    if (parsed instanceof UsageError) return parsed;
    const tooMany = unexpectedArgument(parsed.positionals, 1, json);
    if (tooMany !== null) return tooMany;
    return {
      command: "doctor",
      path: parsed.positionals[0] ?? ".",
      json,
      ...(parsed.values.deep === true ? { deep: true as const } : {}),
    };
  },
  async handle(parsed, ctx, io) {
    const started = performance.now();
    const result = await runDoctor(ctx, { path: parsed.path, deep: parsed.deep === true });
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
