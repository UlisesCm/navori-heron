import { runDirectionPropose, runDirectionSelect } from "../../app/directions.ts";
import {
  UsageError,
  parseOptions,
  unexpectedArgument,
  type CommandSpec,
  type DirectionParsed,
} from "../command.ts";
import { emitResult } from "../output.ts";
import { renderDirectionProposeText, renderDirectionSelectText } from "../render-agents.ts";
import { withFindings } from "../render-research.ts";

type Action = DirectionParsed["action"];
const ACTIONS: readonly Action[] = ["propose", "select"];

/** Single optional path positional; `force` appears in the result only when passed. */
function parsePropose(args: readonly string[], json: boolean): DirectionParsed | UsageError {
  const parsed = parseOptions(args, { force: { type: "boolean" } }, json);
  if (parsed instanceof UsageError) return parsed;
  const tooMany = unexpectedArgument(parsed.positionals, 1, json);
  if (tooMany !== null) return tooMany;
  return {
    command: "direction",
    action: "propose",
    path: parsed.positionals[0] ?? ".",
    ...(parsed.values.force === true ? { force: true as const } : {}),
    json,
  };
}

/** The first positional is the direction id, at most one more is the path. */
function parseSelect(args: readonly string[], json: boolean): DirectionParsed | UsageError {
  const parsed = parseOptions(args, { note: { type: "string" } }, json);
  if (parsed instanceof UsageError) return parsed;
  const tooMany = unexpectedArgument(parsed.positionals, 2, json);
  if (tooMany !== null) return tooMany;
  const [direction, path] = parsed.positionals;
  if (direction === undefined) {
    return new UsageError("direction select needs a direction id (DIR-A, DIR-B or DIR-C).", json);
  }
  return {
    command: "direction",
    action: "select",
    path: path ?? ".",
    direction,
    note: parsed.values.note ?? null,
    json,
  };
}

export const directionCommand: CommandSpec<DirectionParsed> = {
  name: "direction",
  usage: [
    "  direction propose [path] [--force] [--json]",
    "      Ask the creator agent for 3 exploratory visual directions with their visual proposal data",
    "  direction select <DIR-x> [path] [--note <text>] [--json]",
    "      Record the preferred direction (never approves the direction gate)",
  ],
  parse(args, json) {
    const action = ACTIONS.find((candidate) => candidate === args[0]);
    if (action === undefined) {
      return new UsageError(
        `Unknown direction command "${args[0] ?? ""}". Expected: ${ACTIONS.join(", ")}.`,
        json,
      );
    }
    return (action === "propose" ? parsePropose : parseSelect)(args.slice(1), json);
  },
  async handle(parsed, ctx, io) {
    const base = {
      json: parsed.json,
      started: performance.now(),
      runId: ctx.ids.runId(ctx.clock.now()),
    };
    switch (parsed.action) {
      case "propose":
        return emitResult(
          io,
          {
            ...base,
            command: "direction propose",
            render: (data, findings) =>
              withFindings(renderDirectionProposeText(data, parsed.path), findings),
          },
          await runDirectionPropose(ctx, { path: parsed.path, force: parsed.force === true }),
        );
      case "select":
        return emitResult(
          io,
          {
            ...base,
            command: "direction select",
            render: (data, findings) => withFindings(renderDirectionSelectText(data), findings),
          },
          await runDirectionSelect(ctx, {
            path: parsed.path,
            direction: parsed.direction,
            note: parsed.note,
          }),
        );
    }
  },
};
