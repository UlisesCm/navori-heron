// Covers: R10, R11, R12, R13, R14, R15, R16, R17
import { afterEach, expect, test } from "bun:test";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runPenpotSync } from "../../../src/app/penpot-sync.ts";
import { collectPenpotFacts } from "../../../src/app/facts.ts";
import { PENPOT_SYNC_STATE_DOCUMENT, type HeronState } from "../../../src/core/contracts/index.ts";
import { runPenpotScript, type FakeShape } from "../../helpers/fake-penpot.ts";
import { openWorkspace } from "../../helpers/agents.ts";
import { hashTree } from "../../helpers/fixtures.ts";
import { CANARY_MCP_KEY, linkedWorkspace } from "../../helpers/penpot.ts";
import { runCliCaptured } from "../../helpers/cli.ts";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
const syncInput = (root: string) => ({
  path: root,
  proposals: true,
  references: false,
  dryRun: false,
});
const shapes = (shape: FakeShape): FakeShape[] =>
  shape.children.flatMap((child) => [child, ...shapes(child)]);

test("writes one idempotent page per direction with its visual proposal", async () => {
  const probe = await linkedWorkspace();
  roots.push(probe.root);
  const first = await runPenpotSync(probe.ctx, syncInput(probe.root));
  expect(first).toMatchObject({
    ok: true,
    data: { writes: 3, written: ["penpot/review-sync.json"] },
  });
  expect(probe.calls).toHaveLength(5);
  const pages = probe.fake.penpot.currentFile?.pages ?? [];
  expect(pages).toHaveLength(3);
  for (const page of pages) {
    expect(page.getSharedPluginData("heron", "id")).toMatch(/^heron:proposal:DIR-[ABC]$/);
    expect(page.getSharedPluginData("heron", "content")).toHaveLength(64);
    const all = shapes(page.root);
    expect(new Set(all.map((shape) => shape.getSharedPluginData("heron", "id"))).size).toBe(
      all.length,
    );
    expect(all.filter((shape) => shape.type === "board").length).toBeGreaterThan(6);
  }
  const ws = openWorkspace(probe.ctx, probe.root);
  expect(collectPenpotFacts(ws.store, ws.project).penpotProposalsWritten).toBe(3);
  const settled = hashTree(probe.root, { exclude: [] });
  const mutations = probe.fake.counters.mutations;
  probe.calls.length = 0;
  const second = await runPenpotSync(probe.ctx, syncInput(probe.root));
  expect(second).toMatchObject({ ok: true, data: { writes: 0, written: [], stateRevision: null } });
  expect(probe.calls).toHaveLength(1);
  expect(probe.fake.counters.mutations).toBe(mutations);
  expect(hashTree(probe.root, { exclude: [] })).toEqual(settled);
});

test("marks proposal pages reference-only and writes no production artifacts", async () => {
  const probe = await linkedWorkspace();
  roots.push(probe.root);
  const phase = openWorkspace(probe.ctx, probe.root).state.phase;
  expect((await runPenpotSync(probe.ctx, syncInput(probe.root))).ok).toBe(true);
  for (const page of probe.fake.penpot.currentFile?.pages ?? []) {
    expect(page.getSharedPluginData("heron", "mode")).toBe("reference-only");
    expect(page.name).toContain("REFERENCE ONLY");
    expect(
      shapes(page.root)
        .filter((shape) => shape.type === "text")
        .some((shape) => shape.characters.includes("SYNTHETIC")),
    ).toBe(true);
  }
  expect(openWorkspace(probe.ctx, probe.root).state.phase).toBe(phase);
  for (const path of ["design", "tokens", "penpot/sync-state.json"])
    expect(existsSync(join(probe.root, ".heron", path))).toBe(false);
});

test("refuses to write into a file other than the bound one", async () => {
  const probe = await linkedWorkspace();
  roots.push(probe.root);
  if (probe.fake.penpot.currentFile === null) throw new Error("test file absent");
  probe.fake.penpot.currentFile.id = "other-file";
  const before = hashTree(probe.root, { exclude: [] });
  expect(await runPenpotSync(probe.ctx, syncInput(probe.root))).toMatchObject({
    ok: false,
    code: 3,
    findings: [{ code: "PENPOT_FILE_MISMATCH" }],
  });
  expect(probe.fake.counters.mutations).toBe(0);
  expect(hashTree(probe.root, { exclude: [] })).toEqual(before);
});

