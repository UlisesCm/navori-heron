import { runIntake } from "../../app/intake.ts";
import {
  UsageError,
  parseOptions,
  unexpectedArgument,
  type CommandSpec,
  type IntakeParsed,
} from "../command.ts";
import { emitResult } from "../output.ts";
import { renderIntakeText } from "../render-intake.ts";
import { withFindings } from "../render-research.ts";

export const intakeCommand: CommandSpec<IntakeParsed> = {
  name: "intake",
  usage: [
    "  intake [path] [--dry-run] [--refresh] [--json]",
    "      Build the ProductContext from the product sources and record conflicts (every run re-reads the sources; --refresh is accepted and changes nothing)",
  ],
  parse(args, json) {
    const parsed = parseOptions(
      args,
      { "dry-run": { type: "boolean" }, refresh: { type: "boolean" } },
      json,
    );
    if (parsed instanceof UsageError) return parsed;
    const tooMany = unexpectedArgument(parsed.positionals, 1, json);
    if (tooMany !== null) return tooMany;
    return {
      command: "intake",
      path: parsed.positionals[0] ?? ".",
      dryRun: parsed.values["dry-run"] === true,
      json,
    };
  },
  async handle(parsed, ctx, io) {
    const started = performance.now();
    return emitResult(
      io,
      {
        command: "intake",
        json: parsed.json,
        started,
        runId: ctx.ids.runId(ctx.clock.now()),
        render: (data, findings) => withFindings(renderIntakeText(data), findings),
      },
      await runIntake(ctx, { path: parsed.path, dryRun: parsed.dryRun }),
    );
  },
};
