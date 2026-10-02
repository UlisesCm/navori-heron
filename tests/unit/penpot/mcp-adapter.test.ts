// Covers: R4, R6, R7, R17, R19
import { describe, expect, test } from "bun:test";
import { defaultPenpotGateway } from "../../../src/penpot/registry.ts";
import type { PenpotConnectOutcome, PenpotConnectRequest } from "../../../src/penpot/ports.ts";
import { createValueRedactor } from "../../../src/security/redact.ts";
import { mcpFetch } from "../../../src/security/fetch/system.ts";
import { startFakeMcp, type FakeMcpOptions } from "../../helpers/fake-mcp.ts";

const key = "SYNTHETIC +&secret-key";
const request = (baseUrl: string, timeoutMs = 1000): PenpotConnectRequest => ({
  baseUrl,
  key,
  timeoutMs,
  clientVersion: "0.1.0",
  redact: (text) => createValueRedactor({}, [key]).redact(text).text,
});
function connected(result: PenpotConnectOutcome): Extract<PenpotConnectOutcome, { ok: true }> {
  if (!result.ok)
    throw new Error(`connect failed: ${result.failure.kind}: ${result.failure.detail}`);
  return result;
}

// Real loopback HTTP, SDK initialization and cleanup; 10s allows scheduler variance without remote dependencies.
describe("MCP adapter", () => {
  test("runs execute_code over streamable HTTP with the userToken only in the request URL", async () => {
    const fake = await startFakeMcp();
    let result: PenpotConnectOutcome | undefined;
    try {
      result = await defaultPenpotGateway.connect(request(fake.baseUrl));
      const connection = connected(result);
      expect(connection.server).toEqual({ name: "SYNTHETIC-penpot", version: "1.0.0" });
      expect(await connection.runner.execute("return { ok: 1 };", 1000)).toMatchObject({
        ok: true,
        text: '{"result":{"ok":1},"log":""}',
      });
      expect(fake.scripts).toEqual(["return { ok: 1 };"]);
      for (const received of fake.requests) {
        const url = new URL(received.url);
        expect(url.pathname).toBe("/mcp/stream");
        expect(url.searchParams.get("userToken")).toBe(key);
        expect(received.body).not.toContain(key);
        expect(received.body).not.toContain(encodeURIComponent(key));
      }
    } finally {
      if (result?.ok) await result.runner.close();
      await fake.stop();
    }
  }, 10000);

  test("classifies missing plugin, rejected key, timeouts, unknown formats and script errors", async () => {
    const options: FakeMcpOptions = {};
    const fake = await startFakeMcp(options);
    let result: PenpotConnectOutcome | undefined;
    try {
      result = await defaultPenpotGateway.connect(request(fake.baseUrl));
      const runner = connected(result).runner;
      const cases = [
        [
          "Tool execution failed: No Penpot instance connected for user token",
          "plugin-not-connected",
        ],
        [
          "Tool execution failed: No Penpot plugin instances are currently connected",
          "plugin-not-connected",
        ],
        ["Tool execution failed: incompatible with the connected Penpot version", "incompatible"],
        ["Tool execution failed: SYNTHETIC script problem", "script-failed"],
        ["not JSON", "incompatible"],
        ["{}", "incompatible"],
      ] as const;
      for (const [text, kind] of cases) {
        options.text = text;
        expect(await runner.execute("return 1;", 1000)).toMatchObject({
          ok: false,
          failure: { kind },
        });
      }
      options.text = `Tool execution failed: ${key} ${"x".repeat(800)}`;
      const redacted = await runner.execute("return 1;", 1000);
      expect(JSON.stringify(redacted)).not.toContain(key);
      if (redacted.ok) throw new Error("script failure expected");
      expect(redacted.failure.detail.length).toBeLessThanOrEqual(500);
      options.isError = true;
      options.text = JSON.stringify({ result: { ok: 1 }, log: "" });
      expect(await runner.execute("return 1;", 1000)).toMatchObject({
        ok: false,
        failure: { kind: "script-failed" },
      });
      options.isError = false;
      options.imageContent = true;
      expect(await runner.execute("return 1;", 1000)).toMatchObject({
        ok: false,
        failure: { kind: "incompatible" },
      });
      options.imageContent = false;
      options.delayMs = 300;
      expect(await runner.execute("return 1;", 30)).toMatchObject({
        ok: false,
        failure: { kind: "timeout" },
      });
      options.delayMs = 0;
      options.status = 403;
      expect(await runner.execute("return 1;", 1000)).toMatchObject({
        ok: false,
        failure: { kind: "rejected" },
      });
    } finally {
      if (result?.ok) await result.runner.close();
      await fake.stop();
    }
    for (const status of [401, 403, 500]) {
      const refused = await startFakeMcp({ status });
      try {
        const outcome = await defaultPenpotGateway.connect(request(refused.baseUrl));
        expect(outcome).toMatchObject({
          ok: false,
          failure: { kind: status === 500 ? "unreachable" : "rejected" },
        });
        expect(JSON.stringify(outcome)).not.toContain(key);
      } finally {
        await refused.stop();
      }
    }
    for (const config of [{ missingTool: true }, { noTools: true }]) {
      const missing = await startFakeMcp(config);
      try {
        expect(await defaultPenpotGateway.connect(request(missing.baseUrl))).toMatchObject({
          ok: false,
          failure: { kind: "incompatible" },
        });
      } finally {
        await missing.stop();
      }
    }
  }, 10000);

  test("bounds initialization with the connection deadline", async () => {
    const delayed = await startFakeMcp({ httpDelayMs: 100 });
    try {
      expect(await defaultPenpotGateway.connect(request(delayed.baseUrl, 20))).toMatchObject({
        ok: false,
        failure: { kind: "timeout" },
      });
    } finally {
      await delayed.stop();
    }
  }, 10000);

  test("redacts the key from transport errors of an unreachable endpoint", async () => {
    const fake = await startFakeMcp();
    const baseUrl = fake.baseUrl;
    await fake.stop();
    const result = await defaultPenpotGateway.connect(request(baseUrl));
    expect(result).toMatchObject({ ok: false, failure: { kind: "unreachable" } });
    expect(JSON.stringify(result)).not.toContain(key);
    expect(JSON.stringify(result)).not.toContain(encodeURIComponent(key));
  }, 10000);

  test("blocks redirects before a second host receives any request", async () => {
    const destination = await startFakeMcp();
    const redirect = await startFakeMcp({ redirect: destination.baseUrl });
    try {
      expect(await defaultPenpotGateway.connect(request(redirect.baseUrl))).toMatchObject({
        ok: false,
        failure: { kind: "unreachable" },
      });
      expect(destination.requests).toEqual([]);
      await expect(
        mcpFetch(`${redirect.baseUrl}/mcp/stream?userToken=SYNTHETIC`, { redirect: "follow" }),
      ).rejects.toThrow();
      expect(destination.requests).toEqual([]);
    } finally {
      await redirect.stop();
      await destination.stop();
    }
  }, 10000);
});
