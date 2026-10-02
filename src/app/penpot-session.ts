import { ExitCode, type FindingCode, type RunId } from "../core/contracts/index.ts";
import { openAppendLog } from "../core/store/append-log.ts";
import { PENPOT_TESTED_VERSIONS } from "../penpot/compatibility.ts";
import type { PenpotFailure, PenpotSession } from "../penpot/ports.ts";
import { openPenpotSession } from "../penpot/session.ts";
import { createLogger, type Logger } from "../security/logger.ts";
import type { AppContext } from "./context.ts";
import { penpotRedactor } from "./penpot-config.ts";
import { failure, makeFinding, type UseCaseResult } from "./result.ts";

const FAILURE_CODES: Record<PenpotFailure["kind"], FindingCode> = {
  unreachable: "PENPOT_UNREACHABLE",
  rejected: "PENPOT_KEY_REJECTED",
  incompatible: "PENPOT_MCP_INCOMPATIBLE",
  "plugin-not-connected": "PENPOT_PLUGIN_NOT_CONNECTED",
  timeout: "PENPOT_TIMEOUT",
  "script-failed": "PENPOT_SCRIPT_FAILED",
};

/** Map a sanitized session failure consistently in link/inspect/sync/doctor. */
export function penpotFailureResult<T>(
  error: PenpotFailure,
  options: { template: string | null; timeoutMs: number },
): UseCaseResult<T> {
  let message: string;
  switch (error.kind) {
    case "unreachable":
      message = `Penpot MCP at PENPOT_URL did not answer: ${error.detail}.`;
      break;
    case "rejected": {
      const status = /\bHTTP\s*(401|403)\b/i.exec(error.detail)?.[1] ?? "401/403";
      message = `Penpot rejected the MCP key (HTTP ${status}); create a new key in Your account → Integrations → MCP Server.`;
      break;
    }
    case "incompatible":
      message = `The Penpot MCP server does not offer execute_code or answered in an unknown format (${error.detail}); tested Penpot versions: ${PENPOT_TESTED_VERSIONS.join(", ")}.`;
      break;
    case "plugin-not-connected":
      message =
        "No Penpot tab is connected to MCP for this key. Open the bound file in Penpot and press Main menu → MCP Server → Connect (one tab only); check that the key matches.";
      break;
    case "timeout":
      message = `Penpot did not answer within ${options.timeoutMs} ms; keep the Penpot tab in the foreground and try again.`;
      break;
    case "script-failed":
      message = `The ${options.template ?? "MCP"} script failed in Penpot: ${error.detail}.`;
      break;
  }
  return failure(
    ExitCode.DependencyUnavailable,
    makeFinding(FAILURE_CODES[error.kind], "error", message),
  );
}

/** Logging needs an explicit destination from the loaded workspace, never the process working directory. */
export type PenpotSessionInput = {
  baseUrl: string;
  key: string;
  command: string;
  runId: RunId;
} & ({ log: false } | { log: true; heronDir: string });

/** Connect outside any lock, observe each operation, and close in finally. Read-only probes never open a log. */
export async function withPenpotSession<T>(
  ctx: AppContext,
  input: PenpotSessionInput,
  fn: (session: PenpotSession) => Promise<UseCaseResult<T>>,
): Promise<UseCaseResult<T>> {
  const redact = penpotRedactor(ctx, input.key);
  let logger: Logger | null = null;
  let logged = false;
  const sanitize = (error: PenpotFailure): PenpotFailure => ({
    kind: error.kind,
    detail: redact(error.detail).slice(0, 500),
  });
  const observe = (
    errorInput: PenpotFailure,
    template: string | null,
    started: number,
  ): PenpotFailure => {
    const error = sanitize(errorInput);
    if (input.log && !logged) {
      logged = true;
      logger ??= createLogger(
        [
          openAppendLog(ctx.fs, input.heronDir, ctx.clock.now(), {
            retentionDays: ctx.logRetentionDays,
          }),
        ],
        { redact: (text: string) => ({ text: redact(text), count: 0 }) },
        ctx.clock,
      );
      logger.event("penpot.error", {
        runId: input.runId,
        command: input.command,
        kind: error.kind,
        template,
        durationMs: Math.max(0, ctx.clock.now().getTime() - started),
        detail: error.detail,
      });
    }
    return error;
  };
  const connectStarted = ctx.clock.now().getTime();
  const connected = await openPenpotSession(ctx.penpot.gateway, {
    baseUrl: input.baseUrl,
    key: input.key,
    timeoutMs: ctx.penpot.connectTimeoutMs,
    clientVersion: ctx.heronVersion,
    redact,
  });
  if (!connected.ok) {
    return penpotFailureResult(observe(connected.failure, null, connectStarted), {
      template: null,
      timeoutMs: ctx.penpot.connectTimeoutMs,
    });
  }
  const session: PenpotSession = {
    async inspect(timeoutMs) {
      const started = ctx.clock.now().getTime();
      const result = await connected.session.inspect(timeoutMs);
      return result.ok
        ? result
        : { ok: false, failure: observe(result.failure, "inspect@v1", started) };
    },
    async apply(page, targetPageId, timeoutMs) {
      const started = ctx.clock.now().getTime();
      const result = await connected.session.apply(page, targetPageId, timeoutMs);
      return result.ok
        ? result
        : { ok: false, failure: observe(result.failure, "review-page@v1", started) };
    },
    close: () => connected.session.close(),
  };
  try {
    return await fn(session);
  } catch {
    // A programming/consumer exception must not escape with a key read from a file.
    return penpotFailureResult(
      observe(
        { kind: "script-failed", detail: "Unexpected failure in the Penpot operation" },
        null,
        connectStarted,
      ),
      {
        template: null,
        timeoutMs: ctx.penpot.writeTimeoutMs,
      },
    );
  } finally {
    await connected.session.close();
  }
}
