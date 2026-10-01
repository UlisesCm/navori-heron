// Covers: R15
import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { collectResearchFacts } from "../../../src/app/facts.ts";
import { canonicalJson, type ResearchReference } from "../../../src/core/contracts/index.ts";
import { openFileStore } from "../../../src/core/store/file-store.ts";
import { nodeFs } from "../../../src/core/store/fs-port.ts";
import { sampleReference } from "../../helpers/research.ts";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function storeWith(references: ResearchReference[] | null) {
  const root = mkdtempSync(join(tmpdir(), "heron-facts-"));
  dirs.push(root);
  mkdirSync(join(root, ".heron", "research"), { recursive: true });
  if (references !== null) {
    writeFileSync(
      join(root, ".heron", "research", "references.json"),
      canonicalJson({
        kind: "ResearchReferences",
        schemaVersion: 1,
        mode: "reference-only",
        references,
      }),
    );
  }
  return openFileStore(nodeFs, root, { create: false });
}

describe("collectResearchFacts", () => {
  test("counts active references with complete provenance and carries the minimum", () => {
    const removed = sampleReference({
      id: "REF-3",
      removed: { at: "2026-09-30T12:00:00.000Z", reason: null },
    });
    const store = storeWith([sampleReference(), sampleReference({ id: "REF-2" }), removed]);
    expect(collectResearchFacts(store, { minReferences: 5 })).toEqual({
      referencesWithProvenance: 2,
      minReferences: 5,
    });
    // absent references.json counts as zero
    expect(collectResearchFacts(storeWith(null), { minReferences: 3 })).toEqual({
      referencesWithProvenance: 0,
      minReferences: 3,
    });
  });
});
