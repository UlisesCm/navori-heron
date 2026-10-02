import { runInit } from "../../app/init.ts";
import {
  UsageError,
  parseOptions,
  unexpectedArgument,
  type CommandSpec,
  type InitParsed,
} from "../command.ts";
import { emitResult, splitNotices } from "../output.ts";
import { renderFindings, renderInitText } from "../render.ts";

const isAdapterChoice = (value: string): value is "auto" | "markdown" | "manual" =>
  value === "auto" || value === "markdown" || value === "manual";

export const initCommand: CommandSpec<InitParsed> = {
  name: "init",
  usage: [
    "  init [path] [--stage <NN-slug>] [--adapter auto|markdown|manual] [--context <file>]... [--locale <bcp47>] [--dry-run] [--json]",
    "      Detect the product context, decide the mode and write .heron/",
  ],
  parse(args, json) {
    const parsed = parseOptions(
      args,
      {
        stage: { type: "string" },
        adapter: { type: "string" },
        context: { type: "string", multiple: true },
        locale: { type: "string" },
        "dry-run": { type: "boolean" },
      },
      json,
    );
    if (parsed instanceof UsageError) return parsed;
    const tooMany = unexpectedArgument(parsed.positionals, 1, json);
    if (tooMany !== null) return tooMany;
    const adapter = parsed.values.adapter;
    if (adapter !== undefined && !isAdapterChoice(adapter)) {
      return new UsageError(
        `Invalid --adapter "${adapter}": expected auto, markdown or manual.`,
        json,
      );
    }
    return {
      command: "init",
      path: parsed.positionals[0] ?? ".",
      stage: parsed.values.stage ?? null,
      dryRun: parsed.values["dry-run"] === true,
      json,
      ...(parsed.values.locale === undefined ? {} : { locale: parsed.values.locale }),
      ...(adapter === undefined ? {} : { adapter }),
      ...(parsed.values.context === undefined ? {} : { context: parsed.values.context }),
    };
  },
  async handle(parsed, ctx, io) {
    const started = performance.now();
    const result = await runInit(ctx, {
      path: parsed.path,
      stage: parsed.stage,
      dryRun: parsed.dryRun,
      locale: parsed.locale ?? null,
      adapter: parsed.adapter ?? null,
      context: parsed.context ?? [],
    });
    return emitResult(
      io,
      {
        command: "init",
        json: parsed.json,
        started,
        runId: ctx.ids.runId(ctx.clock.now()),
        render: (data, findings) => ({
          stdout: renderInitText(data),
          stderr: renderFindings(splitNotices(findings).notices),
        }),
      },
      result,
    );
  },
};
