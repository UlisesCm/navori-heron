import { describe, expect, test } from "bun:test";
import { copyFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { HeronMode } from "../../../src/core/contracts/index.ts";
import { nodeFs } from "../../../src/core/store/fs-port.ts";
import { filesystemAdapter } from "../../../src/intake/adapters/filesystem/index.ts";
import { navoriMasterAdapter } from "../../../src/intake/adapters/navori-master/index.ts";
import { adapterFor } from "../../../src/intake/detect.ts";
import { DEFAULT_INPUT_LIMITS, type AdapterLoadResult } from "../../../src/intake/ports.ts";
import { copyFixture } from "../../helpers/fixtures.ts";

const STAGE = "specs/_master/01-mvp";

/** A filesystem-adapter repo: the membership-product UX files (all, or just those listed) at the root. */
function filesystemRepo(files: readonly ("UX.md" | "ux.json")[]): string {
  const root = copyFixture("membership-product");
  for (const file of files) copyFileSync(join(root, STAGE, file), join(root, file));
  return root;
}

function load(root: string, mode: HeronMode): AdapterLoadResult {
  const request = { root, stage: null, fs: nodeFs, limits: DEFAULT_INPUT_LIMITS };
  const detected = filesystemAdapter.detect(request);
  if (detected.kind !== "detected") throw new Error("expected detected");
  return filesystemAdapter.load({ ...request, report: detected.report, mode });
}

function draftOf(result: AdapterLoadResult) {
  if (!result.ok) throw new Error(result.message);
  return result.draft;
}

const uxSections = new Set(["surfaces", "journeys", "flows", "screens", "patterns", "states"]);

describe("filesystem adapter load", () => {
  test("keeps UX sections empty in reference-only", () => {
    // Covers: R3
    const root = filesystemRepo(["UX.md", "ux.json"]);
    const draft = draftOf(load(root, "reference-only"));
    expect(draft.sources).toEqual([
      { source: "ux.json", path: "ux.json", status: "unused" },
      { source: "UX.md", path: "UX.md", status: "unused" },
    ]);
    expect(draft.candidates.filter((c) => uxSections.has(c.section))).toEqual([]);
    expect(draft.candidates).toEqual([]);
    expect(draft.uxReader).toBeNull();
  });

  test("keeps absent sources empty and reports them", () => {
    // Covers: R3
    const draft = draftOf(load(filesystemRepo([]), "reference-only"));
    expect(draft.sources.map((s) => s.status)).toEqual(["absent", "absent"]);
    expect(draft.candidates).toEqual([]);
  });

  test("a single UX file reaches full and contributes", () => {
    // Covers: R3, R9
    const draft = draftOf(load(filesystemRepo(["ux.json"]), "full"));
    expect(draft.uxReader).toBe("provisional-1");
    expect(draft.sources.map((s) => s.status)).toEqual(["used", "absent"]);
    expect(draft.candidates.some((c) => c.section === "screens")).toBe(true);
    expect(draft.sources[0]?.source).toBe("ux.json");
  });

  test("reads UX.md next to ux.json in full", () => {
    // Covers: R3
    const draft = draftOf(load(filesystemRepo(["UX.md", "ux.json"]), "full"));
    expect(draft.sources.map((s) => `${s.source}:${s.status}`)).toEqual([
      "ux.json:used",
      "UX.md:used",
    ]);
  });

  test("fails with INPUTS_CHANGED when ux.json changes after detection", () => {
    // Covers: R3
    const root = filesystemRepo(["ux.json"]);
    const request = { root, stage: null, fs: nodeFs, limits: DEFAULT_INPUT_LIMITS };
    const detected = filesystemAdapter.detect(request);
    if (detected.kind !== "detected") throw new Error("expected detected");
    writeFileSync(join(root, "ux.json"), "{}\n");
    const result = filesystemAdapter.load({ ...request, report: detected.report, mode: "full" });
    expect(result).toMatchObject({ ok: false, code: "INPUTS_CHANGED" });
  });
});

describe("adapterFor", () => {
  test("returns the default adapter for its id and null otherwise", () => {
    // Covers: R9
    expect(adapterFor("filesystem")).toBe(filesystemAdapter);
    expect(adapterFor("navori-master")).toBe(navoriMasterAdapter);
    expect(adapterFor("manual")).toBeNull();
  });
});
