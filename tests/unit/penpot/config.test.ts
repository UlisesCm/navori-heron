// Covers: R4, R7
import { describe, expect, test } from "bun:test";
import { mcpEndpoint, parsePenpotUrl } from "../../../src/penpot/config.ts";
import { isTestedVersion, PENPOT_TESTED_VERSIONS } from "../../../src/penpot/compatibility.ts";

describe("Penpot configuration", () => {
  test("accepts https or loopback http Penpot URLs without credentials, query or fragment", () => {
    for (const baseUrl of [
      "https://penpot.example",
      "https://10.0.0.5",
      "https://100.64.0.1",
      "https://[fc00::1]",
      "http://localhost:9001",
      "http://[::1]:9001",
      "http://127.0.0.2:9001",
      "https://8.8.8.8",
      "https://[2606:4700:4700::1111]",
      "https://example.com/penpot",
    ])
      expect(parsePenpotUrl(`${baseUrl}/`)).toEqual({ ok: true, baseUrl });
    expect(parsePenpotUrl("HTTPS://EXAMPLE.COM:443/penpot///")).toEqual({
      ok: true,
      baseUrl: "https://example.com/penpot",
    });
  });
  test("rejects unsafe ranges and never echoes the supplied URL", () => {
    const cases = [
      ["", "invalid"],
      ["not-a-url", "invalid"],
      ["https://example.com/" + "x".repeat(2048), "invalid"],
      ["https://example.com/\n", "invalid"],
      [" https://example.com", "invalid"],
      ["ftp://example.com", "scheme"],
      ["https://user:secret@example.com", "credentials"],
      ["https://@example.com", "credentials"],
      ["https://example.com?userToken=secret", "user-token"],
      ["https://example.com?x=1", "query"],
      ["https://example.com?", "query"],
      ["https://example.com#", "fragment"],
      ["http://10.0.0.5", "host"],
      ["http://example.com", "host"],
      ["https://169.254.169.254", "host"],
      ["https://0.0.0.0", "host"],
      ["https://224.0.0.1", "host"],
      ["https://192.0.2.1", "host"],
      ["https://[::]", "host"],
      ["https://[::ffff:127.0.0.1]", "host"],
      ["http://localhost:9001/mcp/stream", "mcp-path"],
      ["https://example.com/penpot/mcp/%73tream/", "mcp-path"],
      ["https://example.com/%zz", "invalid"],
    ] as const;
    for (const [raw, reason] of cases) expect(parsePenpotUrl(raw)).toEqual({ ok: false, reason });
  });
  test("places the key only in the generated endpoint query and matches tested version prefixes", () => {
    const url = mcpEndpoint("https://example.com/penpot", "SYNTHETIC +&key");
    expect(url.pathname).toBe("/penpot/mcp/stream");
    expect(url.searchParams.get("userToken")).toBe("SYNTHETIC +&key");
    expect(url.username).toBe("");
    expect(PENPOT_TESTED_VERSIONS).toEqual(["2.17.2"]);
    for (const version of ["2.17.2", "2.17.2+build", "2.17.2-dev"])
      expect(isTestedVersion(version)).toBe(true);
    for (const version of ["2.17.20", "2.18.0", "v2.17.2", "", "2.17.2.1"])
      expect(isTestedVersion(version)).toBe(false);
  });
});
