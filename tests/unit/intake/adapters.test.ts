import { describe, expect, test } from "bun:test";
import { copyFileSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { HeronMode } from "../../../src/core/contracts/index.ts";
import { nodeFs } from "../../../src/core/store/fs-port.ts";
import { filesystemAdapter } from "../../../src/intake/adapters/filesystem/index.ts";
import { navoriMasterAdapter } from "../../../src/intake/adapters/navori-master/index.ts";
import { manualAdapter } from "../../../src/intake/adapters/manual/index.ts";
import { markdownAdapter } from "../../../src/intake/adapters/markdown/index.ts";
import { GROWTH_LIMIT_16X, growthRatio } from "../../helpers/timing.ts";
import { adapterFor, detectProject } from "../../../src/intake/detect.ts";
import {
  MAX_CONTEXT_INPUTS,
  parseManualContext,
  validateSelection,
} from "../../../src/intake/inputs.ts";
import {
  DEFAULT_INPUT_LIMITS,
  type AdapterLoadResult,
  type AdapterSelection,
} from "../../../src/intake/ports.ts";
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
  test("returns the default or opt-in adapter for its id", () => {
    // Covers: R9
    expect(adapterFor("filesystem")).toBe(filesystemAdapter);
    expect(adapterFor("navori-master")).toBe(navoriMasterAdapter);
    expect(adapterFor("markdown")).toBe(markdownAdapter);
    expect(adapterFor("manual")).toBe(manualAdapter);
  });
});

const ASSETS = join(import.meta.dir, "../../assets/intake");

/** A temp repo holding the intake assets next to a filesystem-adapter sibling. */
function inputsRepo(): string {
  const root = mkdtempSync(join(tmpdir(), "heron-inputs-"));
  copyFileSync(join(ASSETS, "product-brief.md"), join(root, "brief.md"));
  copyFileSync(join(ASSETS, "manual-context.json"), join(root, "context.json"));
  return root;
}

function selected(adapter: AdapterSelection["adapter"], ...inputs: string[]) {
  return { adapter, inputs } as AdapterSelection;
}

function loadSelected(root: string, selection: AdapterSelection): AdapterLoadResult {
  const request = { root, stage: null, fs: nodeFs, limits: DEFAULT_INPUT_LIMITS, selection };
  const detected = detectProject(request);
  if (detected.kind !== "detected") throw new Error("expected detected");
  const adapter = adapterFor(selection.adapter);
  if (adapter === null) throw new Error("expected adapter");
  return adapter.load({ ...request, report: detected.report, mode: "reference-only" });
}

describe("markdown and manual adapters", () => {
  test("detect only when explicitly selected and stay reference-only", () => {
    // Covers: R9
    const root = inputsRepo();
    const base = { root, stage: null, fs: nodeFs, limits: DEFAULT_INPUT_LIMITS };
    expect(markdownAdapter.detect(base)).toEqual({ kind: "not-detected" });
    expect(manualAdapter.detect({ ...base, selection: selected("markdown", "brief.md") })).toEqual({
      kind: "not-detected",
    });
    const detected = detectProject({ ...base, selection: selected("markdown", "brief.md") });
    if (detected.kind !== "detected") throw new Error("expected detected");
    expect(detected.report.adapter).toBe("markdown");
    expect(detected.report.uxMarkdown.path).toBe("");
    expect(detected.report.findings.map((f) => f.code)).toEqual(["ADAPTER_REFERENCE_ONLY"]);
    // without a selection the default chain still wins
    expect(detectProject(base)).toMatchObject({ report: { adapter: "filesystem" } });
  });

  test("markdown reads each input as context tier elements", () => {
    // Covers: R9
    const draft = draftOf(loadSelected(inputsRepo(), selected("markdown", "brief.md")));
    expect(draft.sources).toEqual([{ source: "context", path: "brief.md", status: "used" }]);
    const sections = new Set(draft.candidates.map((c) => c.section));
    expect(sections).toEqual(
      new Set([
        "product",
        "capabilities",
        "constraints",
        "actors",
        "businessRules",
        "unresolvedQuestions",
      ]),
    );
  });

  test("manual maps a ManualContext with JSON Pointer locators", () => {
    // Covers: R9
    const draft = draftOf(loadSelected(inputsRepo(), selected("manual", "context.json")));
    expect(draft.sources).toEqual([{ source: "manual", path: "context.json", status: "used" }]);
    const rules = draft.candidates.filter((c) => c.section === "businessRules");
    expect(rules.map((c) => [c.key, c.ref.locator])).toEqual([["RN-1", "/businessRules/0"]]);
    expect(draft.candidates.some((c) => c.section === "screens")).toBe(false);
  });

  test("manual skips a vanished input and rejects one that became invalid", () => {
    // Covers: R9
    const root = inputsRepo();
    const gone = draftOf(loadSelected(root, selected("manual", "context.json", "missing.json")));
    expect(gone.sources.map((s) => s.status)).toEqual(["used", "absent"]);
    writeFileSync(join(root, "context.json"), '{"kind":"ManualContext"}');
    expect(loadSelected(root, selected("manual", "context.json"))).toMatchObject({
      ok: false,
      code: "CONTEXT_INPUT_INVALID",
    });
  });
});

