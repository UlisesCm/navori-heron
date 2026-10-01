import {
  runReferencesAdd,
  runReferencesCompare,
  runReferencesImport,
  runReferencesList,
  runReferencesRemove,
  runReferencesShow,
} from "../../app/references.ts";
import { ReferenceIdSchema, type CropInput, type Finding } from "../../core/contracts/index.ts";
import {
  UsageError,
  parseOptions,
  unexpectedArgument,
  type CommandSpec,
  type ReferencesParsed,
} from "../command.ts";
import { emitResult, splitNotices, type TextOutput } from "../output.ts";
import { renderFindings } from "../render.ts";
import {
  renderReferencesAddText,
  renderReferencesCompareText,
  renderReferencesImportText,
  renderReferencesListText,
  renderReferencesRemoveText,
  renderReferencesShowText,
} from "../render-research.ts";

const ACTIONS = ["add", "list", "show", "compare", "remove", "import"] as const;
const CROP_RE = /^(\d+),(\d+),(\d+),(\d+)$/;

/** `x,y,w,h=note` (note after the first "="); null when the syntax is wrong. */
function parseCrop(text: string): CropInput | null {
  const at = text.indexOf("=");
  const match = at === -1 ? null : CROP_RE.exec(text.slice(0, at));
  if (match === null) return null;
  const [x = 0, y = 0, width = 0, height = 0] = match.slice(1).map(Number);
  return { x, y, width, height, note: text.slice(at + 1) };
}

/** Text first, then the findings that are not notices; notices go to stderr. */
function output(text: string, findings: readonly Finding[]): TextOutput {
  const { notices, rest } = splitNotices(findings);
  const tail = renderFindings(rest);
  return {
    stdout: tail === "" ? text : `${text}\n\n${tail}`,
    stderr: renderFindings(notices),
  };
}

function referenceId(text: string | undefined, json: boolean): string | UsageError {
  return text !== undefined && ReferenceIdSchema.safeParse(text).success
    ? text
    : new UsageError(`"${text ?? ""}" is not a reference id such as REF-1.`, json);
}

function parseAdd(args: readonly string[], json: boolean): ReferencesParsed | UsageError {
  const parsed = parseOptions(
    args,
    {
      source: { type: "string" },
      origin: { type: "string" },
      url: { type: "string" },
      file: { type: "string" },
      screenshot: { type: "boolean" },
      "allow-local": { type: "boolean" },
      reason: { type: "string" },
      study: { type: "string", multiple: true },
      "do-not-copy": { type: "string", multiple: true },
      influence: { type: "string", multiple: true },
      crop: { type: "string", multiple: true },
    },
    json,
  );
  if (parsed instanceof UsageError) return parsed;
  const tooMany = unexpectedArgument(parsed.positionals, 1, json);
  if (tooMany !== null) return tooMany;
  const { values } = parsed;
  const crops: CropInput[] = [];
  for (const text of values.crop ?? []) {
    const crop = parseCrop(text);
    if (crop === null) {
      return new UsageError(
        `Invalid --crop "${text}": expected x,y,width,height=note with integers >= 0.`,
        json,
      );
    }
    crops.push(crop);
  }
  return {
    command: "references",
    action: "add",
    path: parsed.positionals[0] ?? ".",
    reference: {
      source: values.source ?? null,
      origin: values.origin ?? null,
      reason: values.reason ?? null,
      studies: values.study ?? [],
      doNotCopy: values["do-not-copy"] ?? [],
      influences: values.influence ?? [],
      file: values.file ?? null,
      url: values.url ?? null,
      screenshot: values.screenshot === true,
      allowLocal: values["allow-local"] === true,
      crops,
    },
    json,
  };
}

function parseCompare(args: readonly string[], json: boolean): ReferencesParsed | UsageError {
  const parsed = parseOptions(args, {}, json);
  if (parsed instanceof UsageError) return parsed;
  const ids = parsed.positionals.filter((token) => ReferenceIdSchema.safeParse(token).success);
  const others = parsed.positionals.filter((token) => !ids.includes(token));
  const tooMany = unexpectedArgument(others, 1, json);
  if (tooMany !== null) return tooMany;
  if (ids.length < 2 || ids.length > 4) {
    return new UsageError("references compare takes 2 to 4 reference ids such as REF-1.", json);
  }
  if (new Set(ids).size !== ids.length) {
    return new UsageError("references compare needs distinct reference ids.", json);
  }
  return { command: "references", action: "compare", path: others[0] ?? ".", ids, json };
}

/** `<REF-n> [path]` plus the action's own options; the id is validated here, its existence by `app`. */
function parseIdAction(
  action: "show" | "remove",
  args: readonly string[],
  json: boolean,
): ReferencesParsed | UsageError {
  const parsed = parseOptions(args, { reason: { type: "string" } }, json);
  if (parsed instanceof UsageError) return parsed;
  if (action === "show" && parsed.values.reason !== undefined) {
    return new UsageError(`Unknown option "--reason".`, json);
  }
  const tooMany = unexpectedArgument(parsed.positionals, 2, json);
  if (tooMany !== null) return tooMany;
  const id = referenceId(parsed.positionals[0], json);
  if (id instanceof UsageError) return id;
  const path = parsed.positionals[1] ?? ".";
  return action === "show"
    ? { command: "references", action, path, id, json }
    : { command: "references", action, path, id, reason: parsed.values.reason ?? null, json };
}

