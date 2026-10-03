import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  StreamableHTTPClientTransport,
  StreamableHTTPError,
} from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { mcpFetch } from "../../../security/fetch/system.ts";
import { mcpEndpoint } from "../../config.ts";
import type {
  PenpotConnectRequest,
  PenpotFailure,
  PenpotFailureKind,
  PenpotGateway,
} from "../../ports.ts";

/** Error causes can contain the complete URL in Bun. Redact the entire chain before capping. */
function errorText(error: unknown): string {
  const messages: string[] = [];
  const seen = new Set<unknown>();
  let current = error;
  while (current !== undefined && !seen.has(current)) {
    seen.add(current);
    messages.push(current instanceof Error ? current.message : String(current));
    current = current instanceof Error ? current.cause : undefined;
  }
  return messages.join("; ");
}
function failure(
  request: PenpotConnectRequest,
  kind: PenpotFailureKind,
  detail: string,
): PenpotFailure {
  return { kind, detail: request.redact(detail).slice(0, 500) };
}
function transportFailure(
  request: PenpotConnectRequest,
  error: unknown,
  timedOut: boolean,
): PenpotFailure {
  const detail = errorText(error);
  const timeout =
    timedOut ||
    (error instanceof Error &&
      (error.name === "TimeoutError" || ("code" in error && error.code === -32001)));
  const rejected =
    (error instanceof StreamableHTTPError && (error.code === 401 || error.code === 403)) ||
    (error instanceof Error && error.name === "UnauthorizedError");
  const incompatible =
    error instanceof Error &&
    (error.name === "ZodError" || ("code" in error && error.code === -32601));
  return failure(
    request,
    timeout ? "timeout" : rejected ? "rejected" : incompatible ? "incompatible" : "unreachable",
    detail,
  );
}
function executionKind(text: string): PenpotFailureKind {
  if (
    text.includes("No Penpot instance connected for user token") ||
    text.includes("No Penpot plugin instances are currently connected")
  )
    return "plugin-not-connected";
  if (text.includes("incompatible with the connected Penpot version")) return "incompatible";
  return "script-failed";
}
function isEnvelope(text: string): boolean {
  try {
    const value: unknown = JSON.parse(text);
    return (
      typeof value === "object" &&
      value !== null &&
      Object.hasOwn(value, "result") &&
      "log" in value &&
      typeof value.log === "string"
    );
  } catch {
    return false;
  }
}
function firstText(content: unknown): string | undefined {
  if (!Array.isArray(content)) return undefined;
  for (const entry of content) {
    const item: unknown = entry;
    if (
      typeof item === "object" &&
      item !== null &&
      "type" in item &&
      item.type === "text" &&
      "text" in item &&
      typeof item.text === "string"
    )
      return item.text;
  }
  return undefined;
}
/** Always release transport resources; a stuck close cannot delay the caller beyond two seconds. */
async function closeClient(client: Client): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      client.close().catch(() => undefined),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, 2000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export const mcpGateway: PenpotGateway = {
  id: "mcp",
  async connect(request) {
    const started = performance.now();
    const client = new Client({ name: "navori-heron", version: request.clientVersion });
    const signal = AbortSignal.timeout(request.timeoutMs);
    try {
      const transport = new StreamableHTTPClientTransport(
        mcpEndpoint(request.baseUrl, request.key),
        { fetch: mcpFetch },
      );
      // SDK 1.31.0's sessionId getter includes undefined but its Transport optional property does not.
      // This is its own transport implementation; the cast bridges only exactOptionalPropertyTypes.
      await client.connect(transport as Parameters<Client["connect"]>[0], {
        timeout: request.timeoutMs,
        signal,
      });
      const tools = await client.listTools({}, { timeout: request.timeoutMs, signal });
      if (!tools.tools.some((tool) => tool.name === "execute_code")) {
        await closeClient(client);
        return {
          ok: false,
          failure: failure(request, "incompatible", "The MCP server does not offer execute_code."),
          durationMs: performance.now() - started,
        };
      }
      const server = client.getServerVersion();
      return {
        ok: true,
        server: server
          ? {
              name: request.redact(server.name).slice(0, 200),
              version: request.redact(server.version).slice(0, 40),
            }
          : null,
        runner: {
          async execute(code, timeoutMs) {
            const begin = performance.now();
            const callSignal = AbortSignal.timeout(timeoutMs);
            try {
              const result = await client.callTool(
                { name: "execute_code", arguments: { code } },
                undefined,
                { timeout: timeoutMs, signal: callSignal },
              );
              const text = firstText(result.content);
              const durationMs = performance.now() - begin;
              if (typeof text !== "string")
                return {
                  ok: false,
                  failure: failure(
                    request,
                    "incompatible",
                    "execute_code returned no text content.",
                  ),
                  durationMs,
                };
              if (result.isError || text.startsWith("Tool execution failed:"))
                return {
                  ok: false,
                  failure: failure(request, executionKind(text), text),
                  durationMs,
                };
              if (!isEnvelope(text))
                return {
                  ok: false,
                  failure: failure(
                    request,
                    "incompatible",
                    "execute_code returned an unknown result format.",
                  ),
                  durationMs,
                };
              return { ok: true, text, durationMs };
            } catch (error: unknown) {
              return {
                ok: false,
                failure: transportFailure(request, error, callSignal.aborted),
                durationMs: performance.now() - begin,
              };
            }
          },
          close: () => closeClient(client),
        },
      };
    } catch (error: unknown) {
      await closeClient(client);
      return {
        ok: false,
        failure: transportFailure(request, error, signal.aborted),
        durationMs: performance.now() - started,
      };
    }
  },
};
