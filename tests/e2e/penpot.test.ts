// Covers: R4, R5, R6, R7, R8, R11, R16
import { afterEach, expect, test } from "bun:test";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CliEnvelopeSchema } from "../../src/core/contracts/index.ts";
import { mcpGateway } from "../../src/penpot/adapters/mcp/index.ts";
import { runCliCaptured } from "../helpers/cli.ts";
import { hashTree } from "../helpers/fixtures.ts";
import { directionsWorkspace, linkedWorkspace, CANARY_MCP_KEY } from "../helpers/penpot.ts";
import { startFakeMcp } from "../helpers/fake-mcp.ts";
import { hostileText, hasControlChars } from "../helpers/hostile-controls.ts";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

test("links the connected file and refuses a URL that carries a userToken", async () => {
  const probe = await directionsWorkspace();
  roots.push(probe.root);
  let result = await runCliCaptured(["penpot", "link", probe.root, "--json"], probe.ctx);
  expect(result.code).toBe(0);
  expect(CliEnvelopeSchema.parse(JSON.parse(result.stdout))).toMatchObject({
    command: "penpot link",
    ok: true,
    data: { file: { id: "file-1" } },
  });
  expect(result.stderr).toBe("");
  const before = hashTree(probe.root, { exclude: [] });
  probe.connections.length = 0;
  result = await runCliCaptured(["penpot", "link", probe.root, "--json"], {
    ...probe.ctx,
    env: {
      ...probe.ctx.env,
      PENPOT_URL: `http://localhost:9001/mcp/stream?userToken=${CANARY_MCP_KEY}`,
    },
  });
  expect(result.code).toBe(2);
  expect(result.stdout).not.toContain(CANARY_MCP_KEY);
  expect(probe.connections).toHaveLength(0);
  expect(hashTree(probe.root, { exclude: [] })).toEqual(before);
  expect(
    (await runCliCaptured(["penpot", "link", probe.root, "--url", "https://evil.test"], probe.ctx))
      .code,
  ).toBe(2);
});

test("never sends the key to a URL stored in the workspace", async () => {
  const probe = await linkedWorkspace();
  roots.push(probe.root);
  const canary = await startFakeMcp();
  const target = await startFakeMcp({
    text: JSON.stringify({
      result: {
        heron: "inspect@v1",
        penpotVersion: "2.17.2",
        file: { id: "file-1", name: "Synthetic file" },
        pages: [],
        unmanagedPages: 1,
      },
      log: "",
    }),
  });
  try {
    const projectPath = join(probe.root, ".heron/project.json");
    const project = JSON.parse(readFileSync(projectPath, "utf8")) as {
      penpot: { url: string | null };
    };
    project.penpot.url = canary.baseUrl;
    writeFileSync(projectPath, JSON.stringify(project));
    const ctx = {
      ...probe.ctx,
      env: { ...probe.ctx.env, PENPOT_URL: target.baseUrl },
      penpot: { ...probe.ctx.penpot, gateway: mcpGateway },
    };
    const result = await runCliCaptured(["penpot", "inspect", probe.root, "--json"], ctx);
    expect(result.code).toBe(0);
    expect(CliEnvelopeSchema.safeParse(JSON.parse(result.stdout)).success).toBe(true);
    expect(canary.requests).toHaveLength(0);
    expect(target.requests.length).toBeGreaterThan(1);
    expect(
      target.requests.some(
        (request) => new URL(request.url).searchParams.get("userToken") === CANARY_MCP_KEY,
      ),
    ).toBe(true);
    expect(result.stdout).not.toContain(CANARY_MCP_KEY);
  } finally {
    await Promise.all([canary.stop(), target.stop()]);
  }
}, 10_000); // Actual SDK servers on ephemeral loopback, never a real Penpot instance.

