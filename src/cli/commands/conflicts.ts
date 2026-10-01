import { runConflictsAck, runConflictsList } from "../../app/conflicts.ts";
import { ConflictIdSchema } from "../../core/contracts/index.ts";
import {
  UsageError,
  parseOptions,
  unexpectedArgument,
  type CommandSpec,
  type ConflictsParsed,
} from "../command.ts";
import { emitResult } from "../output.ts";
import { renderConflictsAckText, renderConflictsListText } from "../render-intake.ts";
import { withFindings } from "../render-research.ts";

const ACTIONS = ["list", "ack"] as const;

function parseList(args: readonly string[], json: boolean): ConflictsParsed | UsageError {
  const parsed = parseOptions(args, { all: { type: "boolean" } }, json);
  if (parsed instanceof UsageError) return parsed;
  const tooMany = unexpectedArgument(parsed.positionals, 1, json);
  if (tooMany !== null) return tooMany;
  return {
    command: "conflicts",
    action: "list",
    path: parsed.positionals[0] ?? ".",
    all: parsed.values.all === true,
    json,
  };
}

function parseAck(args: readonly string[], json: boolean): ConflictsParsed | UsageError {
  const parsed = parseOptions(args, { note: { type: "string" }, yes: { type: "boolean" } }, json);
  if (parsed instanceof UsageError) return parsed;
  const tooMany = unexpectedArgument(parsed.positionals, 2, json);
  if (tooMany !== null) return tooMany;
  const [id, path] = parsed.positionals;
  if (id === undefined || !ConflictIdSchema.safeParse(id).success) {
    return new UsageError(`"${id ?? ""}" is not a conflict id such as CONFLICT-001.`, json);
  }
  return {
    command: "conflicts",
    action: "ack",
    path: path ?? ".",
    id,
    note: parsed.values.note ?? null,
    yes: parsed.values.yes === true,
    json,
  };
}

export const conflictsCommand: CommandSpec<ConflictsParsed> = {
  name: "conflicts",
  usage: [
    "  conflicts list [path] [--all] [--json]",
    "      List the conflicts found by the last intake (resolved ones too with --all)",
    "  conflicts ack <CONFLICT-NNN> [path] --note <text> [--yes] [--json]",
    "      Acknowledge a conflict with a note (unblocks the intake gate)",
  ],
  parse(args, json) {
    const action = ACTIONS.find((candidate) => candidate === args[0]);
    if (action === undefined) {
      return new UsageError(
        `Unknown conflicts command "${args[0] ?? ""}". Expected: ${ACTIONS.join(", ")}.`,
        json,
      );
    }
    const rest = args.slice(1);
    return action === "list" ? parseList(rest, json) : parseAck(rest, json);
  },
  async handle(parsed, ctx, io) {
    const started = performance.now();
    const base = { json: parsed.json, started, runId: ctx.ids.runId(ctx.clock.now()) };
    if (parsed.action === "list") {
      return emitResult(
        io,
        {
          ...base,
          command: "conflicts list",
          render: (data, findings) =>
            withFindings(renderConflictsListText(data, parsed.path), findings),
        },
        await runConflictsList(ctx, { path: parsed.path, all: parsed.all }),
      );
    }
    return emitResult(
      io,
      {
        ...base,
        command: "conflicts ack",
        render: (data, findings) => withFindings(renderConflictsAckText(data), findings),
      },
      await runConflictsAck(ctx, {
        path: parsed.path,
        id: parsed.id,
        note: parsed.note,
        yes: parsed.yes,
      }),
    );
  },
};
