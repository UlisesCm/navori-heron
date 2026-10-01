// Covers: R9
import { afterAll, describe, expect, test } from "bun:test";
import { bunTransport, systemResolver } from "../../../src/security/fetch/system.ts";
import type { TransportRequest } from "../../../src/security/fetch/types.ts";

// Real sockets, but only against 127.0.0.1 (the sandbox boundary of the SSRF tests); explicit timeouts below.
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch(request) {
    const { pathname } = new URL(request.url);
    if (pathname === "/redirect")
      return new Response(null, {
        status: 302,
        headers: { location: "/final" },
      });
    if (pathname === "/host")
      return new Response(request.headers.get("host") ?? "", {
        headers: { "content-type": "text/plain" },
      });
    if (pathname === "/big")
      return new Response("x".repeat(5_000), {
        headers: { "content-type": "text/html" },
      });
    if (pathname === "/empty") return new Response(null, { status: 204 });
    if (pathname === "/slow") return new Promise<Response>(() => {});
    return new Response("hello", {
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  },
});
afterAll(() => void server.stop(true));

const request = (path: string, extra: Partial<TransportRequest> = {}): TransportRequest => ({
  url: `http://127.0.0.1:${server.port}${path}`,
  hostHeader: "example.test",
  serverName: null,
  headers: {
    accept: "*/*",
    "accept-encoding": "identity",
    "user-agent": "Heron/test",
  },
  maxBytes: 1024,
  ...extra,
});
const signal = (): AbortSignal => AbortSignal.timeout(5_000);

describe("bunTransport", () => {
  test("reads status, headers and the body without following redirects", async () => {
    const ok = await bunTransport.send(request("/"), signal());
    expect(ok).toMatchObject({
      status: 200,
      location: null,
      contentType: "text/html; charset=utf-8",
      overflow: false,
    });
    expect(new TextDecoder().decode(ok.body)).toBe("hello");
    const moved = await bunTransport.send(request("/redirect"), signal());
    expect(moved).toMatchObject({ status: 302, location: "/final" });
    const host = await bunTransport.send(request("/host"), signal());
    expect(new TextDecoder().decode(host.body)).toBe("example.test");
    const empty = await bunTransport.send(request("/empty"), signal());
    expect(empty).toMatchObject({ status: 204, overflow: false });
    expect(empty.body.byteLength).toBe(0);
  }, 10_000);

  test("stops reading once the limit is exceeded and passes the SNI name", async () => {
    const big = await bunTransport.send(request("/big"), signal());
    expect(big).toMatchObject({ status: 200, overflow: true });
    expect(big.body.byteLength).toBe(0);
    const withName = await bunTransport.send(
      request("/", { serverName: "example.test" }),
      signal(),
    );
    expect(withName.status).toBe(200);
  }, 10_000);

  test("rejects when the signal aborts", async () => {
    await expect(
      bunTransport.send(request("/slow"), AbortSignal.timeout(50)),
    ).rejects.toBeDefined();
  }, 5_000);
});

describe("systemResolver", () => {
  test("resolves localhost to loopback addresses and honors an aborted signal", async () => {
    const records = await systemResolver.resolve("localhost", signal());
    expect(records.length).toBeGreaterThan(0);
    for (const record of records) {
      expect([4, 6]).toContain(record.family);
      expect(["127.0.0.1", "::1"]).toContain(record.address);
    }
    await expect(systemResolver.resolve("localhost", AbortSignal.abort())).rejects.toBeDefined();
    await expect(systemResolver.resolve("nonexistent.invalid", signal())).rejects.toBeDefined();
  }, 15_000);
});
