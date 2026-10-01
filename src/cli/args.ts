import { parseArgs } from "node:util";
import { GATE_NAMES, type GateName } from "../core/contracts/index.ts";

export type ParsedCommand =
  | { command: "init"; path: string; stage: string | null; dryRun: boolean; json: boolean }
  | { command: "status"; path: string; json: boolean }
  | { command: "doctor"; path: string; json: boolean }
  | {
      command: "gate";
      path: string;
      gate: GateName;
      decision: "approve" | "reject";
      note: string | null;
      reason: string | null;
      yes: boolean;
      json: boolean;
    }
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

export const USAGE_TEXT: string = `Usage: heron <command> [options]

Commands:
  init [path] [--stage <NN-slug>] [--dry-run] [--json]
      Detect the product context, decide the mode and write .heron/
  status [path] [--json]
      Show mode, stage, phase, gates and stale artifacts
  doctor [path] [--json]
      Check the local environment and the .heron/ workspace
  gate <gate> approve|reject [path] [--note <text>] [--reason <text>] [--yes] [--json]
      Record a human gate decision bound to artifact hashes

Gates: ${GATE_NAMES.join(", ")}

Options:
  -h, --help     Show this help
  -v, --version  Show the Heron version
`;

const OPTIONS = {
  stage: { type: "string" },
  "dry-run": { type: "boolean" },
  json: { type: "boolean" },
  note: { type: "string" },
  reason: { type: "string" },
  yes: { type: "boolean" },
  help: { type: "boolean", short: "h" },
  version: { type: "boolean", short: "v" },
} as const;

/** Options each command accepts besides --json, --help and --version. */
const COMMAND_OPTIONS: Readonly<Record<string, readonly string[]>> = {
  init: ["stage", "dry-run"],
  status: [],
  doctor: [],
  gate: ["note", "reason", "yes"],
};

const isGate = (value: string): value is GateName =>
  (GATE_NAMES as readonly string[]).includes(value);

/** node:util parseArgs with strict: true and allowPositionals: true; path defaults to "."; unknown option,
 * unknown command, unknown gate or extra positional -> UsageError (exit 2). */
export function parseCliArgs(argv: readonly string[]): ParsedCommand | UsageError {
  const json = argv.includes("--json");
  let parsed: ReturnType<typeof parseArgs<{ options: typeof OPTIONS; allowPositionals: true }>>;
  try {
    parsed = parseArgs({ args: [...argv], options: OPTIONS, allowPositionals: true, strict: true });
  } catch (error) {
    return new UsageError(error instanceof Error ? error.message : String(error), json);
  }
  const { values, positionals } = parsed;
  if (values.help === true) return { command: "help" };
  if (values.version === true) return { command: "version" };
  const [name, ...rest] = positionals;
  if (name === undefined) return { command: "help" };
  const allowed = COMMAND_OPTIONS[name];
  if (allowed === undefined) return new UsageError(`Unknown command "${name}".`, json);
  for (const option of ["stage", "dry-run", "note", "reason", "yes"] as const) {
    if (values[option] !== undefined && !allowed.includes(option)) {
      return new UsageError(`Option --${option} is not valid for "${name}".`, json);
    }
  }
  const extra = (max: number): UsageError | null =>
    rest.length > max ? new UsageError(`Unexpected argument "${rest[max]}".`, json) : null;

  if (name === "gate") {
    const [gate, decision, path] = rest;
    const tooMany = extra(3);
    if (tooMany !== null) return tooMany;
    if (gate === undefined || !isGate(gate)) {
      return new UsageError(`Unknown gate "${gate ?? ""}". Gates: ${GATE_NAMES.join(", ")}`, json);
    }
    if (decision !== "approve" && decision !== "reject") {
      return new UsageError(`Expected "approve" or "reject" after the gate name.`, json);
    }
    return {
      command: "gate",
      path: path ?? ".",
      gate,
      decision,
      note: values.note ?? null,
      reason: values.reason ?? null,
      yes: values.yes === true,
      json,
    };
  }
  const tooMany = extra(1);
  if (tooMany !== null) return tooMany;
  const path = rest[0] ?? ".";
  if (name === "init") {
    return {
      command: "init",
      path,
      stage: values.stage ?? null,
      dryRun: values["dry-run"] === true,
      json,
    };
  }
  return { command: name === "status" ? "status" : "doctor", path, json };
}
