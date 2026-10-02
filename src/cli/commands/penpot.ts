import { runPenpotLink, runPenpotInspect } from "../../app/penpot.ts";
import { runPenpotSync } from "../../app/penpot-sync.ts";
import { runPenpotDoctor } from "../../app/penpot-doctor.ts";
import {
  parseOptions,
  unexpectedArgument,
  UsageError,
  type CommandSpec,
  type PenpotParsed,
} from "../command.ts";
import { emitResult } from "../output.ts";
import {
  escapePenpotText,
  renderPenpotDoctorText,
  renderPenpotFindings,
  renderPenpotInspectText,
  renderPenpotLinkText,
  renderPenpotSyncText,
} from "../render-penpot.ts";

const ACTIONS: readonly PenpotParsed["action"][] = ["link", "doctor", "inspect", "sync"];
export const penpotCommand: CommandSpec<PenpotParsed> = {
  name: "penpot",
  usage: [
    "  penpot link [path] [--file-id <uuid>] [--json]",
    "      Bind this workspace to the Penpot file open in the connected tab (Penpot at PENPOT_URL)",
    "  penpot doctor [path] [--json]",
    "      Check the link, PENPOT_URL, the MCP key, the MCP handshake, the connected plugin, the bound file and the Penpot version",
    "  penpot inspect [path] [--json]",
    "      List the pages Heron manages in the connected Penpot file (read-only)",
    "  penpot sync [path] [--proposals] [--references] [--dry-run] [--json]",
    "      Write the direction proposal pages and/or the References page to the bound Penpot file",
  ],
  parse(args, json) {
    const action = ACTIONS.find((candidate) => candidate === args[0]);
    if (action === undefined)
      return new UsageError(
        `Unknown penpot command "${args[0] ?? ""}". Expected: ${ACTIONS.join(", ")}.`,
        json,
      );
    const parsed = parseOptions(
      args.slice(1),
      action === "link"
        ? { "file-id": { type: "string" } }
        : action === "sync"
          ? {
              proposals: { type: "boolean" },
              references: { type: "boolean" },
              "dry-run": { type: "boolean" },
            }
          : {},
      json,
    );
    if (parsed instanceof UsageError) return parsed;
    const extra = unexpectedArgument(parsed.positionals, 1, json);
    if (extra !== null) return extra;
    const base = { command: "penpot" as const, path: parsed.positionals[0] ?? ".", json };
    if (action === "link") {
      const fileId = parsed.values["file-id"];
      if (
        fileId !== undefined &&
        (typeof fileId !== "string" ||
          !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(fileId))
      )
        return new UsageError("--file-id must be a UUID.", json);
      return { ...base, action, fileId: typeof fileId === "string" ? fileId : null };
    }
    if (action === "sync") {
      const proposals = parsed.values.proposals === true;
      const references = parsed.values.references === true;
      if (!proposals && !references)
        return new UsageError(
          "Pass --proposals and/or --references (the full system sync arrives with P6).",
          json,
        );
      return { ...base, action, proposals, references, dryRun: parsed.values["dry-run"] === true };
    }
    return { ...base, action };
  },
  async handle(parsed, ctx, io) {
    const base = {
      json: parsed.json,
      started: performance.now(),
      runId: ctx.ids.runId(ctx.clock.now()),
    };
    const terminalIo = parsed.json
      ? io
      : { ...io, stderr: (text: string) => io.stderr(`${escapePenpotText(text.trimEnd())}\n`) };
    switch (parsed.action) {
      case "link":
        return emitResult(
          terminalIo,
          {
            ...base,
            command: "penpot link",
            render: (data, findings) => renderPenpotFindings(renderPenpotLinkText(data), findings),
          },
          await runPenpotLink(ctx, { path: parsed.path, fileId: parsed.fileId }),
        );
      case "inspect":
        return emitResult(
          terminalIo,
          {
            ...base,
            command: "penpot inspect",
            render: (data, findings) =>
              renderPenpotFindings(renderPenpotInspectText(data), findings),
          },
          await runPenpotInspect(ctx, { path: parsed.path }),
        );
      case "doctor":
        return emitResult(
          terminalIo,
          {
            ...base,
            command: "penpot doctor",
            render: renderPenpotDoctorText,
            renderFailedData: true,
          },
          await runPenpotDoctor(ctx, { path: parsed.path }),
        );
      case "sync":
        return emitResult(
          terminalIo,
          {
            ...base,
            command: "penpot sync",
            render: (data, findings) =>
              renderPenpotFindings(renderPenpotSyncText(data, parsed.path), findings),
            renderFailedData: true,
          },
          await runPenpotSync(ctx, {
            path: parsed.path,
            proposals: parsed.proposals,
            references: parsed.references,
            dryRun: parsed.dryRun,
          }),
        );
    }
  },
};
