// Covers: R15
import { afterEach, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { collectPenpotFacts } from "../../../src/app/facts.ts";
import { desiredReviewPages } from "../../../src/app/penpot.ts";
import { reviewRecord } from "../../../src/penpot/compiler/plan.ts";
import { openWorkspace } from "../../helpers/agents.ts";
import { linkedWorkspace } from "../../helpers/penpot.ts";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

test("counts proposal pages written for the current directions in the bound file", async () => {
  const probe = await linkedWorkspace();
  roots.push(probe.root);
  const ws = openWorkspace(probe.ctx, probe.root);
  expect(collectPenpotFacts(ws.store, ws.project)).toEqual({
    penpotEnabled: true,
    penpotProposalsWritten: 0,
  });
  const desired = desiredReviewPages(ws);
  const record = reviewRecord(desired, {
    heron: "inspect@v1",
    penpotVersion: "2.17.2",
    file: { id: "file-1", name: "Test file" },
    unmanagedPages: 0,
    pages: desired.map((page, index) => ({
      pageId: `page-${index}`,
      name: page.name,
      marks: {
        id: page.heronId,
        content: page.contentSha256,
        source: page.sourceSha256,
        template: "review-page@v1",
        mode: page.mode,
      },
    })),
  });
  if (record === null) throw new Error("record missing");
  mkdirSync(join(probe.root, ".heron/penpot"));
  const persist = (): void =>
    writeFileSync(join(probe.root, ".heron/penpot/review-sync.json"), JSON.stringify(record));
  persist();
  expect(collectPenpotFacts(ws.store, ws.project)).toEqual({
    penpotEnabled: true,
    penpotProposalsWritten: 3,
  });
  record.entries.push(...record.entries);
  persist();
  expect(collectPenpotFacts(ws.store, ws.project).penpotProposalsWritten).toBe(3);
  record.file.id = "another-file";
  persist();
  expect(collectPenpotFacts(ws.store, ws.project).penpotProposalsWritten).toBe(0);
  record.file.id = "file-1";
  record.entries = record.entries
    .slice(0, 1)
    .map((entry) => ({ ...entry, sourceSha256: "0".repeat(64) }));
  persist();
  expect(collectPenpotFacts(ws.store, ws.project).penpotProposalsWritten).toBe(0);
  expect(
    collectPenpotFacts(ws.store, {
      ...ws.project,
      penpot: { ...ws.project.penpot, enabled: false },
    }),
  ).toEqual({ penpotEnabled: false, penpotProposalsWritten: 0 });
  expect(
    collectPenpotFacts(ws.store, { ...ws.project, penpot: { ...ws.project.penpot, fileId: null } })
      .penpotEnabled,
  ).toBe(false);
});
