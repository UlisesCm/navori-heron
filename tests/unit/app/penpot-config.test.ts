// Covers: R4, R7, R19
import { afterEach, expect, test } from "bun:test";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  penpotRedactor,
  readPenpotLink,
  resolvePenpotConnection,
  resolvePenpotKey,
  resolvePenpotUrl,
} from "../../../src/app/penpot-config.ts";
import { penpotFailureResult, withPenpotSession } from "../../../src/app/penpot-session.ts";
import type { AppContext } from "../../../src/app/context.ts";
import { HeronProjectSchema } from "../../../src/core/contracts/index.ts";
import { nodeFs, type FsPort } from "../../../src/core/store/fs-port.ts";
import type {
  PenpotConnectRequest,
  PenpotFailure,
  PenpotGateway,
} from "../../../src/penpot/ports.ts";
import { buildReferencesPage } from "../../../src/penpot/compiler/references-page.ts";
import { resolvePenpotCopy } from "../../../src/penpot/compiler/copy.ts";
import { penpotTemplate } from "../../../src/penpot/compiler/templates.ts";
import { fixedContext } from "../../helpers/cli.ts";

const KEY = "SYNTHETIC-file-key-123456";
const RUN = "run-20260930T120000Z-0000000a";
const roots: string[] = [];
afterEach(() => {
  for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true });
});
function root(): string {
  const dir = mkdtempSync(join(tmpdir(), "heron-penpot-config-"));
  roots.push(dir);
  return dir;
}
const success = { ok: true as const, data: null, findings: [], next: [] };
const input = {
  baseUrl: "http://localhost:9001",
  key: KEY,
  command: "penpot inspect",
  runId: RUN,
  log: false as const,
};

// Covers: R4, R7
test("connection resolution validates the URL before reading credentials and forwards exact failures", () => {
  let reads = 0;
  const fs: FsPort = {
    ...nodeFs,
    realpathSync: (_path: string): string => {
      reads += 1;
      throw new Error(KEY);
    },
  };
  const ctx = {
    ...fixedContext({ env: { PENPOT_URL: "invalid-secret", PENPOT_MCP_KEY_FILE: KEY } }),
    fs,
  };
  const connection = resolvePenpotConnection(ctx);
  const url = resolvePenpotUrl(ctx);
  if (connection.ok || url.ok) throw new Error("Synthetic URL should be rejected");
  expect(connection).toEqual(url);
  expect(reads).toBe(0);
  const validUrl = { ...ctx, env: { ...ctx.env, PENPOT_URL: "http://localhost:9001" } };
  const failed = resolvePenpotConnection(validUrl);
  expect(reads).toBe(1);
  const key = resolvePenpotKey(validUrl);
  if (failed.ok || key.ok) throw new Error("Synthetic filesystem should reject the key");
  expect(failed).toEqual(key);
  expect(JSON.stringify(failed)).not.toContain(KEY);
});

// Covers: R4, R7
test("connection resolution forwards the normalized URL, opaque key and permission warnings", () => {
  const cwd = root();
  const file = join(cwd, "synthetic-key");
  writeFileSync(file, ` ${KEY}\n`, { mode: 0o600 });
  chmodSync(file, 0o644);
  const ctx = fixedContext({
    cwd,
    env: { PENPOT_URL: "http://localhost:9001/", PENPOT_MCP_KEY_FILE: "synthetic-key" },
  });
  const resolved = resolvePenpotConnection(ctx);
  const key = resolvePenpotKey(ctx);
  expect(key.ok).toBe(true);
  if (!key.ok) throw new Error("Synthetic key should resolve");
  expect(resolved).toEqual({
    ok: true,
    baseUrl: "http://localhost:9001",
    key: KEY,
    warnings: key.warnings,
  });
  expect(key.warnings).toMatchObject([{ code: "PENPOT_KEY_FILE_PERMISSIONS" }]);
  expect(JSON.stringify(key.warnings)).not.toContain(KEY);
  expect(JSON.stringify(key.warnings)).not.toContain(file);
});

