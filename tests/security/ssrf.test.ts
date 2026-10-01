// Covers: R9
import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ExitCode, type CliEnvelope } from "../../src/core/contracts/index.ts";
import { createSafeFetcher } from "../../src/security/fetch/safe-fetch.ts";
import { fixedContext, runCliCaptured } from "../helpers/cli.ts";
import { e2eSetup } from "../helpers/e2e.ts";
import { hashTree } from "../helpers/fixtures.ts";
import {
  addrs,
  fakeResolver,
  readReferences,
  recordingTransport,
  referenceArgs,
  serveLocal,
  systemFetcher,
} from "../helpers/research.ts";

const { initialized } = e2eSetup();
const servers: { stop: () => void }[] = [];
afterEach(() => {
  for (const server of servers.splice(0)) server.stop();
});

const PUBLIC = "93.184.216.34";
const urlArgs = (root: string, url: string, ...extra: string[]): string[] => [
  ...referenceArgs(root, ["source", "origin"]),
  "--source",
  "url",
  "--url",
  url,
  ...extra,
];

/** Fetcher over a fake resolver and a recording transport: nothing leaves the process. */
function sandbox(
  table: Parameters<typeof fakeResolver>[0],
  reply: Parameters<typeof recordingTransport>[0] = {},
  timeoutMs?: number,
) {
  const transport = recordingTransport(reply);
  const fetcher = createSafeFetcher({
    resolver: fakeResolver(table),
    transport,
    userAgent: "Heron/test",
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
  });
  return { transport, ctx: fixedContext({ fetcher }) };
}