test("inspects the managed pages read-only", async () => {
  const probe = await linkedWorkspace();
  roots.push(probe.root);
  expect(
    (await runCliCaptured(["penpot", "sync", probe.root, "--proposals"], probe.ctx)).code,
  ).toBe(0);
  const before = hashTree(probe.root, { exclude: [] });
  const mutations = probe.fake.counters.mutations;
  const inspected = await runCliCaptured(["penpot", "inspect", probe.root, "--json"], probe.ctx);
  expect(inspected.code).toBe(0);
  expect(CliEnvelopeSchema.parse(JSON.parse(inspected.stdout))).toMatchObject({
    command: "penpot inspect",
    data: {
      bound: { matches: true },
      pages: [
        { status: "up-to-date" },
        { status: "up-to-date" },
        { status: "up-to-date" },
        { status: "missing" },
      ],
    },
  });
  expect(probe.fake.counters.mutations).toBe(mutations);
  expect(hashTree(probe.root, { exclude: [] })).toEqual(before);
  const text = await runCliCaptured(["penpot", "inspect", probe.root], probe.ctx);
  expect(text.stdout).toContain("Heron pages (4 managed");
});

test("previews the plan with --dry-run without writing", async () => {
  const probe = await linkedWorkspace();
  roots.push(probe.root);
  const before = hashTree(probe.root, { exclude: [] });
  const result = await runCliCaptured(
    ["penpot", "sync", probe.root, "--proposals", "--references", "--dry-run", "--json"],
    probe.ctx,
  );
  expect(result.code).toBe(0);
  expect(CliEnvelopeSchema.parse(JSON.parse(result.stdout))).toMatchObject({
    command: "penpot sync",
    data: { dryRun: true, writes: 0, written: [] },
  });
  expect(probe.fake.counters.mutations).toBe(0);
  expect(hashTree(probe.root, { exclude: [] })).toEqual(before);
  const text = await runCliCaptured(
    ["penpot", "sync", probe.root, "--proposals", "--dry-run"],
    probe.ctx,
  );
  expect(text.stdout).toContain(
    "Dry run: would create 3, update 0; 0 unchanged. Nothing was written.",
  );
});

test("syncs the References page as text cards marked with the mode", async () => {
  const probe = await linkedWorkspace();
  roots.push(probe.root);
  const result = await runCliCaptured(
    ["penpot", "sync", probe.root, "--references", "--json"],
    probe.ctx,
  );
  expect(result.code).toBe(0);
  expect(CliEnvelopeSchema.parse(JSON.parse(result.stdout))).toMatchObject({
    data: {
      mode: "reference-only",
      writes: 1,
      pages: [{ heronId: "heron:references", action: "created" }],
    },
  });
  const page = probe.fake.penpot.currentFile?.pages[0];
  expect(page?.getSharedPluginData("heron", "mode")).toBe("reference-only");
  expect(page?.name).toContain("REFERENCE ONLY");
});

test("renders diagnostics, partial failures and hostile remote text without terminal controls", async () => {
  const probe = await linkedWorkspace();
  roots.push(probe.root);
  if (probe.fake.penpot.currentFile === null) throw new Error("test file absent");
  probe.fake.penpot.currentFile.name = hostileText();
  for (const args of [
    ["penpot", "link"],
    ["penpot", "inspect"],
    ["penpot", "doctor"],
    ["doctor"],
  ]) {
    const result = await runCliCaptured([...args, probe.root], probe.ctx);
    expect(result.code).toBe(0);
    expect(hasControlChars(result.stdout.replaceAll("\n", ""))).toBe(false);
    expect(result.stdout).toContain("\\u{1b}");
  }
  probe.controls.executeFailure = { kind: "script-failed", detail: hostileText() };
  const failed = await runCliCaptured(["penpot", "inspect", probe.root], probe.ctx);
  expect(failed.code).toBe(5);
  expect(hasControlChars(failed.stderr.replaceAll("\n", ""))).toBe(false);
  probe.controls.executeFailure = null;
  let writes = 0;
  probe.controls.beforeExecute = async (_code, timeoutMs) =>
    timeoutMs === probe.ctx.penpot.writeTimeoutMs && ++writes === 2
      ? { ok: false, durationMs: 0, failure: { kind: "timeout", detail: "Synthetic timeout" } }
      : null;
  const partial = await runCliCaptured(
    ["penpot", "sync", probe.root, "--proposals", "--json"],
    probe.ctx,
  );
  expect(partial.code).toBe(5);
  expect(CliEnvelopeSchema.parse(JSON.parse(partial.stdout))).toMatchObject({
    ok: false,
    data: { writes: 1 },
  });
  expect(partial.stdout).not.toContain(CANARY_MCP_KEY);
});