test("stops at a failed page and converges on the next run", async () => {
  const probe = await linkedWorkspace();
  roots.push(probe.root);
  let writes = 0;
  probe.controls.beforeExecute = async (_code, timeoutMs) =>
    timeoutMs === probe.ctx.penpot.writeTimeoutMs && ++writes === 2
      ? {
          ok: false,
          failure: { kind: "plugin-not-connected", detail: `${CANARY_MCP_KEY} disconnected` },
          durationMs: 0,
        }
      : null;
  const first = await runPenpotSync(probe.ctx, syncInput(probe.root));
  expect(first).toMatchObject({
    ok: false,
    code: 5,
    data: { writes: 1, written: ["penpot/review-sync.json"] },
  });
  expect(first.findings.map((finding) => finding.code)).toContain("PENPOT_SYNC_PARTIAL");
  expect(JSON.stringify(first)).not.toContain(CANARY_MCP_KEY);
  const ws = openWorkspace(probe.ctx, probe.root);
  expect(
    ws.store.readDocument("penpot/review-sync.json", PENPOT_SYNC_STATE_DOCUMENT)?.entries,
  ).toHaveLength(1);
  expect(writes).toBe(2);
  probe.controls.beforeExecute = null;
  expect(await runPenpotSync(probe.ctx, syncInput(probe.root))).toMatchObject({
    ok: true,
    data: { writes: 2 },
  });
  expect(probe.fake.penpot.currentFile?.pages).toHaveLength(3);
});

test("converges after a write timeout whose script finishes late", async () => {
  const probe = await linkedWorkspace();
  roots.push(probe.root);
  let release!: () => void; // Promise executor below installs it synchronously.
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  let late: Promise<unknown> | null = null;
  probe.fake.controls.beforeOpen = async () => waiting;
  probe.controls.beforeExecute = async (code, timeoutMs) => {
    if (timeoutMs !== probe.ctx.penpot.writeTimeoutMs) return null;
    probe.controls.beforeExecute = null;
    late = runPenpotScript(probe.fake, code);
    return {
      ok: false,
      durationMs: timeoutMs,
      failure: { kind: "timeout", detail: "Synthetic client deadline" },
    };
  };
  expect(await runPenpotSync(probe.ctx, syncInput(probe.root))).toMatchObject({
    ok: false,
    code: 5,
  });
  probe.fake.controls.beforeOpen = null;
  expect((await runPenpotSync(probe.ctx, syncInput(probe.root))).ok).toBe(true);
  release();
  await late;
  expect((await runPenpotSync(probe.ctx, syncInput(probe.root))).ok).toBe(true);
  const ws = openWorkspace(probe.ctx, probe.root);
  expect(collectPenpotFacts(ws.store, ws.project).penpotProposalsWritten).toBe(3);
  for (const page of probe.fake.penpot.currentFile?.pages ?? []) {
    const all = shapes(page.root);
    expect(new Set(all.map((shape) => shape.getSharedPluginData("heron", "id"))).size).toBe(
      all.length,
    );
  }
  expect(await runPenpotSync(probe.ctx, syncInput(probe.root))).toMatchObject({
    ok: true,
    data: { writes: 0 },
  });
});

test("dry-run writes nothing and missing or stale sources fail before connecting", async () => {
  const probe = await linkedWorkspace();
  roots.push(probe.root);
  const before = hashTree(probe.root, { exclude: [] });
  expect(await runPenpotSync(probe.ctx, { ...syncInput(probe.root), dryRun: true })).toMatchObject({
    ok: true,
    data: {
      writes: 0,
      pages: [{ action: "would-create" }, { action: "would-create" }, { action: "would-create" }],
    },
  });
  expect(hashTree(probe.root, { exclude: [] })).toEqual(before);
  expect(probe.fake.counters.mutations).toBe(0);
  probe.connections.length = 0;
  const statePath = join(probe.root, ".heron/state.json");
  const state = JSON.parse(readFileSync(statePath, "utf8")) as HeronState;
  state.stale.push({
    path: "research/visual-directions.json",
    reason: "Synthetic stale directions",
    since: state.stateRevision,
  });
  writeFileSync(statePath, JSON.stringify(state));
  expect(await runPenpotSync(probe.ctx, syncInput(probe.root))).toMatchObject({
    ok: false,
    code: 3,
    findings: [{ code: "PENPOT_SOURCE_UNAVAILABLE" }],
  });
  expect(probe.connections).toHaveLength(0);
  expect(
    await runPenpotSync(probe.ctx, { ...syncInput(probe.root), proposals: false }),
  ).toMatchObject({ ok: false, code: 2 });
});

test("preserves human shapes inside managed boards and resumes after they are moved out", async () => {
  const probe = await linkedWorkspace();
  roots.push(probe.root);
  expect((await runPenpotSync(probe.ctx, syncInput(probe.root))).ok).toBe(true);
  const first = probe.fake.penpot.currentFile?.pages[0];
  if (first === undefined) throw new Error("test page absent");
  await probe.fake.penpot.openPage(first);
  const human = probe.fake.penpot.createRectangle();
  human.name = "Human rectangle";
  const board = first.root.children.find((shape) => shape.type === "board");
  if (board === undefined) throw new Error("test board absent");
  board.appendChild(human);
  first.setSharedPluginData("heron", "content", "outdated");
  const before = probe.fake.counters.mutations;
  expect(await runPenpotSync(probe.ctx, syncInput(probe.root))).toMatchObject({
    ok: false,
    code: 3,
  });
  expect(probe.fake.counters.mutations).toBe(before);
  expect(shapes(first.root)).toContain(human);
  first.root.appendChild(human);
  expect((await runPenpotSync(probe.ctx, syncInput(probe.root))).ok).toBe(true);
  expect(first.root.children).toContain(human);
});

