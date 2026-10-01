// Covers: R15
import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { collectDirectionFacts, collectResearchFacts } from "../../../src/app/facts.ts";
import {
  canonicalJson,
  type GateDecision,
  type HeronState,
  type ResearchReference,
} from "../../../src/core/contracts/index.ts";
import { createInitialState } from "../../../src/core/state/lifecycle.ts";
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

describe("collectDirectionFacts", () => {
  const meta = {
    runId: "run-20260930T120000Z-3f9a1c2b",
    at: "2026-09-30T12:00:00.000Z",
    command: "init",
    heronVersion: "0.0.0",
  } as const;

  function stateWith(gates: GateDecision[]): HeronState {
    return { ...createInitialState({ mode: "full", meta, artifacts: [] }), gates };
  }

  function decision(decided: GateDecision["decision"], sha256: string): GateDecision {
    return {
      gate: "research",
      decision: decided,
      decidedBy: "ana",
      decidedAt: meta.at,
      artifacts: [{ path: "research/references.json", sha256 }],
      stateRevision: 2,
      runId: meta.runId,
      note: null,
    } as GateDecision;
  }

  // Covers: R11
  test("reports whether the latest research approval still matches its artifacts", () => {
    const store = storeWith([sampleReference()]);
    const sha = store.sha256("research/references.json") ?? "";
    expect(collectDirectionFacts(store, stateWith([]))).toEqual({ researchApprovalValid: false });
    expect(collectDirectionFacts(store, stateWith([decision("approved", sha)]))).toEqual({
      researchApprovalValid: true,
    });
    expect(collectDirectionFacts(store, stateWith([decision("approved", "0".repeat(64))]))).toEqual(
      { researchApprovalValid: false },
    );
    expect(
      collectDirectionFacts(
        store,
        stateWith([decision("approved", sha), decision("rejected", sha)]),
      ),
    ).toEqual({ researchApprovalValid: false });
  });
});