const check = (root: string, selection: AdapterSelection) =>
  validateSelection(nodeFs, root, selection, DEFAULT_INPUT_LIMITS);

describe("validateSelection", () => {
  test("accepts valid inputs and rejects wrong extensions, missing and unsafe paths", () => {
    // Covers: R9
    const root = inputsRepo();
    expect(check(root, selected("markdown", "brief.md")).ok).toBe(true);
    expect(check(root, selected("manual", "context.json")).ok).toBe(true);
    expect(check(root, selected("manual", "brief.md"))).toMatchObject({
      ok: false,
      code: "CONTEXT_INPUT_INVALID",
      message: "brief.md must be a .json file for the manual adapter.",
    });
    expect(check(root, selected("markdown", "context.json"))).toMatchObject({
      message: "context.json must be a .md or .markdown file for the markdown adapter.",
    });
    expect(check(root, selected("markdown", "nope.md"))).toMatchObject({ code: "PATH_NOT_FOUND" });
    expect(check(root, selected("markdown", "../outside.md"))).toMatchObject({
      code: "UNSAFE_PATH",
    });
    const outside = mkdtempSync(join(tmpdir(), "heron-outside-"));
    writeFileSync(join(outside, "x.md"), "# x\n");
    symlinkSync(join(outside, "x.md"), join(root, "link.md"));
    expect(check(root, selected("markdown", "link.md"))).toMatchObject({ code: "UNSAFE_PATH" });
  });

  test("caps the number of inputs", () => {
    // Covers: R9
    const inputs = Array.from({ length: MAX_CONTEXT_INPUTS + 1 }, (_, i) => `f${i}.md`);
    expect(check(inputsRepo(), selected("markdown", ...inputs))).toMatchObject({
      code: "CONTEXT_INPUT_INVALID",
      message: "Too many --context files (51); the limit is 50.",
    });
  });

  test("rejects an invalid ManualContext with its issues", () => {
    // Covers: R9
    const root = inputsRepo();
    writeFileSync(
      join(root, "context.json"),
      JSON.stringify({
        kind: "ManualContext",
        schemaVersion: 1,
        product: { name: "X" },
        screens: [],
      }),
    );
    const result = check(root, selected("manual", "context.json"));
    expect(result).toMatchObject({ ok: false, code: "CONTEXT_INPUT_INVALID" });
    if (result.ok) throw new Error("expected failure");
    expect(result.message).toBe(
      "context.json is not a valid ManualContext (1 issue); nothing was written.",
    );
    expect(result.issues).toHaveLength(1);
  });
});

const bytes = (text: string) => new TextEncoder().encode(text);

describe("parseManualContext", () => {
  test("parses the asset and rejects non-UTF-8, non-JSON and UX sections", () => {
    // Covers: R9
    expect(parseManualContext(bytes('{"kind":"ManualContext"')).ok).toBe(false);
    expect(parseManualContext(new Uint8Array([0xff, 0xfe])).ok).toBe(false);
    const withUx = parseManualContext(
      bytes('{"kind":"ManualContext","schemaVersion":1,"product":{"name":"X"},"surfaces":[]}'),
    );
    expect(withUx.ok).toBe(false);
    const valid = parseManualContext(
      bytes('{"kind":"ManualContext","schemaVersion":1,"product":{"name":"X"}}'),
    );
    expect(valid.ok).toBe(true);
  });

  test("stays linear on large adversarial input", () => {
    // Covers: R9
    // Growth ratio instead of absolute ms: linear ~16x for 16x input, quadratic ~256x; immune to load.
    const { ratio } = growthRatio(parseAll(20_000), parseAll(320_000));
    expect(ratio).toBeLessThan(GROWTH_LIMIT_16X);
  });
});

describe("navori-master load without a stage", () => {
  test.each([
    ["an empty stage index", '{"version":1,"stages":[]}', "NO_STAGE"],
    ["an unreadable stage index", "not json", null],
  ])("returns an ok draft with only root-level sources for %s", (_name, body, code) => {
    // Covers: R3
    const root = copyFixture("membership-product");
    writeFileSync(join(root, "specs/_master/index.json"), body);
    const request = { root, stage: null, fs: nodeFs, limits: DEFAULT_INPUT_LIMITS };
    const detected = navoriMasterAdapter.detect(request);
    if (detected.kind !== "detected") throw new Error("expected detected");
    expect(detected.report.stage).toBeNull();
    if (code !== null) expect(detected.report.findings.some((f) => f.code === code)).toBe(true);
    const draft = draftOf(
      navoriMasterAdapter.load({ ...request, report: detected.report, mode: "reference-only" }),
    );
    expect(draft.sources.map((s) => s.source)).toEqual(["navori.config.json"]);
    expect(draft.candidates.every((c) => c.section === "product")).toBe(true);
  });
});

/** Closure parsing two adversarial manual-context payloads of size `n`. */
function parseAll(n: number): () => void {
  const a = bytes(`{"kind":"ManualContext","product":{"name":"${"\\".repeat(n)}`);
  const b = bytes("[".repeat(n));
  return () => {
    parseManualContext(a);
    parseManualContext(b);
  };
}
