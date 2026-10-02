import { parseArgs, type ParseArgsOptionsConfig } from "node:util";
import type { AppContext } from "../app/context.ts";
import type {
  BrandInputDraft,
  ExitCode,
  GateName,
  ReferenceInput,
} from "../core/contracts/index.ts";
import type { CliIo } from "./io.ts";

/** Grows with each command group (P2 adds references, brand and research). */
export type CommandName =
  | "init"
  | "status"
  | "doctor"
  | "gate"
  | "references"
  | "brand"
  | "research"
  | "intake"
  | "conflicts";
export type InitParsed = {
  command: "init";
  path: string;
  stage: string | null;
  dryRun: boolean;
  json: boolean;
  /** Present only when --locale is given (P1 parse results keep their exact shape). */
  locale?: string;
  /** Present only when --adapter is given. */
  adapter?: "auto" | "markdown" | "manual";
  /** Present only when --context is given (repeatable). */
  context?: string[];
};
export type StatusParsed = { command: "status"; path: string; json: boolean };
export type DoctorParsed = { command: "doctor"; path: string; json: boolean };
export type GateParsed = {
  command: "gate";
  path: string;
  gate: GateName;
  decision: "approve" | "reject";
  note: string | null;
  reason: string | null;
  yes: boolean;
  json: boolean;
};
/** `heron references <action>`: one variant per action, discriminated by `action`. */
export type ReferencesParsed =
  | {
      command: "references";
      action: "add";
      path: string;
      reference: ReferenceInput;
      json: boolean;
    }
  | { command: "references"; action: "list"; path: string; includeRemoved: boolean; json: boolean }
  | { command: "references"; action: "show"; path: string; id: string; json: boolean }
  | { command: "references"; action: "compare"; path: string; ids: string[]; json: boolean }
  | {
      command: "references";
      action: "remove";
      path: string;
      id: string;
      reason: string | null;
      json: boolean;
    }
  | {
      command: "references";
      action: "import";
      path: string;
      file: string;
      allowLocal: boolean;
      json: boolean;
    };
/** `heron brand add`: the only brand action P2 needs (R14). */
export type BrandParsed = {
  command: "brand";
  action: "add";
  path: string;
  input: BrandInputDraft;
  json: boolean;
};
/** `heron research render`: the only research action P2 needs. */
export type ResearchParsed = { command: "research"; action: "render"; path: string; json: boolean };
/** `heron intake`: `--refresh` is parsed and ignored (DR31). */
export type IntakeParsed = { command: "intake"; path: string; dryRun: boolean; json: boolean };
/** `heron conflicts <action>`: one variant per action, discriminated by `action`. */
export type ConflictsParsed =
  | { command: "conflicts"; action: "list"; path: string; all: boolean; json: boolean }
  | {
      command: "conflicts";
      action: "ack";
      path: string;
      id: string;
      note: string | null;
      yes: boolean;
      json: boolean;
    };
export type ParsedCommand =
  | InitParsed
  | StatusParsed
  | DoctorParsed
  | GateParsed
  | ReferencesParsed
  | BrandParsed
  | ResearchParsed
  | IntakeParsed
  | ConflictsParsed
  | { command: "help" }
  | { command: "version" };

export class UsageError extends Error {
  readonly json: boolean;
  constructor(message: string, json: boolean) {
    super(message);
    this.name = "UsageError";
    this.json = json;
  }
}

export interface CommandSpec<P extends ParsedCommand = ParsedCommand> {
  readonly name: CommandName;
  /** Help lines, already indented ("  init [path] ...", "      Detect the product context ..."). */
  readonly usage: readonly string[];
  /** argv after the command name (flags included). Never throws. */
  parse(args: readonly string[], json: boolean): P | UsageError;
  /** Calls exactly one run* and ends in emitResult. Method syntax on purpose: handlers stay assignable to CommandSpec. */
  handle(parsed: P, ctx: AppContext, io: CliIo): Promise<ExitCode>;
}

type Parsed<O extends ParseArgsOptionsConfig> = ReturnType<
  typeof parseArgs<{ options: O; allowPositionals: true; strict: true }>
>;

/** node:util parseArgs with strict: true and allowPositionals: true; any thrown error -> UsageError.
 * "--json" is always accepted. */
export function parseOptions<O extends ParseArgsOptionsConfig>(
  args: readonly string[],
  options: O,
  json: boolean,
): { values: Parsed<O>["values"]; positionals: string[] } | UsageError {
  try {
    const { values, positionals } = parseArgs({
      args: [...args],
      options: { ...options, json: { type: "boolean" } },
      allowPositionals: true,
      strict: true,
    });
    return { values: values as Parsed<O>["values"], positionals };
  } catch (error) {
    return new UsageError(error instanceof Error ? error.message : String(error), json);
  }
}

/** UsageError for positionals beyond `max`, null otherwise. */
export function unexpectedArgument(
  positionals: readonly string[],
  max: number,
  json: boolean,
): UsageError | null {
  return positionals.length > max
    ? new UsageError(`Unexpected argument "${positionals[max]}".`, json)
    : null;
}

/** `<command> [path] [--json]`: shared by the commands that take only an optional path. */
export function parsePathCommand<C extends "status" | "doctor">(
  command: C,
  args: readonly string[],
  json: boolean,
): { command: C; path: string; json: boolean } | UsageError {
  const parsed = parseOptions(args, {}, json);
  if (parsed instanceof UsageError) return parsed;
  const tooMany = unexpectedArgument(parsed.positionals, 1, json);
  if (tooMany !== null) return tooMany;
  return { command, path: parsed.positionals[0] ?? ".", json };
}
