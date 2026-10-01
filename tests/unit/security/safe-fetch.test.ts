// Covers: R9
import { describe, expect, test } from "bun:test";
import { createSafeFetcher } from "../../../src/security/fetch/safe-fetch.ts";
import type { SafeFetchRequest, SafeFetchResult } from "../../../src/security/fetch/types.ts";
import {
  addrs,
  fakeResolver,
  recordingTransport,
  type TransportReply,
} from "../../helpers/research.ts";

const HTML = ["text/html"];
const PUBLIC = "93.184.216.34";
const req = (url: string, extra: Partial<SafeFetchRequest> = {}): SafeFetchRequest => ({
  url,
  accept: HTML,
  maxBytes: 1024,
  allowLocal: false,
  ...extra,
});

function setup(
  table: Parameters<typeof fakeResolver>[0] = {
    "example.com": [addrs(PUBLIC)],
  },
  reply: TransportReply | Parameters<typeof recordingTransport>[0] = {},
  timeoutMs?: number,
) {
  const resolver = fakeResolver(table);
  const transport = recordingTransport(reply);
  const fetcher = createSafeFetcher({
    resolver,
    transport,
    userAgent: "Heron/test",
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
  });
  return { resolver, transport, fetcher };
}

function failed(result: SafeFetchResult): Extract<SafeFetchResult, { ok: false }> {
  if (result.ok) throw new Error("expected a failure");
  return result;
}

const BLOCKED_NEVER_CONNECTS = [
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
  "https://16843009/",
  "https://0.0.0.0/",
  "https://[::]/",
  "file:///etc/passwd",
  "ftp://example.com/x",
  "gopher://example.com/x",
  "data:text/html,hi",
  "http://example.com/",
  "http://127.0.0.1/",
  "https://private.test/",
  "https://mixed.test/",
];

describe("createSafeFetcher URL policy", () => {
  test("blocks every vector without ever connecting", async () => {
    const { transport, fetcher } = setup({
      "private.test": [addrs("10.1.2.3")],
      "mixed.test": [addrs(PUBLIC, "192.168.0.9")],
    });
    for (const url of BLOCKED_NEVER_CONNECTS) {
      const result = failed(await fetcher.fetch(req(url)));
      expect(result.code).toBe("SSRF_BLOCKED");
      expect(result.message.startsWith("Blocked ")).toBe(true);
    }
    expect(transport.calls).toEqual([]);
  });

  test("names the reason and offers --allow-local only for local-allowable ranges", async () => {
    const { fetcher } = setup({ "private.test": [addrs("10.1.2.3")] });
    expect(failed(await fetcher.fetch(req("https://private.test/"))).message).toBe(
      "Blocked https://private.test/: private.test resolves to 10.1.2.3, a private address (10.0.0.0/8); pass --allow-local to fetch a local target you trust.",
    );
    expect(failed(await fetcher.fetch(req("https://0x7f000001/"))).message).toBe(
      'Blocked https://127.0.0.1/: host "0x7f000001" is a non-canonical IPv4 form of 127.0.0.1.',
    );
    expect(failed(await fetcher.fetch(req("https://[fe80::1]/"))).message).toContain(
      "a link-local address (fe80::/10).",
    );
    expect(failed(await fetcher.fetch(req("ftp://example.com/x"))).message).toBe(
      'Blocked ftp://example.com/x: scheme "ftp" is not allowed (https only; http only to a local target with --allow-local).',
    );
    expect(failed(await fetcher.fetch(req("https://169.254.169.254/"))).message).toContain(
      "a cloud metadata address; it is never fetched",
    );
  });

  test("keeps metadata, mapped, link-local and unspecified blocked even with --allow-local", async () => {
    const { transport, fetcher } = setup();
    for (const url of [
      "https://169.254.169.254/",
      "https://100.100.100.200/",
      "https://[fd00:ec2::254]/",
      "https://[::ffff:127.0.0.1]/",
      "https://[fe80::1]/",
      "https://0.0.0.0/",
      "https://0x7f000001/",
      "http://example.com/",
    ]) {
      expect(failed(await fetcher.fetch(req(url, { allowLocal: true }))).code).toBe("SSRF_BLOCKED");
    }
    expect(transport.calls).toEqual([]);
  });

  test("rejects credentials and unparseable URLs without echoing secrets", async () => {
    const { fetcher } = setup();
    const withUser = failed(await fetcher.fetch(req("https://user:CANARY@example.com/")));
    expect(withUser).toMatchObject({
      code: "INVALID_URL",
      message: "URLs with credentials are not accepted.",
    });
    for (const text of ["not a url", "https://", "/relative"]) {
      expect(failed(await fetcher.fetch(req(text))).code).toBe("INVALID_URL");
    }
    expect(failed(await fetcher.fetch(req("nope?token=CANARY"))).message).toBe(
      "nope is not a valid absolute URL.",
    );
    expect(failed(await fetcher.fetch(req("x@y?token=CANARY"))).message).toBe(
      "The URL is not a valid absolute URL.",
    );
    expect(failed(await fetcher.fetch(req(`${"a".repeat(300)}`))).message).toBe(
      "The URL is not a valid absolute URL.",
    );
  });
});

