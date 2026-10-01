// Covers: R11, R15
import { describe, expect, test } from "bun:test";
import { makeFinding } from "../../src/app/result.ts";
import { COMMANDS } from "../../src/cli/commands/index.ts";
import {
  BRAND_INPUTS_DOCUMENT,
  CLI_COMMANDS,
  DOCTOR_CHECK_IDS,
  CLI_ENVELOPE_DOCUMENT,
  REFERENCE_BATCH_DOCUMENT,
  RESEARCH_PROVENANCE_DOCUMENT,
  RESEARCH_REFERENCES_DOCUMENT,
  InputFileRecordSchema,
  type BrandInput,
  type ResearchReference,
  CONTRACT_DOCUMENTS,
  ADAPTER_IDS,
  FINDING_CODES,
  FINDING_CODE_PATTERN,
  StoredFindingSchema,
  ExitCode,
  HERON_PHASES,
  HERON_PROJECT_DOCUMENT,
  HERON_STATE_DOCUMENT,
  InvalidDocumentError,
  MODE_DECISION_DOCUMENT,
  PRODUCTION_PHASES,
  UnsupportedSchemaVersionError,
  canonicalJson,
  formatUnsupportedVersionMessage,
  parseVersionedDocument,
  toJsonPointer,
  type HeronProject,
  type HeronState,
} from "../../src/core/contracts/index.ts";

import { sampleReference } from "../helpers/research.ts";

const project: HeronProject = {
  kind: "HeronProject",
  schemaVersion: 1,
  source: { adapter: "filesystem", specsDir: null, stage: null },
  penpot: { enabled: false, url: null, fileId: null, version: null },
};
const state: HeronState = {
  kind: "HeronState",
  schemaVersion: 1,
  stateRevision: 1,
  mode: "reference-only",
  phase: "initialized",
  designRevision: 0,
  artifacts: [],
  gates: [],
  stale: [],
  history: [],
};

const bad = (raw: unknown): InvalidDocumentError => {
  try {
    parseVersionedDocument(raw, HERON_PROJECT_DOCUMENT, "p");
  } catch (e) {
    if (e instanceof InvalidDocumentError) return e;
  }
  throw new Error("expected InvalidDocumentError");
};

const ok = (gates: unknown[]): boolean =>
  HERON_STATE_DOCUMENT.schema.safeParse({ ...state, gates }).success;

const row = (event: string) =>
  HERON_STATE_DOCUMENT.schema.safeParse({
    ...state,
    history: [
      {
        stateRevision: 1,
        runId: "run-20260930T120000Z-3f9a1c2b",
        command: "gate approve",
        heronVersion: "0.1.0",
        at: "2026-09-30T12:00:00.000Z",
        mode: "full",
        transition: {
          from: "initialized",
          event,
          to: "intake-ready",
          precondition: "intake-context-valid",
          production: false,
        },
      },
    ],
  }).success;