test("resolves the Penpot URL and the MCP key only from the environment and warns on an open key file", () => {
  const cwd = root();
  const file = join(cwd, "key");
  writeFileSync(file, `  ${KEY}\n`, { mode: 0o600 });
  const ctx = fixedContext({
    cwd,
    env: { PENPOT_URL: "http://localhost:9001/", PENPOT_MCP_KEY_FILE: "key" },
  });
  expect(resolvePenpotUrl(ctx)).toEqual({ ok: true, baseUrl: "http://localhost:9001" });
  expect(resolvePenpotKey(ctx)).toEqual({ ok: true, key: KEY, warnings: [] });
  chmodSync(file, 0o644);
  const open = resolvePenpotKey(ctx);
  expect(open.ok).toBe(true);
  if (open.ok)
    expect(open.warnings).toMatchObject([
      { code: "PENPOT_KEY_FILE_PERMISSIONS", severity: "warning" },
    ]);
  symlinkSync(file, join(cwd, "alias"));
  expect(resolvePenpotKey(fixedContext({ cwd, env: { PENPOT_MCP_KEY_FILE: "alias" } }))).toEqual(
    open,
  );
  expect(resolvePenpotKey(fixedContext({ env: { PENPOT_MCP_KEY: `\n${KEY}  ` } }))).toEqual({
    ok: true,
    key: KEY,
    warnings: [],
  });
});

test("rejects missing or unsafe URLs and ambiguous credentials without echoing input", () => {
  for (const value of [undefined, ""]) {
    const result = resolvePenpotUrl(fixedContext({ env: { PENPOT_URL: value } }));
    expect(result).toMatchObject({
      ok: false,
      result: { code: 5, findings: [{ code: "PENPOT_URL_MISSING" }] },
    });
  }
  for (const url of [
    "http://example.test",
    "https://u:secret@example.test",
    "https://example.test/?userToken=secret",
    "https://example.test/mcp/stream",
    "https://169.254.169.254",
    "https://example.test/#secret",
    "invalid-secret",
  ]) {
    const result = resolvePenpotUrl(fixedContext({ env: { PENPOT_URL: url } }));
    expect(result).toMatchObject({ ok: false, result: { code: 2 } });
    expect(JSON.stringify(result)).not.toContain("secret");
  }
  expect(resolvePenpotUrl(fixedContext({ env: { PENPOT_URL: "https://example.test" } }))).toEqual({
    ok: true,
    baseUrl: "https://example.test",
  });
  expect(resolvePenpotKey(fixedContext())).toMatchObject({ ok: false, result: { code: 5 } });
  expect(
    resolvePenpotKey(fixedContext({ env: { PENPOT_MCP_KEY: "", PENPOT_MCP_KEY_FILE: "" } })),
  ).toMatchObject({
    ok: false,
    result: { code: 2, message: "Set either PENPOT_MCP_KEY or PENPOT_MCP_KEY_FILE, not both." },
  });
  for (const key of [
    "",
    " \n ",
    "bad\u0000key",
    "https://example.test/mcp/stream?userToken=secret",
    "é".repeat(4097),
  ]) {
    const result = resolvePenpotKey(fixedContext({ env: { PENPOT_MCP_KEY: key } }));
    expect(result).toMatchObject({ ok: false, result: { code: 2 } });
    expect(JSON.stringify(result)).not.toContain("secret");
  }
  expect(resolvePenpotKey(fixedContext({ env: { PENPOT_MCP_KEY: "é".repeat(4096) } })).ok).toBe(
    true,
  );
});