describe("createSafeFetcher connection", () => {
  test("pins the validated IPv4 with the original host, SNI and any https port", async () => {
    const { resolver, transport, fetcher } = setup(
      { "example.com": [addrs("2606:4700::1", PUBLIC, "93.184.216.35")] },
      { contentType: "Text/HTML; charset=utf-8" },
    );
    const ok = await fetcher.fetch(req("https://Example.com:8443/a/b?token=SECRET&x=1#f"));
    expect(ok).toMatchObject({
      ok: true,
      status: 200,
      mediaType: "text/html",
      finalUrl: "https://example.com:8443/a/b?token=REDACTED&x=1",
      requestedUrl: "https://example.com:8443/a/b?token=REDACTED&x=1",
      local: null,
      hops: [{ address: PUBLIC, range: "public", status: 200 }],
    });
    expect(resolver.calls).toEqual(["example.com"]);
    expect(transport.calls).toEqual([
      {
        url: `https://${PUBLIC}:8443/a/b?token=SECRET&x=1`,
        hostHeader: "example.com:8443",
        serverName: "example.com",
        headers: {
          accept: "text/html",
          "accept-encoding": "identity",
          "user-agent": "Heron/test",
        },
        maxBytes: 1024,
      },
    ]);
  });

  test("pins the first IPv6 when there is no IPv4 and handles literals and a trailing dot", async () => {
    const { resolver, transport, fetcher } = setup({
      "example.com": [addrs("2606:4700::1111")],
    });
    expect((await fetcher.fetch(req("https://example.com/"))).ok).toBe(true);
    expect(transport.calls[0]).toMatchObject({
      url: "https://[2606:4700::1111]/",
      hostHeader: "example.com",
    });
    expect((await fetcher.fetch(req("https://[2606:4700::1111]:444/x"))).ok).toBe(true);
    expect(transport.calls[1]).toMatchObject({
      url: "https://[2606:4700::1111]:444/x",
      hostHeader: "[2606:4700::1111]:444",
      serverName: null,
    });
    expect((await fetcher.fetch(req("https://8.8.8.8/"))).ok).toBe(true);
    expect(transport.calls[2]).toMatchObject({
      url: "https://8.8.8.8/",
      serverName: null,
    });
    // a trailing dot is dropped before the lookup
    expect((await fetcher.fetch(req("https://example.com./"))).ok).toBe(true);
    expect(resolver.calls.at(-1)).toBe("example.com");
  });

  test("allows a local target only with --allow-local and records its range", async () => {
    const { transport, fetcher } = setup({
      "dev.test": [addrs("192.168.5.5")],
    });
    for (const [url, address, range] of [
      ["http://127.0.0.1:8080/x", "127.0.0.1", "loopback"],
      ["https://localhost:8443/", "127.0.0.1", "loopback"],
      ["https://app.localhost/", "127.0.0.1", "loopback"],
      ["https://[::1]/", "::1", "loopback"],
      ["https://dev.test/", "192.168.5.5", "private"],
      ["http://dev.test/", "192.168.5.5", "private"],
      ["https://100.64.1.1/", "100.64.1.1", "shared"],
      ["https://[fd12:3456::1]/", "fd12:3456::1", "unique-local"],
    ] as const) {
      const ok = await fetcher.fetch(req(url, { allowLocal: true }));
      expect(ok).toMatchObject({ ok: true, local: { address, range } });
    }
    expect(transport.calls[0]?.url).toBe("http://127.0.0.1:8080/x");
    expect(transport.calls[1]).toMatchObject({
      url: "https://127.0.0.1:8443/",
      serverName: "localhost",
    });
    // without the flag the same targets are blocked
    expect(failed(await fetcher.fetch(req("https://dev.test/"))).code).toBe("SSRF_BLOCKED");
    expect(failed(await fetcher.fetch(req("https://localhost/"))).code).toBe("SSRF_BLOCKED");
  });

  test("blocks http to a public host and mixed answers even with --allow-local", async () => {
    const { transport, fetcher } = setup({
      "mixed.test": [addrs("10.0.0.1", PUBLIC)],
    });
    expect(failed(await fetcher.fetch(req("http://mixed.test/", { allowLocal: true }))).code).toBe(
      "SSRF_BLOCKED",
    );
    expect(transport.calls).toEqual([]);
  });

  // Covers: R9
  test("blocks a mixed public and non-public DNS answer with and without --allow-local", async () => {
    const { transport, fetcher } = setup({
      "mixed.test": [addrs("10.0.0.1", PUBLIC)],
    });
    for (const allowLocal of [false, true]) {
      const result = failed(await fetcher.fetch(req("https://mixed.test/", { allowLocal })));
      expect(result.code).toBe("SSRF_BLOCKED");
    }
    expect(transport.calls).toEqual([]);
  });

  test("maps DNS failures to FETCH_FAILED", async () => {
    const { fetcher } = setup({
      "gone.test": "ENOTFOUND",
      "empty.test": [[]],
      "odd.test": "",
    });
    expect(failed(await fetcher.fetch(req("https://gone.test/"))).message).toBe(
      "Could not fetch https://gone.test/: DNS lookup failed (ENOTFOUND).",
    );
    expect(failed(await fetcher.fetch(req("https://empty.test/"))).message).toContain("ENODATA");
    expect(failed(await fetcher.fetch(req("https://unknown.test/"))).code).toBe("FETCH_FAILED");
    expect(failed(await fetcher.fetch(req("https://odd.test/"))).code).toBe("FETCH_FAILED");
  });
});

