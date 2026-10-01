import { runResearchRender } from "../../app/research.ts";
import {
  UsageError,
  parseOptions,
  unexpectedArgument,
  type CommandSpec,
  type ResearchParsed,
} from "../command.ts";
import { emitResult } from "../output.ts";
import { withFindings, renderResearchRenderText } from "../render-research.ts";

export const researchCommand: CommandSpec<ResearchParsed> = {
  name: "research",
  usage: [
    "  research render [path] [--json]",
    "      Regenerate REFERENCES.md, references.json, provenance.json and the moodboard",
  ],
  parse(args, json) {
    if (args[0] !== "render") {
      return new UsageError(`Unknown research command "${args[0] ?? ""}". Expected: render.`, json);
    }
    const parsed = parseOptions(args.slice(1), {}, json);
    if (parsed instanceof UsageError) return parsed;
    const tooMany = unexpectedArgument(parsed.positionals, 1, json);
    if (tooMany !== null) return tooMany;
    return { command: "research", action: "render", path: parsed.positionals[0] ?? ".", json };
  },
  async handle(parsed, ctx, io) {
    const started = performance.now();
    return emitResult(
      io,
      {
        command: "research render",
        json: parsed.json,
        started,
        runId: ctx.ids.runId(ctx.clock.now()),
        render: (data, findings) => withFindings(renderResearchRenderText(data), findings),
      },
      await runResearchRender(ctx, { path: parsed.path }),
    );
  },
};
