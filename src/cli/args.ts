import { availableReferenceSources } from "../app/references.ts";
import {
  AGENT_ROLES,
  BRAND_KINDS,
  BRAND_ORIGINS,
  GATE_NAMES,
  RESEARCH_FACETS,
} from "../core/contracts/index.ts";
import { UsageError, type CommandName, type CommandSpec, type ParsedCommand } from "./command.ts";
import { COMMANDS } from "./commands/index.ts";

/** Order: [] -> help; any "-h"/"--help" -> help; any "-v"/"--version" -> version; the command is the first token not
 * starting with "-" and only "--json" may precede it (else UsageError); unknown name -> UsageError; else the
 * command's own parser gets the rest. json = argv includes "--json". */
export function parseCliArgs(
  argv: readonly string[],
  commands: readonly CommandSpec[] = COMMANDS,
): ParsedCommand | UsageError {
  const json = argv.includes("--json");
  if (argv.some((token) => token === "-h" || token === "--help")) return { command: "help" };
  if (argv.some((token) => token === "-v" || token === "--version")) return { command: "version" };
  const at = argv.findIndex((token) => !token.startsWith("-"));
  const leading = at === -1 ? argv : argv.slice(0, at);
  const stray = leading.find((token) => token !== "--json");
  if (stray !== undefined) return new UsageError(`Unknown option "${stray}".`, json);
  const name = argv[at];
  if (name === undefined) return { command: "help" };
  const spec = commands.find((candidate) => candidate.name === name);
  if (spec === undefined) return new UsageError(`Unknown command "${name}".`, json);
  return spec.parse(argv.slice(at + 1), json);
}

export function commandFor(
  name: CommandName,
  commands: readonly CommandSpec[] = COMMANDS,
): CommandSpec {
  const spec = commands.find((candidate) => candidate.name === name);
  if (spec === undefined) throw new Error(`Command "${name}" is not registered.`);
  return spec;
}

/** "Usage: heron <command> [options]\n\nCommands:\n" + every spec.usage line + "\n" + footer. */
export const USAGE_TEXT: string = `Usage: heron <command> [options]

Commands:
${COMMANDS.flatMap((spec) => spec.usage).join("\n")}

Gates: ${GATE_NAMES.join(", ")}
Reference sources: ${availableReferenceSources().join(", ")}
Brand kinds: ${BRAND_KINDS.join(", ")}
Brand origins: ${BRAND_ORIGINS.join(", ")}
Research facets: ${RESEARCH_FACETS.join(", ")}
Agent roles: ${AGENT_ROLES.join(", ")} (configured in .heron/project.json "agents"; see docs/agent-providers.md)
Penpot: set PENPOT_URL and PENPOT_MCP_KEY or PENPOT_MCP_KEY_FILE in your shell; Heron never reads them from a .env file (see docs/penpot.md)

Options:
  -h, --help     Show this help
  -v, --version  Show the Heron version
`;