test("checks key files before and after reading and returns only static failures", () => {
  const cwd = root();
  const file = join(cwd, "key");
  const ctx = fixedContext({ cwd, env: { PENPOT_MCP_KEY_FILE: "key" } });
  for (const content of ["", " ", "x".repeat(8193), new Uint8Array([0xff])]) {
    writeFileSync(file, content);
    expect(resolvePenpotKey(ctx)).toMatchObject({
      ok: false,
      result: { code: 2, message: "PENPOT_MCP_KEY_FILE could not be read or is empty." },
    });
  }
  for (const path of ["", "missing", "."])
    expect(resolvePenpotKey(fixedContext({ cwd, env: { PENPOT_MCP_KEY_FILE: path } })).ok).toBe(
      false,
    );
  writeFileSync(file, KEY);
  const racing: FsPort = { ...nodeFs, readFileSync: () => new Uint8Array(8193) };
  expect(resolvePenpotKey({ ...ctx, fs: racing }).ok).toBe(false);
  const unreadable: FsPort = {
    ...nodeFs,
    readFileSync: () => {
      throw new Error(KEY);
    },
  };
  expect(JSON.stringify(resolvePenpotKey({ ...ctx, fs: unreadable }))).not.toContain(KEY);
});

test("reads only enabled file bindings and redacts file keys and URL credentials", () => {
  const project = HeronProjectSchema.parse(
    JSON.parse(
      readFileSync(
        join(import.meta.dir, "../../assets/p1-workspaces/membership-product/.heron/project.json"),
        "utf8",
      ),
    ),
  );
  project.penpot = {
    enabled: true,
    fileId: "bound-file",
    url: "https://evil.test",
    version: "old",
  };
  expect(readPenpotLink(project, "/repo")).toEqual({ ok: true, link: { fileId: "bound-file" } });
  for (const binding of [
    { ...project.penpot, enabled: false },
    { ...project.penpot, fileId: null },
  ])
    expect(readPenpotLink({ ...project, penpot: binding }, "/repo")).toMatchObject({
      ok: false,
      result: { code: 3 },
    });
  for (const key of [KEY, 'a"b', 'SYNTHETIC-"quoted']) {
    const redact = penpotRedactor(fixedContext(), key);
    for (const variant of [key, encodeURIComponent(key), JSON.stringify(key).slice(1, -1)])
      expect(redact(`error ${variant}`)).not.toContain(variant);
    const clean = redact(
      `https://user:password@example.test/mcp?userToken=unrelated-secret#private`,
    );
    for (const secret of ["password", "unrelated-secret", "private"])
      expect(clean).not.toContain(secret);
  }
});

function services(gateway: PenpotGateway): AppContext["penpot"] {
  return { gateway, connectTimeoutMs: 11, readTimeoutMs: 22, writeTimeoutMs: 33 };
}
test("maps every failure kind to a dependency finding without exposing rejected-key detail", () => {
  const kinds: PenpotFailure["kind"][] = [
    "unreachable",
    "rejected",
    "incompatible",
    "plugin-not-connected",
    "timeout",
    "script-failed",
  ];
  const codes = [
    "PENPOT_UNREACHABLE",
    "PENPOT_KEY_REJECTED",
    "PENPOT_MCP_INCOMPATIBLE",
    "PENPOT_PLUGIN_NOT_CONNECTED",
    "PENPOT_TIMEOUT",
    "PENPOT_SCRIPT_FAILED",
  ];
  for (const [index, kind] of kinds.entries()) {
    const result = penpotFailureResult(
      { kind, detail: "HTTP 403 sanitized" },
      { template: "inspect@v1", timeoutMs: 22 },
    );
    expect(result).toMatchObject({ ok: false, code: 5, findings: [{ code: codes[index] }] });
    if (!result.ok && kind === "timeout") expect(result.message).toContain("22 ms");
  }
  const rejected = penpotFailureResult(
    { kind: "rejected", detail: KEY },
    { template: null, timeoutMs: 11 },
  );
  expect(JSON.stringify(rejected)).not.toContain(KEY);
  expect(JSON.stringify(rejected)).toContain("401/403");
});