const redirect = (location: string | null, status = 302): TransportReply => ({
  status,
  location,
});

describe("createSafeFetcher redirects", () => {
  test("revalidates every hop and re-resolves the same host (rebinding)", async () => {
    const { resolver, transport, fetcher } = setup(
      { "example.com": [addrs(PUBLIC), addrs("10.0.0.5")] },
      (_request, index) => (index === 0 ? redirect("/next") : {}),
    );
    const result = failed(await fetcher.fetch(req("https://example.com/start?token=t")));
    expect(result.code).toBe("SSRF_BLOCKED");
    expect(result.message).toBe(
      "Blocked https://example.com/start?token=REDACTED: redirect 1 to https://example.com/next: example.com resolves to 10.0.0.5, a private address (10.0.0.0/8); pass --allow-local to fetch a local target you trust.",
    );
    expect(resolver.calls).toEqual(["example.com", "example.com"]);
    expect(transport.calls.map((c) => c.url)).toEqual([`https://${PUBLIC}/start?token=t`]);
    expect(result.hops).toHaveLength(1);
  });

  test("follows relative and absolute redirects up to the limit", async () => {
    const chain = (n: number): TransportReply =>
      n < 3 ? redirect(n === 0 ? "/a" : "https://example.com/b", n === 0 ? 301 : 308) : {};
    const { transport, fetcher } = setup(undefined, (_r, index) => chain(index));
    const ok = await fetcher.fetch(req("https://example.com/"));
    expect(ok).toMatchObject({ ok: true, finalUrl: "https://example.com/b" });
    expect(transport.calls).toHaveLength(4);
    expect(ok.ok && ok.hops.map((h) => h.status)).toEqual([301, 308, 308, 200]);

    const tooMany = setup(undefined, redirect("/loop"));
    expect(failed(await tooMany.fetcher.fetch(req("https://example.com/"))).message).toBe(
      "Could not fetch https://example.com/loop: more than 3 redirects.",
    );
    expect(tooMany.transport.calls).toHaveLength(4);
    const none = setup(undefined, redirect(null));
    expect(failed(await none.fetcher.fetch(req("https://example.com/"))).message).toContain(
      "redirect without Location",
    );
    const notRedirect = setup(undefined, { status: 304, location: "/x" });
    expect(failed(await notRedirect.fetcher.fetch(req("https://example.com/"))).message).toContain(
      "redirect without Location",
    );
  });

  test("blocks redirects to private IPs, names, metadata and non-https schemes", async () => {
    for (const target of [
      "https://127.0.0.1/",
      "https://internal.test/",
      "https://169.254.169.254/",
      "ftp://example.com/",
      "http://example.com/",
      "https://0x7f000001/",
    ]) {
      const { transport, fetcher } = setup(
        {
          "example.com": [addrs(PUBLIC)],
          "internal.test": [addrs("10.9.9.9")],
        },
        redirect(target),
      );
      const result = failed(
        await fetcher.fetch(req("https://example.com/", { allowLocal: false })),
      );
      expect(result.code).toBe("SSRF_BLOCKED");
      expect(result.message).toContain("redirect 1 to");
      expect(transport.calls).toHaveLength(1);
    }
  });

  test("never lets a public start reach a local target, even with --allow-local", async () => {
    const { transport, fetcher } = setup(undefined, redirect("https://127.0.0.1:9/"));
    const result = failed(await fetcher.fetch(req("https://example.com/", { allowLocal: true })));
    expect(result.code).toBe("SSRF_BLOCKED");
    expect(transport.calls).toHaveLength(1);
    // a local start may follow a redirect to a local or public target
    const local = setup({ "example.com": [addrs(PUBLIC)] }, (_r, index) =>
      index === 0
        ? redirect("https://127.0.0.1:9/x")
        : index === 1
          ? redirect("https://example.com/")
          : {},
    );
    const ok = await local.fetcher.fetch(req("https://localhost:9/", { allowLocal: true }));
    expect(ok).toMatchObject({ ok: true, local: null });
    expect(ok.ok && ok.hops.map((h) => h.range)).toEqual(["loopback", "loopback", "public"]);
  });
});