describe("versioned documents", () => {
  test("rejects an unknown schemaVersion naming the supported one", () => {
    const raw = { ...state, schemaVersion: 2 };
    let caught: unknown;
    try {
      parseVersionedDocument(raw, HERON_STATE_DOCUMENT, ".heron/state.json");
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(UnsupportedSchemaVersionError);
    const err = caught as UnsupportedSchemaVersionError;
    expect(err.found).toBe(2);
    expect(err.supported).toBe(1);
    expect(err.message).toBe(
      formatUnsupportedVersionMessage(".heron/state.json", "HeronState", 2, 1),
    );
    expect(err.message).toContain("this Heron supports schemaVersion 1");
  });

  test("parses a valid document and preserves unknown fields", () => {
    const parsed = parseVersionedDocument(
      { ...project, extra: 1 } as unknown,
      HERON_PROJECT_DOCUMENT,
      "p",
    );
    expect(parsed as unknown).toEqual({ ...project, extra: 1 });
  });

  test("rejects malformed documents with pointers", () => {
    expect(bad(null).issues[0]?.pointer).toBe("");
    expect(bad([]).issues[0]?.pointer).toBe("");
    expect(bad({ ...project, kind: "HeronState" }).issues[0]?.pointer).toBe("/kind");
    expect(bad({ ...project, schemaVersion: "1" }).issues[0]?.pointer).toBe("/schemaVersion");
    expect(bad({ ...project, schemaVersion: 1.5 }).issues[0]?.pointer).toBe("/schemaVersion");
    const err = bad({
      ...project,
      penpot: { enabled: "yes", url: null, fileId: null, version: null },
    });
    expect(err.issues[0]?.pointer).toBe("/penpot/enabled");
    expect(err.message).toContain("/penpot/enabled");
  });

  // Covers: R1, R18
  test("validates every registered document kind and its schema file name", () => {
    // P1/P2 are a fixed prefix; later specs only append, so nothing else is counted or listed.
    const baseSchemaFiles = [
      "heron-project.v1.schema.json",
      "heron-state.v1.schema.json",
      "mode-decision.v1.schema.json",
      "cli-envelope.v1.schema.json",
      "research-references.v1.schema.json",
      "research-provenance.v1.schema.json",
      "brand-inputs.v1.schema.json",
      "reference-batch.v1.schema.json",
    ];
    const schemaFiles = CONTRACT_DOCUMENTS.map((d) => d.schemaFile);
    expect(schemaFiles.slice(0, baseSchemaFiles.length)).toEqual(baseSchemaFiles);
    expect(new Set(schemaFiles).size).toBe(schemaFiles.length);
    expect(new Set(CONTRACT_DOCUMENTS.map((d) => d.kind)).size).toBe(CONTRACT_DOCUMENTS.length);
    for (const doc of CONTRACT_DOCUMENTS) {
      expect(doc.schemaFile).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*\.v\d+\.schema\.json$/);
      expect(doc.schemaFile.includes(`.v${doc.schemaVersion}.`)).toBe(true);
    }
    expect(MODE_DECISION_DOCUMENT.kind).toBe("ModeDecision");
    expect(CLI_ENVELOPE_DOCUMENT.kind).toBe("CliEnvelope");
  });
});

describe("state shapes", () => {
  test("production phases run from direction-selected to exported", () => {
    expect(PRODUCTION_PHASES[0]).toBe("direction-selected");
    expect(PRODUCTION_PHASES.at(-1)).toBe(HERON_PHASES.at(-1));
    expect(HERON_PHASES).toHaveLength(13);
  });

  test("gate decisions are a discriminated union", () => {
    const base = {
      gate: "intake",
      decidedBy: "ulises",
      decidedAt: "2026-09-30T12:00:00.000Z",
      artifacts: [{ path: "intake/mode.json", sha256: "a".repeat(64) }],
      stateRevision: 2,
      runId: "run-20260930T120000Z-3f9a1c2b",
    };
    expect(ok([{ ...base, decision: "approved", note: null }])).toBe(true);
    expect(ok([{ ...base, decision: "rejected", reason: "no" }])).toBe(true);
    expect(ok([{ ...base, decision: "rejected", reason: "" }])).toBe(false);
    expect(ok([{ ...base, decision: "approved" }])).toBe(false);
    expect(
      ok([
        {
          ...base,
          decision: "approved",
          note: null,
          artifacts: [{ path: "../x", sha256: "a".repeat(64) }],
        },
      ]),
    ).toBe(false);
  });

  test("transition event keys accept template forms only", () => {
    expect(row("approve-gate:intake")).toBe(true);
    expect(row("revise:researching")).toBe(true);
    expect(row("reference-added")).toBe(true);
    expect(row("approve-gate:nope")).toBe(false);
  });
});

describe("envelope", () => {
  test("accepts an error envelope without data", () => {
    const env = {
      kind: "CliEnvelope",
      schemaVersion: 1,
      command: "unknown",
      ok: false,
      code: ExitCode.Usage,
      data: null,
      findings: [],
      runId: "run-20260930T120000Z-3f9a1c2b",
      durationMs: 3,
      next: [],
    };
    expect(CLI_ENVELOPE_DOCUMENT.schema.safeParse(env).success).toBe(true);
    expect(CLI_ENVELOPE_DOCUMENT.schema.safeParse({ ...env, code: 9 }).success).toBe(false);
    const doctor = { ...env, command: "doctor", ok: true, code: 0, data: { checks: [] } };
    expect(CLI_ENVELOPE_DOCUMENT.schema.safeParse(doctor).success).toBe(true);
  });
});