test("connect failures redact before truncation and read-only sessions never touch the filesystem", async () => {
  let fsCalls = 0;
  const fs: FsPort = {
    ...nodeFs,
    mkdirSync: () => {
      fsCalls += 1;
      throw new Error("unexpected fs");
    },
  };
  const gateway: PenpotGateway = {
    id: "mcp",
    connect: async (request) => {
      expect(request.timeoutMs).toBe(11);
      expect(request.clientVersion).toBe(fixedContext().heronVersion);
      expect(request.redact(KEY)).not.toContain(KEY);
      return {
        ok: false,
        durationMs: 0,
        failure: { kind: "unreachable", detail: `${"x".repeat(490)}${KEY} tail` },
      };
    },
  };
  const result = await withPenpotSession(
    fixedContext({ fs, penpot: services(gateway) }),
    input,
    async () => {
      throw new Error("callback must not run");
    },
  );
  expect(result).toMatchObject({ ok: false, code: 5 });
  expect(JSON.stringify(result)).not.toContain(KEY.slice(0, 10));
  expect(fsCalls).toBe(0);
});

test("closes successful and throwing consumers and logs one sanitized failure at the explicit workspace", async () => {
  const cwd = root();
  const destination = root();
  let closes = 0;
  const requests: PenpotConnectRequest[] = [];
  const gateway: PenpotGateway = {
    id: "mcp",
    connect: async (request) => {
      requests.push(request);
      return {
        ok: true,
        server: null,
        runner: {
          execute: async (_code, timeoutMs) => ({
            ok: false,
            durationMs: 0,
            failure: { kind: "timeout", detail: `${KEY} timeout ${timeoutMs}` },
          }),
          close: async () => {
            closes += 1;
          },
        },
      };
    },
  };
  const ctx = fixedContext({ cwd, penpot: services(gateway) });
  const loggedInput = { ...input, log: true as const, heronDir: join(destination, ".heron") };
  expect(await withPenpotSession(ctx, loggedInput, async () => success)).toEqual(success);
  expect(existsSync(loggedInput.heronDir)).toBe(false);
  const page = buildReferencesPage([], {
    mode: "reference-only",
    copy: resolvePenpotCopy("en"),
    template: penpotTemplate("review-page"),
  });
  await withPenpotSession(ctx, loggedInput, async (session) => {
    for (const result of [await session.inspect(22), await session.apply(page, null, 33)]) {
      expect(result.ok).toBe(false);
      expect(JSON.stringify(result)).not.toContain(KEY);
    }
    return success;
  });
  expect(closes).toBe(2);
  const log = readFileSync(join(loggedInput.heronDir, "logs/2026-09-30.jsonl"), "utf8");
  expect(log.trim().split("\n")).toHaveLength(1);
  expect(JSON.parse(log)).toMatchObject({
    event: "penpot.error",
    kind: "timeout",
    template: "inspect@v1",
    command: input.command,
    runId: RUN,
    durationMs: 0,
  });
  expect(log).not.toContain(KEY);
  expect(existsSync(join(cwd, ".heron"))).toBe(false);
  const thrown = await withPenpotSession(ctx, input, async () => {
    throw new Error(KEY);
  });
  expect(thrown).toMatchObject({
    ok: false,
    code: 5,
    findings: [{ code: "PENPOT_SCRIPT_FAILED" }],
  });
  expect(JSON.stringify(thrown)).not.toContain(KEY);
  expect(closes).toBe(3);
  expect(requests).toHaveLength(3);
});

test("logs sanitized connection errors with no template and preserves JSON when details contain URLs", async () => {
  const destination = root();
  const gateway: PenpotGateway = {
    id: "mcp",
    connect: async () => ({
      ok: false,
      durationMs: 0,
      failure: {
        kind: "unreachable",
        detail: `Failed at https://user:password@example.test/mcp?userToken=${KEY}#private`,
      },
    }),
  };
  const ctx = fixedContext({ penpot: services(gateway) });
  const heronDir = join(destination, ".heron");
  const result = await withPenpotSession(
    ctx,
    { ...input, log: true, heronDir },
    async () => success,
  );
  expect(result.ok).toBe(false);
  const log = readFileSync(join(heronDir, "logs/2026-09-30.jsonl"), "utf8");
  expect(JSON.parse(log)).toMatchObject({
    event: "penpot.error",
    template: null,
    kind: "unreachable",
  });
  for (const secret of [KEY, "password", "private"]) {
    expect(log).not.toContain(secret);
    expect(JSON.stringify(result)).not.toContain(secret);
  }
});
