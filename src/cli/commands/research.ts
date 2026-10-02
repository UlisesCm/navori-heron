import { runResearchAnalyze, runResearchBrief, runResearchRender } from "../../app/research.ts";
import {
  UsageError,
  parseOptions,
  unexpectedArgument,
  type CommandSpec,
  type ResearchParsed,
} from "../command.ts";
import { emitResult } from "../output.ts";
import { renderResearchAnalyzeText, renderResearchBriefText } from "../render-agents.ts";
import { withFindings, renderResearchRenderText } from "../render-research.ts";

type Action = ResearchParsed["action"];

/** Single optional path positional; `force`/`resetQueries` appear in the result only when passed. */
function parseBrief(args: readonly string[], json: boolean): ResearchParsed | UsageError {
  const parsed = parseOptions(
    args,
    {
      query: { type: "string", multiple: true },
      "reset-queries": { type: "boolean" },
      force: { type: "boolean" },
    },
    json,
  );
  if (parsed instanceof UsageError) return parsed;
  const tooMany = unexpectedArgument(parsed.positionals, 1, json);
  if (tooMany !== null) return tooMany;
  const { values } = parsed;
  return {
    command: "research",
    action: "brief",
    path: parsed.positionals[0] ?? ".",
    queries: values.query ?? [],
    ...(values["reset-queries"] === true ? { resetQueries: true as const } : {}),
    ...(values.force === true ? { force: true as const } : {}),
    json,
  };
}

function parseAnalyze(args: readonly string[], json: boolean): ResearchParsed | UsageError {
  const parsed = parseOptions(
    args,
    { ref: { type: "string", multiple: true }, force: { type: "boolean" } },
    json,
  );
  if (parsed instanceof UsageError) return parsed;
  const tooMany = unexpectedArgument(parsed.positionals, 1, json);
  if (tooMany !== null) return tooMany;
  const { values } = parsed;
  return {
    command: "research",
    action: "analyze",
    path: parsed.positionals[0] ?? ".",
    refs: values.ref ?? [],
    ...(values.force === true ? { force: true as const } : {}),
    json,
  };
}

function parseRender(args: readonly string[], json: boolean): ResearchParsed | UsageError {
  const parsed = parseOptions(args, {}, json);
  if (parsed instanceof UsageError) return parsed;
  const tooMany = unexpectedArgument(parsed.positionals, 1, json);
  if (tooMany !== null) return tooMany;
  return { command: "research", action: "render", path: parsed.positionals[0] ?? ".", json };
}

const PARSERS: Readonly<
  Record<Action, (args: readonly string[], json: boolean) => ResearchParsed | UsageError>
> = { brief: parseBrief, analyze: parseAnalyze, render: parseRender };
const ACTIONS: readonly Action[] = ["brief", "analyze", "render"];

export const researchCommand: CommandSpec<ResearchParsed> = {
  name: "research",
  usage: [
    "  research render [path] [--json]",
    "      Regenerate REFERENCES.md, references.json, provenance.json and the moodboard",
    "  research brief [path] [--query <facet>:<text>]... [--reset-queries] [--force] [--json]",
    "      Ask the creator agent for research queries by interface facet (reference-only)",
    "  research analyze [path] [--ref <REF-n>]... [--force] [--json]",
    "      Ask the creator agent for inferred notes on references (default: missing or stale ones)",
  ],
  parse(args, json) {
    const action = ACTIONS.find((candidate) => candidate === args[0]);
    if (action === undefined) {
      return new UsageError(
        `Unknown research command "${args[0] ?? ""}". Expected: ${ACTIONS.join(", ")}.`,
        json,
      );
    }
    return PARSERS[action](args.slice(1), json);
  },
  async handle(parsed, ctx, io) {
    const started = performance.now();
    const base = {
      json: parsed.json,
      started,
      runId: ctx.ids.runId(ctx.clock.now()),
    };
    switch (parsed.action) {
      case "render":
        return emitResult(
          io,
          {
            ...base,
            command: "research render",
            render: (data, findings) => withFindings(renderResearchRenderText(data), findings),
          },
          await runResearchRender(ctx, { path: parsed.path }),
        );
      case "brief":
        return emitResult(
          io,
          {
            ...base,
            command: "research brief",
            render: (data, findings) => withFindings(renderResearchBriefText(data), findings),
          },
          await runResearchBrief(ctx, {
            path: parsed.path,
            queries: parsed.queries,
            resetQueries: parsed.resetQueries === true,
            force: parsed.force === true,
          }),
        );
      case "analyze":
        return emitResult(
          io,
          {
            ...base,
            command: "research analyze",
            render: (data, findings) => withFindings(renderResearchAnalyzeText(data), findings),
          },
          await runResearchAnalyze(ctx, {
            path: parsed.path,
            refs: parsed.refs,
            force: parsed.force === true,
          }),
        );
    }
  },
};