test("recovers the local record after another command changes the workspace during writes", async () => {
  const probe = await linkedWorkspace();
  roots.push(probe.root);
  let changed = false;
  probe.controls.beforeExecute = async (_code, timeoutMs) => {
    expect(existsSync(join(probe.root, ".heron/.lock"))).toBe(false);
    if (!changed && timeoutMs === probe.ctx.penpot.writeTimeoutMs) {
      changed = true;
      expect((await runCliCaptured(["init", probe.root, "--locale", "en"], probe.ctx)).code).toBe(
        0,
      );
    }
    return null;
  };
  expect(await runPenpotSync(probe.ctx, syncInput(probe.root))).toMatchObject({
    ok: false,
    code: 6,
  });
  expect(existsSync(join(probe.root, ".heron/penpot/review-sync.json"))).toBe(false);
  probe.controls.beforeExecute = null;
  expect(await runPenpotSync(probe.ctx, syncInput(probe.root))).toMatchObject({
    ok: true,
    data: { writes: 0, written: ["penpot/review-sync.json"] },
  });
});

test("keeps confirmed proposal facts when syncing only References", async () => {
  const probe = await linkedWorkspace();
  roots.push(probe.root);
  expect((await runPenpotSync(probe.ctx, syncInput(probe.root))).ok).toBe(true);
  expect(
    (
      await runPenpotSync(probe.ctx, {
        ...syncInput(probe.root),
        proposals: false,
        references: true,
      })
    ).ok,
  ).toBe(true);
  const ws = openWorkspace(probe.ctx, probe.root);
  expect(collectPenpotFacts(ws.store, ws.project).penpotProposalsWritten).toBe(3);
});

test("records only confirmed pages after a script fails midway and skips an identical failed record", async () => {
  const probe = await linkedWorkspace();
  roots.push(probe.root);
  probe.fake.controls.failText = true;
  expect(await runPenpotSync(probe.ctx, syncInput(probe.root))).toMatchObject({
    ok: false,
    code: 5,
    data: { writes: 0 },
  });
  const ws = openWorkspace(probe.ctx, probe.root);
  expect(
    ws.store.readDocument("penpot/review-sync.json", PENPOT_SYNC_STATE_DOCUMENT)?.entries,
  ).toHaveLength(0);
  const before = hashTree(join(probe.root, ".heron"), { exclude: ["logs"] });
  expect(await runPenpotSync(probe.ctx, syncInput(probe.root))).toMatchObject({
    ok: false,
    code: 5,
    data: { written: [], stateRevision: null },
  });
  expect(hashTree(join(probe.root, ".heron"), { exclude: ["logs"] })).toEqual(before);
  probe.fake.controls.failText = false;
  expect(await runPenpotSync(probe.ctx, syncInput(probe.root))).toMatchObject({
    ok: true,
    data: { writes: 3 },
  });
  expect(probe.fake.penpot.currentFile?.pages).toHaveLength(3);
});

test("refreshes file metadata and tracks duplicates without rewriting confirmed pages", async () => {
  const probe = await linkedWorkspace();
  roots.push(probe.root);
  expect((await runPenpotSync(probe.ctx, syncInput(probe.root))).ok).toBe(true);
  if (probe.fake.penpot.currentFile === null) throw new Error("test file absent");
  probe.fake.penpot.currentFile.name = "Renamed file";
  const first = probe.fake.penpot.currentFile.pages[0];
  if (first === undefined) throw new Error("test page absent");
  const duplicate = probe.fake.penpot.createPage();
  duplicate.setSharedPluginData("heron", "id", first.getSharedPluginData("heron", "id") ?? "");
  const mutations = probe.fake.counters.mutations;
  const result = await runPenpotSync(probe.ctx, syncInput(probe.root));
  expect(result).toMatchObject({
    ok: true,
    data: { writes: 0, written: ["penpot/review-sync.json"] },
  });
  expect(result.findings.map((finding) => finding.code)).toContain("PENPOT_DUPLICATE_PAGE");
  expect(probe.fake.counters.mutations).toBe(mutations);
  expect(
    openWorkspace(probe.ctx, probe.root).store.readDocument(
      "penpot/review-sync.json",
      PENPOT_SYNC_STATE_DOCUMENT,
    )?.file.name,
  ).toBe("Renamed file");
});