describe("canonical json and pointers", () => {
  test("sorts keys at every depth and ends with a newline", () => {
    expect(canonicalJson({ b: [{ z: 1, a: null }], a: "x" })).toBe(
      '{\n  "a": "x",\n  "b": [\n    {\n      "a": null,\n      "z": 1\n    }\n  ]\n}\n',
    );
  });

  test("rejects values JSON cannot represent", () => {
    expect(() => canonicalJson(undefined)).toThrow(TypeError);
    expect(() => canonicalJson({ a: Number.NaN })).toThrow(TypeError);
    expect(() => canonicalJson({ a: 1n })).toThrow(TypeError);
    expect(() => canonicalJson({ a: Infinity })).toThrow(TypeError);
  });

  test("escapes JSON pointer segments", () => {
    expect(toJsonPointer(["screens", 1, "surface"])).toBe("/screens/1/surface");
    expect(toJsonPointer(["a/b", "c~d"])).toBe("/a~1b/c~0d");
    expect(toJsonPointer([])).toBe("");
  });
});

const stored = (code: unknown): boolean =>
  StoredFindingSchema.safeParse({
    code,
    severity: "info",
    message: "m",
    paths: [],
    issues: [],
  }).success;

describe("finding codes", () => {
  test("stores finding codes as formatted strings and keeps the emitter union closed", () => {
    expect(stored("RESEARCH_REFERENCE_MISSING")).toBe(true);
    expect(stored("A1_B2")).toBe(true);
    for (const code of ["lower", "_LEADING", "1ABC", "HAS-DASH", "", 7])
      expect(stored(code)).toBe(false);
    expect(FINDING_CODES.every((code) => FINDING_CODE_PATTERN.test(code))).toBe(true);
    // @ts-expect-error emitters only accept the closed FindingCode union
    makeFinding("NOT_A_CODE", "info", "m");
    expect(ADAPTER_IDS).toEqual(["navori-master", "filesystem", "markdown", "manual"]);
    expect(
      HERON_PROJECT_DOCUMENT.schema.safeParse({ ...project, product: { locale: "es" } }).success,
    ).toBe(true);
  });
});

const HASH = "a".repeat(64);
const parses = (spec: { schema: { safeParse(v: unknown): { success: boolean } } }, v: unknown) =>
  spec.schema.safeParse(v).success;
const asset = {
  path: `research/assets/${HASH}.webp`,
  sha256: HASH,
  mediaType: "image/webp",
  width: 100,
  height: 50,
  bytes: 10,
  trust: "untrusted",
  original: { sha256: HASH, mediaType: "image/png", bytes: 20 },
  removedMetadata: ["exif"],
};
const content = {
  path: `research/sources/${HASH}.md`,
  sha256: HASH,
  mediaType: "text/markdown",
  bytes: 4,
  trust: "untrusted",
};
const fetched = {
  requestedUrl: "https://example.com/",
  finalUrl: "https://example.com/",
  status: 200,
  redirects: [],
  address: "93.184.216.34",
  local: false,
};
const refsDoc = (references: unknown[]) => ({
  kind: "ResearchReferences",
  schemaVersion: 1,
  mode: "reference-only",
  references,
});

const brandDoc = (input: BrandInput) => ({
  kind: "BrandInputs",
  schemaVersion: 1,
  mode: "full",
  inputs: [input],
});

const batch = (references: unknown[]) => ({
  kind: "ReferenceBatch",
  schemaVersion: 1,
  references,
});

const researchEnvelope = (command: string, data: unknown) => ({
  kind: "CliEnvelope",
  schemaVersion: 1,
  command,
  ok: true,
  code: 0,
  data,
  findings: [{ code: "SSRF_BLOCKED", severity: "error", message: "m", paths: [], issues: [] }],
  runId: "run-20260930T120000Z-3f9a1c2b",
  durationMs: 1,
  next: [],
});

