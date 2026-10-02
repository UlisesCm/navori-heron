// Covers: R4, R5, R8
import { afterEach, expect, test } from "bun:test";
import { existsSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { desiredReviewPages, runPenpotInspect, runPenpotLink } from "../../../src/app/penpot.ts";
import { HERON_PROJECT_DOCUMENT } from "../../../src/core/contracts/index.ts";
import { openWorkspace } from "../../helpers/agents.ts";
import { fixedContext, runCliCaptured } from "../../helpers/cli.ts";
import { hashTree } from "../../helpers/fixtures.ts";
import { directionsWorkspace, linkedWorkspace, CANARY_MCP_KEY } from "../../helpers/penpot.ts";
import { renderScript, reviewScriptData } from "../../../src/penpot/compiler/script.ts";
import { penpotTemplate } from "../../../src/penpot/compiler/templates.ts";
import { runPenpotScript } from "../../helpers/fake-penpot.ts";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

test("links the bound file and reports page statuses read-only", async () => {
  const probe = await directionsWorkspace();
  roots.push(probe.root);
  const result = await runPenpotLink(probe.ctx, { path: probe.root, fileId: "file-1" });
  expect(result).toMatchObject({
    ok: true,
    data: { file: { id: "file-1" }, written: ["project.json"] },
  });
  const ws = openWorkspace(probe.ctx, probe.root);
  expect(ws.project.penpot).toEqual({ enabled: true, fileId: "file-1", url: null, version: null });
  expect(probe.fake.counters.mutations).toBe(0);
  const linked = hashTree(probe.root, { exclude: [] });
  expect(await runPenpotLink(probe.ctx, { path: probe.root, fileId: null })).toMatchObject({
    ok: true,
    data: { written: [], stateRevision: null },
  });
  expect(hashTree(probe.root, { exclude: [] })).toEqual(linked);
  const desired = desiredReviewPages(ws);
  for (const page of desired.slice(0, 2)) {
    const script = renderScript(penpotTemplate("review-page"), reviewScriptData(page, null));
    if (!script.ok) throw new Error("test page exceeded budget");
    await runPenpotScript(probe.fake, script.code);
  }
  const pages = probe.fake.penpot.currentFile?.pages;
  if (pages === undefined || pages.length < 2) throw new Error("test pages missing");
  pages[1]?.setSharedPluginData("heron", "content", "outdated");
  const duplicate = probe.fake.penpot.createPage();
  duplicate.setSharedPluginData("heron", "id", desired[0]?.heronId ?? "missing");
  const before = { ...probe.fake.counters };
  const inspected = await runPenpotInspect(probe.ctx, { path: probe.root });
  expect(inspected.ok).toBe(true);
  if (inspected.ok) {
    expect(inspected.data.bound).toEqual({ fileId: "file-1", matches: true });
    expect(inspected.data.pages.map((page) => page.status)).toEqual([
      "up-to-date",
      "duplicate",
      "outdated",
      "missing",
      "missing",
    ]);
  }
  expect(probe.fake.counters.mutations).toBe(before.mutations);
  expect(hashTree(probe.root, { exclude: [] })).toEqual(linked);
  expect(probe.closed()).toBe(3);
});

test("requires env configuration and refuses explicit file mismatches without writing", async () => {
  const probe = await directionsWorkspace();
  roots.push(probe.root);
  const before = hashTree(probe.root, { exclude: [] });
  expect(await runPenpotLink(fixedContext(), { path: probe.root, fileId: null })).toMatchObject({
    ok: false,
    code: 5,
  });
  expect(await runPenpotInspect(probe.ctx, { path: probe.root })).toMatchObject({
    ok: false,
    code: 3,
  });
  expect(await runPenpotLink(probe.ctx, { path: probe.root, fileId: "different" })).toMatchObject({
    ok: false,
    code: 3,
    findings: [{ code: "PENPOT_FILE_MISMATCH" }],
  });
  expect(hashTree(probe.root, { exclude: [] })).toEqual(before);
  probe.fake.penpot.currentFile = null;
  expect(await runPenpotLink(probe.ctx, { path: probe.root, fileId: null })).toMatchObject({
    ok: false,
    code: 5,
    findings: [{ code: "PENPOT_PLUGIN_NOT_CONNECTED" }],
  });
});

test("warns for rebindings, other connected files and untested versions while ignoring stored hosts", async () => {
  const probe = await linkedWorkspace();
  roots.push(probe.root);
  const ws = openWorkspace(probe.ctx, probe.root);
  const project = {
    ...ws.project,
    penpot: { ...ws.project.penpot, url: "https://evil.test", version: "false-version" },
  };
  writeFileSync(join(probe.root, ".heron/project.json"), JSON.stringify(project));
  if (probe.fake.penpot.currentFile === null) throw new Error("test file absent");
  probe.fake.penpot.currentFile.id = "other-file";
  probe.fake.penpot.version = "99.0.0";
  const before = hashTree(probe.root, { exclude: [] });
  const inspected = await runPenpotInspect(probe.ctx, { path: probe.root });
  expect(inspected).toMatchObject({ ok: true, data: { bound: { matches: false } } });
  expect(inspected.findings.map((finding) => finding.code)).toEqual([
    "PENPOT_VERSION_UNTESTED",
    "PENPOT_FILE_MISMATCH",
  ]);
  expect(hashTree(probe.root, { exclude: [] })).toEqual(before);
  expect(probe.connections[0]?.baseUrl).toBe("http://localhost:9001");
  expect(probe.connections[0]?.key).toBe(CANARY_MCP_KEY);
  const rebound = await runPenpotLink(probe.ctx, { path: probe.root, fileId: null });
  expect(rebound.findings.map((finding) => finding.code)).toContain("PENPOT_FILE_REBOUND");
  expect(
    openWorkspace(probe.ctx, probe.root).store.readDocument("project.json", HERON_PROJECT_DOCUMENT)
      ?.penpot,
  ).toEqual({ enabled: true, fileId: "other-file", url: null, version: null });
});

test("redacts the local MCP key echoed in untrusted file names and findings", async () => {
  const probe = await linkedWorkspace();
  roots.push(probe.root);
  if (probe.fake.penpot.currentFile === null) throw new Error("test file absent");
  probe.fake.penpot.currentFile.name = CANARY_MCP_KEY;
  probe.fake.penpot.currentFile.id = "another-file";
  expect(JSON.stringify(await runPenpotInspect(probe.ctx, { path: probe.root }))).not.toContain(
    CANARY_MCP_KEY,
  );
  expect(
    JSON.stringify(await runPenpotLink(probe.ctx, { path: probe.root, fileId: null })),
  ).not.toContain(CANARY_MCP_KEY);
});

test("does not hold a lock during MCP and rejects a local revision changed during inspection", async () => {
  const probe = await directionsWorkspace();
  roots.push(probe.root);
  const original = probe.ctx.penpot.gateway;
  const ctx = {
    ...probe.ctx,
    penpot: {
      ...probe.ctx.penpot,
      gateway: {
        id: "mcp" as const,
        connect: async (request: Parameters<typeof original.connect>[0]) => {
          expect(existsSync(join(probe.root, ".heron/.lock"))).toBe(false);
          expect(
            (await runCliCaptured(["init", probe.root, "--locale", "es-MX"], probe.ctx)).code,
          ).toBe(0);
          return original.connect(request);
        },
      },
    },
  };
  expect(await runPenpotLink(ctx, { path: probe.root, fileId: null })).toMatchObject({
    ok: false,
    code: 6,
  });
  expect(openWorkspace(probe.ctx, probe.root).project.penpot.enabled).toBe(false);
});