function parseList(args: readonly string[], json: boolean): ReferencesParsed | UsageError {
  const parsed = parseOptions(args, { all: { type: "boolean" } }, json);
  if (parsed instanceof UsageError) return parsed;
  const tooMany = unexpectedArgument(parsed.positionals, 1, json);
  if (tooMany !== null) return tooMany;
  return {
    command: "references",
    action: "list",
    path: parsed.positionals[0] ?? ".",
    includeRemoved: parsed.values.all === true,
    json,
  };
}

function parseImport(args: readonly string[], json: boolean): ReferencesParsed | UsageError {
  const parsed = parseOptions(args, { "allow-local": { type: "boolean" } }, json);
  if (parsed instanceof UsageError) return parsed;
  const tooMany = unexpectedArgument(parsed.positionals, 2, json);
  if (tooMany !== null) return tooMany;
  const [file, path] = parsed.positionals;
  if (file === undefined) return new UsageError("references import needs a <file.json>.", json);
  return {
    command: "references",
    action: "import",
    path: path ?? ".",
    file,
    allowLocal: parsed.values["allow-local"] === true,
    json,
  };
}

export const referencesCommand: CommandSpec<ReferencesParsed> = {
  name: "references",
  usage: [
    "  references add [path] --source <kind> [--origin <text>] [--url <url>] [--file <path>] [--screenshot]",
    "      [--allow-local] --reason <text> --study <text>... --do-not-copy <text>... --influence <text>...",
    "      [--crop <x,y,w,h=note>]... [--json]",
    "      Record a visual reference with complete provenance",
    "  references list [path] [--all] [--json]",
    "      List references (removed ones too with --all)",
    "  references show <REF-n> [path] [--json]",
    "      Show one reference with its provenance, crops and security findings",
    "  references compare <REF-n> <REF-n> [<REF-n> <REF-n>] [path] [--json]",
    "      Compare 2 to 4 references side by side",
    "  references remove <REF-n> [path] [--reason <text>] [--json]",
    "      Remove a reference (kept as removed in references.json)",
    "  references import <file.json> [path] [--allow-local] [--json]",
    "      Import a ReferenceBatch file, all or nothing",
  ],
  parse(args, json) {
    const action = ACTIONS.find((candidate) => candidate === args[0]);
    if (action === undefined) {
      return new UsageError(
        `Unknown references command "${args[0] ?? ""}". Expected: ${ACTIONS.join(", ")}.`,
        json,
      );
    }
    const rest = args.slice(1);
    switch (action) {
      case "add":
        return parseAdd(rest, json);
      case "list":
        return parseList(rest, json);
      case "compare":
        return parseCompare(rest, json);
      case "import":
        return parseImport(rest, json);
      default:
        return parseIdAction(action, rest, json);
    }
  },
  async handle(parsed, ctx, io) {
    const started = performance.now();
    const base = {
      json: parsed.json,
      started,
      runId: ctx.ids.runId(ctx.clock.now()),
    };
    switch (parsed.action) {
      case "add":
        return emitResult(
          io,
          {
            ...base,
            command: "references add",
            render: (data, findings) => output(renderReferencesAddText(data), findings),
          },
          await runReferencesAdd(ctx, { path: parsed.path, reference: parsed.reference }),
        );
      case "import":
        return emitResult(
          io,
          {
            ...base,
            command: "references import",
            render: (data, findings) => output(renderReferencesImportText(data), findings),
          },
          await runReferencesImport(ctx, {
            path: parsed.path,
            file: parsed.file,
            allowLocal: parsed.allowLocal,
          }),
        );
      case "list":
        return emitResult(
          io,
          {
            ...base,
            command: "references list",
            render: (data, findings) => output(renderReferencesListText(data), findings),
          },
          await runReferencesList(ctx, {
            path: parsed.path,
            includeRemoved: parsed.includeRemoved,
          }),
        );
      case "show":
        return emitResult(
          io,
          {
            ...base,
            command: "references show",
            render: (data, findings) => output(renderReferencesShowText(data), findings),
          },
          await runReferencesShow(ctx, { path: parsed.path, id: parsed.id }),
        );
      case "compare":
        return emitResult(
          io,
          {
            ...base,
            command: "references compare",
            render: (data, findings) => output(renderReferencesCompareText(data), findings),
          },
          await runReferencesCompare(ctx, { path: parsed.path, ids: parsed.ids }),
        );
      case "remove":
        return emitResult(
          io,
          {
            ...base,
            command: "references remove",
            render: (data, findings) => output(renderReferencesRemoveText(data), findings),
          },
          await runReferencesRemove(ctx, {
            path: parsed.path,
            id: parsed.id,
            reason: parsed.reason,
          }),
        );
    }
  },
};
