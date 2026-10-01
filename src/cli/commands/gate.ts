import { runGate } from "../../app/gate.ts";
import { GATE_NAMES, type GateName } from "../../core/contracts/index.ts";
import {
  UsageError,
  parseOptions,
  unexpectedArgument,
  type CommandSpec,
  type GateParsed,
} from "../command.ts";
import { emitResult } from "../output.ts";
import { renderFindings, renderGateText } from "../render.ts";

const isGate = (value: string): value is GateName =>
  (GATE_NAMES as readonly string[]).includes(value);

export const gateCommand: CommandSpec<GateParsed> = {
  name: "gate",
  usage: [
    "  gate <gate> approve|reject [path] [--note <text>] [--reason <text>] [--yes] [--json]",
    "      Record a human gate decision bound to artifact hashes",
  ],
  parse(args, json) {
    const parsed = parseOptions(
      args,
      { note: { type: "string" }, reason: { type: "string" }, yes: { type: "boolean" } },
      json,
    );
    if (parsed instanceof UsageError) return parsed;
    const [gate, decision, path] = parsed.positionals;
    const tooMany = unexpectedArgument(parsed.positionals, 3, json);
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
      note: parsed.values.note ?? null,
      reason: parsed.values.reason ?? null,
      yes: parsed.values.yes === true,
      json,
    };
  },
  async handle(parsed, ctx, io) {
    const started = performance.now();
    const result = await runGate(ctx, {
      path: parsed.path,
      gate: parsed.gate,
      decision: parsed.decision,
      note: parsed.note,
      reason: parsed.reason,
      yes: parsed.yes,
    });
    return emitResult(
      io,
      {
        command: "gate",
        json: parsed.json,
        started,
        runId: ctx.ids.runId(ctx.clock.now()),
        render: (data, findings) => {
          const text = renderGateText(data, ctx.identity.current()?.trim() ?? "");
          const warnings = renderFindings(findings);
          return warnings === "" ? text : `${text}\n\n${warnings}`;
        },
      },
      result,
    );
  },
};
