import { runBrandAdd } from "../../app/brand.ts";
import {
  UsageError,
  parseOptions,
  unexpectedArgument,
  type BrandParsed,
  type CommandSpec,
} from "../command.ts";
import { emitResult } from "../output.ts";
import { withFindings, renderBrandAddText } from "../render-research.ts";

function parseAdd(args: readonly string[], json: boolean): BrandParsed | UsageError {
  const parsed = parseOptions(
    args,
    {
      kind: { type: "string" },
      origin: { type: "string" },
      value: { type: "string" },
      file: { type: "string" },
      reference: { type: "string" },
      note: { type: "string" },
    },
    json,
  );
  if (parsed instanceof UsageError) return parsed;
  const tooMany = unexpectedArgument(parsed.positionals, 1, json);
  if (tooMany !== null) return tooMany;
  const { values } = parsed;
  return {
    command: "brand",
    action: "add",
    path: parsed.positionals[0] ?? ".",
    input: {
      kind: values.kind ?? null,
      origin: values.origin ?? null,
      value: values.value ?? null,
      file: values.file ?? null,
      reference: values.reference ?? null,
      note: values.note ?? null,
    },
    json,
  };
}

export const brandCommand: CommandSpec<BrandParsed> = {
  name: "brand",
  usage: [
    "  brand add [path] --kind <kind> --origin <origin> --value <text> [--file <path>] [--reference <REF-n>]",
    "      [--note <text>] [--json]",
    "      Record a brand input with its origin",
  ],
  parse(args, json) {
    if (args[0] !== "add") {
      return new UsageError(`Unknown brand command "${args[0] ?? ""}". Expected: add.`, json);
    }
    return parseAdd(args.slice(1), json);
  },
  async handle(parsed, ctx, io) {
    const started = performance.now();
    return emitResult(
      io,
      {
        command: "brand add",
        json: parsed.json,
        started,
        runId: ctx.ids.runId(ctx.clock.now()),
        render: (data, findings) => withFindings(renderBrandAddText(data), findings),
      },
      await runBrandAdd(ctx, { path: parsed.path, input: parsed.input }),
    );
  },
};