describe("research documents", () => {
  test("validates references with their capture, list and crop rules", () => {
    const image = sampleReference({
      id: "REF-2",
      source: "image",
      capture: {
        kind: "image",
        method: "screenshot",
        file: { name: "home.png", location: "external" },
        image: asset as never,
      },
      crops: [{ x: 10, y: 10, width: 90, height: 40, note: "hero" }],
    });
    const url = sampleReference({
      id: "REF-3",
      source: "url",
      capture: { kind: "url", fetch: fetched, content: content as never },
    });
    const designMd = (fetch: unknown, file: unknown) =>
      ({
        ...sampleReference({ id: "REF-4", source: "design-md" }),
        capture: { kind: "design-md", fetch, file, content },
      }) as unknown;
    expect(parses(RESEARCH_REFERENCES_DOCUMENT, refsDoc([sampleReference(), image, url]))).toBe(
      true,
    );
    expect(parses(RESEARCH_REFERENCES_DOCUMENT, refsDoc([designMd(fetched, null)]))).toBe(true);
    expect(
      parses(
        RESEARCH_REFERENCES_DOCUMENT,
        refsDoc([designMd(null, { name: "DESIGN.md", location: "repo" })]),
      ),
    ).toBe(true);
    // exactly one of fetch/file
    expect(parses(RESEARCH_REFERENCES_DOCUMENT, refsDoc([designMd(null, null)]))).toBe(false);
    expect(
      parses(
        RESEARCH_REFERENCES_DOCUMENT,
        refsDoc([designMd(fetched, { name: "DESIGN.md", location: "repo" })]),
      ),
    ).toBe(false);

    const invalid = (overrides: Partial<ResearchReference>): boolean =>
      parses(RESEARCH_REFERENCES_DOCUMENT, refsDoc([sampleReference(overrides)]));
    expect(invalid({ id: "REF-0" })).toBe(false);
    expect(invalid({ source: "url" })).toBe(false); // source !== capture.kind
    expect(invalid({ reason: "" })).toBe(false);
    expect(invalid({ studies: [] })).toBe(false);
    expect(invalid({ studies: [" padded"] })).toBe(false);
    expect(invalid({ studies: ["Same", "same"] })).toBe(false);
    expect(invalid({ studies: Array.from({ length: 21 }, (_, i) => `s${i}`) })).toBe(false);
    expect(invalid({ crops: [{ x: 0, y: 0, width: 1, height: 1, note: "n" }] })).toBe(false); // manual
    const outside = { ...image, crops: [{ x: 60, y: 0, width: 50, height: 10, note: "n" }] };
    expect(parses(RESEARCH_REFERENCES_DOCUMENT, refsDoc([outside]))).toBe(false);
    expect(InputFileRecordSchema.safeParse({ name: "a/b.png", location: "repo" }).success).toBe(
      false,
    );
    for (const name of ["a\\b.png", "a\nb.png", "a\u0007b.png", ""]) {
      expect(InputFileRecordSchema.safeParse({ name, location: "repo" }).success).toBe(false);
    }
    expect(InputFileRecordSchema.safeParse({ name: "home.png", location: "repo" }).success).toBe(
      true,
    );
  });

  test("validates provenance, brand inputs and the strict batch", () => {
    const entry = {
      reference: "REF-1",
      source: "manual",
      origin: "x",
      capturedAt: "2026-09-30T12:00:00.000Z",
      mode: "reference-only",
      removed: false,
      fetch: null,
      file: null,
      files: [
        {
          path: content.path,
          sha256: HASH,
          mediaType: "text/markdown",
          trust: "untrusted",
          originalSha256: null,
        },
      ],
      securityFindings: [
        {
          code: "SUSPICIOUS_INSTRUCTION",
          severity: "warning",
          message: "m",
          path: content.path,
          offset: 3,
          line: 1,
          phrase: "ignore previous instructions",
          rule: "override-instructions",
        },
      ],
    };
    const provenance = {
      kind: "ResearchProvenance",
      schemaVersion: 1,
      mode: "reference-only",
      references: { path: "research/references.json", sha256: HASH },
      entries: [entry],
    };
    expect(parses(RESEARCH_PROVENANCE_DOCUMENT, provenance)).toBe(true);
    expect(
      parses(RESEARCH_PROVENANCE_DOCUMENT, {
        ...provenance,
        references: { path: "other", sha256: HASH },
      }),
    ).toBe(false);

    const brand: BrandInput = {
      id: "BRAND-1",
      kind: "logo",
      origin: "provided",
      value: "logo",
      note: null,
      derivedFrom: null,
      image: null,
      file: null,
      capturedAt: "2026-09-30T12:00:00.000Z",
      mode: "full",
    };
    expect(parses(BRAND_INPUTS_DOCUMENT, brandDoc(brand))).toBe(true);
    expect(parses(BRAND_INPUTS_DOCUMENT, brandDoc({ ...brand, derivedFrom: "REF-1" }))).toBe(false);
    expect(parses(BRAND_INPUTS_DOCUMENT, brandDoc({ ...brand, origin: "reference-derived" }))).toBe(
      false,
    );
    expect(
      parses(
        BRAND_INPUTS_DOCUMENT,
        brandDoc({ ...brand, origin: "reference-derived", derivedFrom: "REF-1" }),
      ),
    ).toBe(true);
    expect(parses(BRAND_INPUTS_DOCUMENT, brandDoc({ ...brand, kind: "mascot" as never }))).toBe(
      false,
    );

    const item = { source: "manual", origin: "o", doNotCopy: ["x"] };
    expect(parses(REFERENCE_BATCH_DOCUMENT, batch([item]))).toBe(true);
    expect(parses(REFERENCE_BATCH_DOCUMENT, batch([{ ...item, doNotcopy: ["x"] }]))).toBe(false);
    expect(parses(REFERENCE_BATCH_DOCUMENT, batch([{ ...item, allowLocal: true }]))).toBe(false);
    expect(parses(REFERENCE_BATCH_DOCUMENT, { ...batch([]), extra: 1 })).toBe(false);
    expect(parses(REFERENCE_BATCH_DOCUMENT, batch(Array.from({ length: 201 }, () => item)))).toBe(
      false,
    );
  });

  // Covers: R18
  test("keeps the append-only registries unique and well-formed", () => {
    expect(new Set(CLI_COMMANDS).size).toBe(CLI_COMMANDS.length);
    expect(new Set(FINDING_CODES).size).toBe(FINDING_CODES.length);
    expect(FINDING_CODES.every((code) => FINDING_CODE_PATTERN.test(code))).toBe(true);
    expect(new Set(DOCTOR_CHECK_IDS).size).toBe(DOCTOR_CHECK_IDS.length);
    // Every command has its CommandSpec (the group is the first word of "references add").
    const registered = new Set<string>(COMMANDS.map((spec) => spec.name));
    for (const command of CLI_COMMANDS) expect(registered.has(command.split(" ")[0]!)).toBe(true);
  });

  test("grows the envelope with the research commands and data", () => {
    expect(CLI_COMMANDS).toContain("references add");
    expect(CLI_COMMANDS).toContain("research render");
    const counts = { active: 1, removed: 0, withProvenance: 1, minimum: 5, brandInputs: 0 };
    const add = {
      references: [sampleReference()],
      phase: { from: "initialized", to: "researching" },
      stateRevision: 2,
      counts,
      written: ["research/references.json"],
    };
    const list = {
      references: [
        {
          id: "REF-1",
          source: "manual",
          origin: "o",
          capturedAt: "2026-09-30T12:00:00.000Z",
          mode: "full",
          removed: false,
          crops: 0,
          securityFindings: 0,
        },
      ],
      counts,
      includeRemoved: false,
    };
    const payloads: [string, unknown][] = [
      ["references add", add],
      ["references import", { ...add, batch: { file: "b.json", items: 1 } }],
      ["references list", list],
      ["references show", { reference: sampleReference(), counts }],
      [
        "references compare",
        { references: [sampleReference()], shared: { studies: [], doNotCopy: [], influences: [] } },
      ],
      ["references remove", { removed: sampleReference(), stateRevision: 3, counts, written: [] }],
      [
        "brand add",
        {
          input: {
            id: "BRAND-1",
            kind: "font",
            origin: "inferred",
            value: "Inter",
            note: null,
            derivedFrom: null,
            image: null,
            file: null,
            capturedAt: "2026-09-30T12:00:00.000Z",
            mode: "full",
          },
          stateRevision: 3,
          written: ["brand/brand.json"],
        },
      ],
      [
        "research render",
        {
          mode: "full",
          locale: "es",
          outputs: [{ path: "research/REFERENCES.md", sha256: HASH, written: true }],
          counts,
          stateRevision: 4,
        },
      ],
    ];
    for (const [command, data] of payloads) {
      expect(CLI_ENVELOPE_DOCUMENT.schema.safeParse(researchEnvelope(command, data)).success).toBe(
        true,
      );
    }
    expect(
      CLI_ENVELOPE_DOCUMENT.schema.safeParse(researchEnvelope("references add", { nope: 1 }))
        .success,
    ).toBe(false);
  });
});
