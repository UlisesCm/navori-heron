import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";

export type FakeMcpOptions = {
  missingTool?: boolean;
  noTools?: boolean;
  httpDelayMs?: number;
  text?: string;
  isError?: boolean;
  imageContent?: boolean;
  delayMs?: number;
  status?: number;
  redirect?: string;
};
export type FakeMcpServer = {
  baseUrl: string;
  requests: { method: string; url: string; body: string }[];
  scripts: string[];
  stop(): Promise<void>;
};
/** Actual SDK server on ephemeral loopback; all recorded keys in tests must be SYNTHETIC. */
export async function startFakeMcp(options: FakeMcpOptions = {}): Promise<FakeMcpServer> {
  const requests: FakeMcpServer["requests"] = [];
  const scripts: string[] = [];
  const server = new McpServer({ name: "SYNTHETIC-penpot", version: "1.0.0" });
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: () => "SYNTHETIC-session",
    enableJsonResponse: true,
  });
  if (options.missingTool)
    server.registerTool("high_level_overview", {}, async () => ({
      content: [{ type: "text", text: "SYNTHETIC overview" }],
    }));
  else if (!options.noTools)
    server.registerTool("execute_code", { inputSchema: { code: z.string() } }, async ({ code }) => {
      scripts.push(code);
      if (options.delayMs)
        await new Promise<void>((resolve) => setTimeout(resolve, options.delayMs));
      return {
        content: options.imageContent
          ? [{ type: "image", data: "AA==", mimeType: "image/png" }]
          : [
              {
                type: "text",
                text: options.text ?? JSON.stringify({ result: { ok: 1 }, log: "" }),
              },
            ],
        ...(options.isError === undefined ? {} : { isError: options.isError }),
      };
    });
  await server.connect(transport);
  const http = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      requests.push({
        method: request.method,
        url: request.url,
        body: await request.clone().text(),
      });
      if (options.httpDelayMs)
        await new Promise<void>((resolve) => setTimeout(resolve, options.httpDelayMs));
      if (options.redirect)
        return new Response(null, { status: 302, headers: { location: options.redirect } });
      if (options.status)
        return new Response(`SYNTHETIC HTTP failure ${request.url}`, { status: options.status });
      if (request.method === "GET") return new Response(null, { status: 405 });
      return transport.handleRequest(request);
    },
  });
  return {
    baseUrl: `http://127.0.0.1:${http.port}`,
    requests,
    scripts,
    async stop() {
      await server.close();
      await http.stop(true);
    },
  };
}