describe("createSafeFetcher responses", () => {
  test("maps status, media type, size, network errors and timeouts", async () => {
    const status = setup(undefined, { status: 404 });
    expect(failed(await status.fetcher.fetch(req("https://example.com/"))).message).toBe(
      "Could not fetch https://example.com/: HTTP 404.",
    );
    const informational = setup(undefined, { status: 101 });
    expect(
      failed(await informational.fetcher.fetch(req("https://example.com/"))).message,
    ).toContain("HTTP 101");
    const media = setup(undefined, { contentType: "image/png" });
    expect(failed(await media.fetcher.fetch(req("https://example.com/")))).toMatchObject({
      code: "UNSUPPORTED_MEDIA_TYPE",
      message: "https://example.com/ returned image/png; expected text/html.",
    });
    const untyped = setup(undefined, { contentType: null });
    expect(failed(await untyped.fetcher.fetch(req("https://example.com/"))).message).toContain(
      "no content type",
    );
    const big = setup(undefined, { overflow: true });
    expect(failed(await big.fetcher.fetch(req("https://example.com/")))).toMatchObject({
      code: "INPUT_TOO_LARGE",
      message: "https://example.com/ exceeds 1024 bytes.",
    });
    const broken = setup(undefined, new TypeError("boom"));
    expect(failed(await broken.fetcher.fetch(req("https://example.com/"))).message).toBe(
      "Could not fetch https://example.com/: TypeError.",
    );
    const slow = setup(undefined, "hang", 50);
    expect(failed(await slow.fetcher.fetch(req("https://example.com/"))).message).toBe(
      "Could not fetch https://example.com/: timed out after 50 ms.",
    );
  });

  test("times out a hanging DNS lookup and never throws", async () => {
    const hangingResolver = {
      resolve: (_host: string, signal: AbortSignal) =>
        new Promise<never>((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(new Error("aborted")), {
            once: true,
          });
        }),
    };
    const fetcher = createSafeFetcher({
      resolver: hangingResolver,
      transport: recordingTransport(),
      userAgent: "Heron/test",
      timeoutMs: 30,
    });
    expect(failed(await fetcher.fetch(req("https://example.com/"))).message).toBe(
      "Could not fetch https://example.com/: timed out after 30 ms.",
    );
    const exploding = createSafeFetcher({
      resolver: { resolve: () => Promise.resolve(addrs(PUBLIC)) },
      transport: {
        send: () =>
          Promise.resolve({
            status: 200,
            location: null,
            contentType: "text/html",
            get body(): Uint8Array {
              throw new RangeError("x");
            },
            overflow: false,
          }),
      },
      userAgent: "Heron/test",
    });
    expect(failed(await exploding.fetch(req("https://example.com/"))).message).toBe(
      "Could not fetch the URL: RangeError.",
    );
  });
});