describe("SSRF policy through heron references add", () => {
  test("blocks every vector of the SSRF corpus and records explicit local allowances", async () => {
    const root = await initialized("no-ux");
    const before = hashTree(root, { exclude: [] });
    const table = {
      "internal.example": [addrs("10.0.0.5")],
      "mixed.example": [addrs(PUBLIC, "192.168.0.9")],
      "v6.example": [addrs("fd12:3456::1")],
      "meta.example": [addrs("169.254.169.254")],
    };
    const literals = [
      "https://localhost/",
      "https://127.0.0.1/",
      "https://[::1]/",
      "https://10.0.0.1/",
      "https://172.16.0.1/",
      "https://172.31.255.255/",
      "https://192.168.1.1/",
      "https://100.64.0.1/",
      "https://169.254.169.254/latest/meta-data",
      "https://[fc00::1]/",
      "https://[fd12:3456::1]/",
      "https://[fe80::1]/",
      "https://[::ffff:127.0.0.1]/",
      "https://[::ffff:8.8.8.8]/",
      "https://2130706433/",
      "https://0177.0.0.1/",
      "https://0x7f000001/",
      "https://0x7f.1/",
      "https://127.1/",
      "https://%31%32%37.0.0.1/",
      "https://0.0.0.0/",
      "https://[::]/",
      "file:///etc/passwd",
      "ftp://example.com/",
      "gopher://example.com/",
      "data:text/html,hello",
      "http://example.com/",
      "https://internal.example/",
      "https://mixed.example/",
      "https://v6.example/",
      "https://meta.example/",
    ];
    for (const url of literals) {
      const { transport, ctx } = sandbox({ ...table, "example.com": [addrs(PUBLIC)] });
      const run = await runCliCaptured(urlArgs(root, url), ctx);
      expect({ url, code: run.code }).toEqual({ url, code: ExitCode.Blocked });
      expect(run.stderr).toStartWith("Blocked ");
      expect({ url, calls: transport.calls.length }).toEqual({ url, calls: 0 });
      expect(hashTree(root, { exclude: [] })).toEqual(before);
    }

    // Redirects and DNS rebinding: only the pinned public address is ever contacted.
    const redirects: [string, string][] = [
      ["to an IP", "http://127.0.0.1/admin"],
      ["to a private name", "https://internal.example/"],
      ["to metadata", "https://169.254.169.254/"],
    ];
    for (const [label, location] of redirects) {
      const { transport, ctx } = sandbox(
        { ...table, "start.example": [addrs(PUBLIC)] },
        { status: 302, location },
      );
      const run = await runCliCaptured(urlArgs(root, "https://start.example/"), ctx);
      expect({ label, code: run.code }).toEqual({ label, code: ExitCode.Blocked });
      expect(run.stderr).toContain("redirect 1 to");
      expect(transport.calls.map((call) => call.url)).toEqual([`https://${PUBLIC}/`]);
    }
    const rebind = sandbox(
      { "rebind.example": [[...addrs(PUBLIC)], [...addrs("10.0.0.1")]] },
      { status: 302, location: "https://rebind.example/next" },
    );
    const rebound = await runCliCaptured(urlArgs(root, "https://rebind.example/"), rebind.ctx);
    expect(rebound.code).toBe(ExitCode.Blocked);
    expect(rebind.transport.calls.map((call) => call.url)).toEqual([`https://${PUBLIC}/`]);
    const loop = sandbox(
      { "loop.example": [addrs(PUBLIC)] },
      { status: 302, location: "https://loop.example/" },
    );
    const looped = await runCliCaptured(urlArgs(root, "https://loop.example/"), loop.ctx);
    expect(looped.code).toBe(ExitCode.DependencyUnavailable);
    expect(looped.stderr).toContain("more than 3 redirects");
    expect(hashTree(root, { exclude: [] })).toEqual(before);

    // D29: any port over https is fine and is pinned to the public address; http stays blocked even with --allow-local.
    const ported = sandbox({ "example.com": [addrs(PUBLIC)] });
    const ok = await runCliCaptured(urlArgs(root, "https://example.com:8443/x"), ported.ctx);
    expect(ok.code).toBe(ExitCode.Ok);
    expect(ported.transport.calls.map((call) => call.url)).toEqual([`https://${PUBLIC}:8443/x`]);
    const plain = sandbox({ "example.com": [addrs(PUBLIC)] });
    const http = await runCliCaptured(
      urlArgs(root, "http://example.com/", "--allow-local"),
      plain.ctx,
    );
    expect(http.code).toBe(ExitCode.Blocked);
    expect(plain.transport.calls).toEqual([]);

    // --allow-local against a real loopback server: recorded in both documents; always an explicit opt-in.
    const server = serveLocal(
      () => new Response("<h1>local</h1>", { headers: { "content-type": "text/html" } }),
    );
    servers.push(server);
    const live = fixedContext({ fetcher: systemFetcher });
    const refused = await runCliCaptured(urlArgs(root, `${server.url}/`), live);
    expect(refused.code).toBe(ExitCode.Blocked);
    const allowed = await runCliCaptured(urlArgs(root, `${server.url}/`, "--allow-local"), live);
    expect(allowed.code).toBe(ExitCode.Ok);
    const added = readReferences(root).references.at(-1);
    expect(added?.capture).toMatchObject({ kind: "url", fetch: { local: true } });
    expect(added?.securityFindings.map((finding) => finding.code)).toEqual([
      "LOCAL_TARGET_ALLOWED",
    ]);
    const provenance = JSON.parse(
      readFileSync(join(root, ".heron", "research", "provenance.json"), "utf8"),
    ) as { entries: { fetch: { local: boolean } | null; securityFindings: { code: string }[] }[] };
    expect(provenance.entries.at(-1)?.fetch?.local).toBe(true);
    expect(provenance.entries.at(-1)?.securityFindings.map((finding) => finding.code)).toEqual([
      "LOCAL_TARGET_ALLOWED",
    ]);
    expect(allowed.stdout).toContain("- LOCAL_TARGET_ALLOWED: Fetched 127.0.0.1 (loopback)");

    // Metadata and mapped loopback stay blocked even with the flag.
    for (const url of ["http://169.254.169.254/", `http://[::ffff:127.0.0.1]:${server.port}/`]) {
      const run = await runCliCaptured(urlArgs(root, url, "--allow-local"), live);
      expect({ url, code: run.code }).toEqual({ url, code: ExitCode.Blocked });
    }
    const json = await runCliCaptured(
      urlArgs(root, `${server.url}/`, "--allow-local", "--json"),
      live,
    );
    expect((JSON.parse(json.stdout) as CliEnvelope).findings).toEqual([]);
  });

  test("times out and caps the body", async () => {
    const root = await initialized("no-ux");
    const before = hashTree(root, { exclude: [] });
    const slow = sandbox({ "example.com": [addrs(PUBLIC)] }, "hang", 50);
    const timeout = await runCliCaptured(urlArgs(root, "https://example.com/"), slow.ctx);
    expect(timeout.code).toBe(ExitCode.DependencyUnavailable);
    expect(timeout.stderr).toBe("Could not fetch https://example.com/: timed out after 50 ms.\n");

    const big = sandbox({ "example.com": [addrs(PUBLIC)] }, { overflow: true });
    const overflow = await runCliCaptured(urlArgs(root, "https://example.com/"), big.ctx);
    expect(overflow.code).toBe(ExitCode.Usage);
    expect(overflow.stderr).toContain("exceeds");

    // A 5 MB gzip bomb of zeros is counted after decoding and stopped at the 2 MiB limit.
    const bomb = Bun.gzipSync(new Uint8Array(5 * 1024 * 1024));
    const server = serveLocal(
      () =>
        new Response(bomb, {
          headers: { "content-type": "text/plain", "content-encoding": "gzip" },
        }),
    );
    servers.push(server);
    const run = await runCliCaptured(
      urlArgs(root, `${server.url}/`, "--allow-local"),
      fixedContext({ fetcher: systemFetcher }),
    );
    expect(run.code).toBe(ExitCode.Usage);
    expect(run.stderr).toContain("exceeds 2097152 bytes");
    expect(hashTree(root, { exclude: [] })).toEqual(before);
  });
});
