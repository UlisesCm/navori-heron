// Covers: R11, R15
import { describe, expect, test } from "bun:test";
import { makeFinding } from "../../src/app/result.ts";
import { COMMANDS } from "../../src/cli/commands/index.ts";
import {
  type PenpotSyncState,
  PENPOT_SYNC_STATE_DOCUMENT,
  PENPOT_SYNC_SCOPES,
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
  INTAKE_CONFLICTS_DOCUMENT,
  MANUAL_CONTEXT_DOCUMENT,
  PRODUCT_CONTEXT_DOCUMENT,
  PRODUCT_CONTEXT_SECTIONS,
  canonicalJson,
  formatUnsupportedVersionMessage,
  parseVersionedDocument,
  toJsonPointer,
  type HeronProject,
  type DocumentSpec,
  type HeronState,
  AGENT_RUN_DOCUMENT,
  AgentSettingsInputSchema,
  DirectionProposalOutputSchema,
  ProbeOutputSchema,
  RESEARCH_ANALYSIS_DOCUMENT,
  RESEARCH_BRIEF_DOCUMENT,
  ResearchAnalysisOutputSchema,
  ResearchBriefOutputSchema,
  VISUAL_DIRECTIONS_DOCUMENT,
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
  // Covers: R10
  test("keeps __proto__ keys and sorts keys at every depth", () => {
    const parsed: unknown = JSON.parse('{"b":1,"__proto__":{"z":1,"a":2},"a":[{"y":1,"x":2}]}');
    expect(canonicalJson(parsed)).toBe(
      '{\n  "__proto__": {\n    "a": 2,\n    "z": 1\n  },\n  "a": [\n    {\n      "x": 2,\n      "y": 1\n    }\n  ],\n  "b": 1\n}\n',
    );
    expect(Object.keys(JSON.parse(canonicalJson(parsed)) as object)).toContain("__proto__");
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
    // TODO(P3 CLI task): drop "direction" once `direction` registers its CommandSpec (envelope data lands in T4).
    // TODO(P12 T19): drop "penpot" once the `penpot` group registers its CommandSpec.
    const PENDING_SPECS = new Set(["direction", "penpot"]);
    for (const command of CLI_COMMANDS) {
      const group = command.split(" ")[0]!;
      if (!PENDING_SPECS.has(group)) expect(registered.has(group)).toBe(true);
    }
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

describe("intake documents", () => {
  const ref = { source: "MASTER.md", path: "MASTER.md", locator: "§Actors" };
  const sourced = { sourceRef: ref, alsoIn: [], conflicts: [] };
  const context = {
    kind: "ProductContext",
    schemaVersion: 1,
    metadata: {
      adapter: "navori-master",
      mode: "full",
      stage: { dir: "01-mvp", selection: "active" },
      uxReader: "provisional-1",
      sources: [{ source: "MASTER.md", path: "MASTER.md", status: "used" }],
      uxExtensions: [{ key: "__proto__", value: { a: 1 } }],
      findings: [
        {
          code: "SOURCE_NO_ELEMENTS",
          severity: "info",
          message: "m",
          paths: [],
          issues: [],
        },
      ],
    },
    ...Object.fromEntries(PRODUCT_CONTEXT_SECTIONS.map((section) => [section, []])),
    product: [{ ...sourced, key: "name", value: "Membership" }],
  };
  const conflict = {
    id: "CONFLICT-001",
    kind: "permission-contradiction",
    subject: "ACT-PARTNER · see member data",
    status: "open",
    files: ["MASTER.md", "ux.json"],
    values: [
      { sourceRef: ref, value: "cannot: See member data" },
      {
        sourceRef: {
          ...ref,
          source: "ux.json",
          path: "ux.json",
          locator: "/actors/1",
        },
        value: "See member data",
      },
    ],
    impact: ["actors/ACT-PARTNER"],
    winner: null,
    fingerprint: HASH,
    ack: null,
  };
  const conflicts = {
    kind: "IntakeConflicts",
    schemaVersion: 1,
    conflicts: [conflict],
  };
  const manual = {
    kind: "ManualContext",
    schemaVersion: 1,
    product: { name: "Membership" },
    businessRules: [{ id: "RN-1", text: "t" }],
  };

  // Covers: R1, R5, R9, R10
  test("round-trips the intake documents and rejects a newer schemaVersion naming the supported one", () => {
    const cases: [DocumentSpec<unknown>, Record<string, unknown>][] = [
      [PRODUCT_CONTEXT_DOCUMENT, context],
      [INTAKE_CONFLICTS_DOCUMENT, conflicts],
      [MANUAL_CONTEXT_DOCUMENT, manual],
    ];
    for (const [spec, doc] of cases) {
      const parsed: unknown = parseVersionedDocument(doc, spec, "f.json");
      expect(JSON.parse(canonicalJson(parsed))).toEqual(JSON.parse(canonicalJson(doc)));
      let caught: unknown;
      try {
        parseVersionedDocument({ ...doc, schemaVersion: 2 }, spec, "f.json");
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(UnsupportedSchemaVersionError);
      expect((caught as Error).message).toContain("this Heron supports schemaVersion 1");
    }
    expect(parses(PRODUCT_CONTEXT_DOCUMENT, { ...context, unknownKey: 1 })).toBe(true);
    // persisted kind is text (DR26); ids, pair size and note length are enforced
    expect(
      parses(INTAKE_CONFLICTS_DOCUMENT, {
        ...conflicts,
        conflicts: [{ ...conflict, kind: "future-kind" }],
      }),
    ).toBe(true);
    expect(
      parses(INTAKE_CONFLICTS_DOCUMENT, {
        ...conflicts,
        conflicts: [{ ...conflict, kind: "Bad Kind" }],
      }),
    ).toBe(false);
    expect(
      parses(INTAKE_CONFLICTS_DOCUMENT, {
        ...conflicts,
        conflicts: [{ ...conflict, id: "C-1" }],
      }),
    ).toBe(false);
    expect(
      parses(INTAKE_CONFLICTS_DOCUMENT, {
        ...conflicts,
        conflicts: [{ ...conflict, values: [] }],
      }),
    ).toBe(false);
    const ack = {
      by: "ulises",
      at: "2026-10-01T12:00:00.000Z",
      note: "n",
      runId: "run-20260930T120000Z-3f9a1c2b",
    };
    expect(
      parses(INTAKE_CONFLICTS_DOCUMENT, {
        ...conflicts,
        conflicts: [{ ...conflict, ack }],
      }),
    ).toBe(true);
    expect(
      parses(INTAKE_CONFLICTS_DOCUMENT, {
        ...conflicts,
        conflicts: [{ ...conflict, ack: { ...ack, note: "" } }],
      }),
    ).toBe(false);
    // ManualContext is an input: strict, with id patterns and no UX sections
    expect(parses(MANUAL_CONTEXT_DOCUMENT, { ...manual, extra: 1 })).toBe(false);
    expect(parses(MANUAL_CONTEXT_DOCUMENT, { ...manual, screens: [] })).toBe(false);
    expect(
      parses(MANUAL_CONTEXT_DOCUMENT, {
        ...manual,
        businessRules: [{ id: "RF-1", text: "t" }],
      }),
    ).toBe(false);
    expect(
      parses(MANUAL_CONTEXT_DOCUMENT, {
        ...manual,
        brand: [{ kind: "mascot", value: "v" }],
      }),
    ).toBe(false);
    // source.inputs is optional (no bump): P1/P2 projects keep validating
    const withInputs = {
      ...project,
      source: { ...project.source, adapter: "markdown", inputs: ["a.md"] },
    };
    expect(parses(HERON_PROJECT_DOCUMENT, withInputs)).toBe(true);
    expect(parses(HERON_PROJECT_DOCUMENT, project)).toBe(true);
    expect(
      parses(HERON_PROJECT_DOCUMENT, {
        ...withInputs,
        source: { ...withInputs.source, inputs: ["../x"] },
      }),
    ).toBe(false);
  });

  // Covers: R5, R6, R8
  test("grows the envelope with the intake commands and finding codes", () => {
    const counts = Object.fromEntries(PRODUCT_CONTEXT_SECTIONS.map((section) => [section, 0]));
    const stage = {
      number: 1,
      slug: "mvp",
      dir: "01-mvp",
      state: "active",
      selection: "active",
    };
    const payloads: [string, unknown][] = [
      [
        "intake",
        {
          mode: "full",
          adapter: "navori-master",
          stage,
          dryRun: false,
          written: true,
          stateRevision: 2,
          counts,
          conflicts: [
            {
              id: "CONFLICT-001",
              kind: "value-mismatch",
              subject: "s",
              acknowledged: false,
            },
          ],
        },
      ],
      ["conflicts list", { tracked: true, conflicts: [conflict] }],
      ["conflicts ack", { conflict, stateRevision: 3, unacknowledged: 0 }],
    ];
    for (const [command, data] of payloads) {
      expect(CLI_COMMANDS).toContain(command as never);
      expect(CLI_ENVELOPE_DOCUMENT.schema.safeParse(researchEnvelope(command, data)).success).toBe(
        true,
      );
    }
    const p4 = FINDING_CODES.indexOf("PRODUCT_CONTEXT_STALE");
    expect(FINDING_CODES.slice(p4, p4 + 13).at(-1)).toBe("LOWER_TIER_ITEMS_SKIPPED");
  });
});

const texts = (n: number) => Array.from({ length: n }, (_, i) => `item ${i}`);

describe("agent documents", () => {
  const sha = "a".repeat(64);
  const template = { id: "design-director/direction-propose", version: 1, sha256: sha };
  const runRef = {
    runId: "run-20260930T120000Z-3f9a1c2b",
    path: "runs/run-20260930T120000Z-3f9a1c2b.json",
    provider: "fake",
    template,
    cacheKey: sha,
  };
  const usage = {
    inputTokens: 10,
    outputTokens: 5,
    cachedInputTokens: null,
    costUsd: null,
    costIsEstimate: false,
  };
  const agentRun = {
    kind: "AgentRun",
    schemaVersion: 1,
    runId: runRef.runId,
    task: "direction-propose",
    command: "direction propose",
    role: "creator",
    provider: "fake",
    cacheKey: sha,
    startedAt: "2026-09-30T12:00:00.000Z",
    heronVersion: "0.0.0",
    mode: "reference-only",
    outputSchema: { task: "direction-propose", dialect: "claude", sha256: sha },
    pack: {
      sha256: sha,
      chars: 100,
      budget: 120000,
      items: [{ kind: "reference", id: "REF-1", trust: "untrusted", sha256: sha, chars: 100 }],
      trimmed: [],
    },
    inputs: [{ path: "research/references.json", sha256: sha }],
    references: ["REF-1"],
    schemas: [{ kind: "ResearchReferences", schemaVersion: 1 }],
    outputs: [],
    status: "succeeded",
    invocations: [
      {
        attempt: 1,
        kind: "initial",
        provider: "fake",
        cliVersion: null,
        model: { requested: null, reported: [] },
        template,
        input: { sha256: sha, chars: 100 },
        output: { sha256: sha, bytes: 10 },
        status: "succeeded",
        exitCode: 0,
        signal: null,
        durationMs: 5,
        usage,
        issues: 0,
      },
    ],
  };
  const brief = {
    kind: "ResearchBrief",
    schemaVersion: 1,
    mode: "reference-only",
    briefedAt: "2026-09-30T12:00:00.000Z",
    run: runRef,
    queries: [
      {
        id: "Q-0123abcd",
        facet: "screen-type",
        job: "show a card",
        query: "membership card",
        question: null,
        rationale: null,
        origin: "provided",
      },
    ],
  };
  const analysis = {
    kind: "ResearchAnalysis",
    schemaVersion: 1,
    mode: "reference-only",
    analyses: [
      {
        reference: "REF-1",
        observations: [{ aspect: "density", note: "airy" }],
        facets: ["density"],
        suggestedDoNotCopy: [],
        answersQueries: ["Q-0123abcd"],
        referenceSha256: sha,
        inputKey: sha,
        analyzedAt: "2026-09-30T12:00:00.000Z",
        run: runRef,
        origin: "inferred",
      },
    ],
  };
  const attrs = {
    personality: "p",
    density: "d",
    surfaceTreatment: "s",
    typographyStrategy: "t",
    colorStrategy: "c",
    imageryStrategy: "i",
    navigationCharacter: "n",
    componentWeight: "w",
    motionCharacter: "m",
    references: [1, 2].map((n) => ({
      reference: `REF-${n}`,
      takes: texts(1),
      doNotCopy: texts(1),
    })),
    risks: texts(1),
    whenItFits: texts(1),
    whenItDoesnt: texts(1),
  };
  const colors = ["background", "text", "primary", "on-primary"].map((role, i) => ({
    id: `c${i + 1}`,
    name: role,
    hex: "#0a0a0a",
    role,
  }));
  const proposalOut = {
    palette: {
      colors,
      pairs: [
        { foreground: "c2", background: "c1", usage: "body-text" },
        { foreground: "c4", background: "c3", usage: "ui-component" },
      ],
    },
    typeScale: {
      families: [{ role: "text", family: "Inter", fallback: ["sans-serif"] }],
      steps: [1, 2, 3, 4].map((n) => ({
        id: `t${n}`,
        name: `step ${n}`,
        sizePx: 12 + n,
        lineHeight: 1.4,
        weight: 400,
        usage: "u",
      })),
    },
    componentSheet: Array.from({ length: 4 }, () => ({
      kind: "button",
      variant: "primary",
      fill: "c3",
      text: "c4",
      typeStep: "t1",
      radiusPx: 8,
      notes: "",
    })),
    composition: {
      title: "Home",
      description: "d",
      nodes: [
        {
          id: "n1",
          parent: null,
          type: "frame",
          direction: "column",
          columns: null,
          fill: "c1",
          typeStep: null,
          component: null,
          text: null,
          imageHint: null,
        },
      ],
    },
  };
  const directionOut = (id: string) => ({
    id,
    name: id,
    summary: "s",
    attributes: attrs,
    proposal: proposalOut,
  });
  const directionsOutput = { directions: ["DIR-A", "DIR-B", "DIR-C"].map(directionOut) };
  const persistedDirection = (id: string) => ({
    ...directionOut(id),
    origin: "inferred",
    proposal: {
      ...proposalOut,
      marking: "SYNTHETIC",
      palette: {
        ...proposalOut.palette,
        pairs: proposalOut.palette.pairs.map((p) => ({
          ...p,
          contrast: { ratio: 18.1, threshold: 4.5, passes: true },
        })),
      },
    },
  });
  const directions = {
    kind: "VisualDirections",
    schemaVersion: 1,
    mode: "reference-only",
    proposedAt: "2026-09-30T12:00:00.000Z",
    run: runRef,
    basis: { references: ["REF-1"], brief: sha, analysis: null },
    directions: ["DIR-A", "DIR-B", "DIR-C"].map(persistedDirection),
    selection: null,
  };

  // Covers: R6, R9, R10, R11, R19
  test("round-trips the agent documents and rejects an unknown schemaVersion", () => {
    const docs: [DocumentSpec<unknown>, object][] = [
      [AGENT_RUN_DOCUMENT, agentRun],
      [RESEARCH_BRIEF_DOCUMENT, brief],
      [RESEARCH_ANALYSIS_DOCUMENT, analysis],
      [VISUAL_DIRECTIONS_DOCUMENT, directions],
    ];
    for (const [spec, doc] of docs) {
      const parsed = parseVersionedDocument(doc, spec, "f.json");
      expect(JSON.parse(canonicalJson(parsed))).toEqual(JSON.parse(canonicalJson(doc)));
      expect(() => parseVersionedDocument({ ...doc, schemaVersion: 2 }, spec, "f.json")).toThrow(
        UnsupportedSchemaVersionError,
      );
    }
    expect(AGENT_RUN_DOCUMENT.schema.safeParse({ ...agentRun, cacheKey: "x" }).success).toBe(false);
    expect(AGENT_RUN_DOCUMENT.schema.safeParse({ ...agentRun, invocations: [] }).success).toBe(
      false,
    );
    expect(
      VISUAL_DIRECTIONS_DOCUMENT.schema.safeParse({
        ...directions,
        directions: directions.directions.slice(0, 2),
      }).success,
    ).toBe(false);
  });

  // Covers: R9, R10, R12
  test("accepts strict agent outputs and rejects unknown keys or out-of-range sizes", () => {
    const briefOut = {
      queries: Array.from({ length: 3 }, (_, i) => ({
        facet: "flow",
        job: `job ${i}`,
        query: "q",
        question: "?",
        rationale: "r",
      })),
    };
    expect(ResearchBriefOutputSchema.safeParse(briefOut).success).toBe(true);
    expect(
      ResearchBriefOutputSchema.safeParse({ queries: briefOut.queries.slice(0, 2) }).success,
    ).toBe(false);
    expect(ResearchBriefOutputSchema.safeParse({ ...briefOut, extra: 1 }).success).toBe(false);
    const analysisOut = {
      analyses: [
        {
          reference: "REF-1",
          observations: [{ aspect: "a", note: "n" }],
          facets: ["flow", "flow"],
          suggestedDoNotCopy: [],
          answersQueries: [],
        },
      ],
    };
    expect(ResearchAnalysisOutputSchema.safeParse(analysisOut).success).toBe(false);
    analysisOut.analyses[0]!.facets = ["flow"];
    expect(ResearchAnalysisOutputSchema.safeParse(analysisOut).success).toBe(true);
    expect(DirectionProposalOutputSchema.safeParse(directionsOutput).success).toBe(true);
    expect(
      DirectionProposalOutputSchema.safeParse({ directions: directionsOutput.directions.slice(1) })
        .success,
    ).toBe(false);
    expect(ProbeOutputSchema.safeParse({ status: "ok", facets: ["flow"] }).success).toBe(true);
  });

  // Covers: R7, R21
  test("validates lazy agent settings and keeps older projects valid", () => {
    expect(AgentSettingsInputSchema.safeParse({}).success).toBe(true);
    expect(
      AgentSettingsInputSchema.safeParse({
        roles: { creator: "claude-code" },
        models: { "codex-cli": "gpt-5.2" },
        timeoutMs: 5000,
        warnTokensPerDay: 2000,
      }).success,
    ).toBe(true);
    for (const invalid of [
      { models: { fake: "--evil" } },
      { timeoutMs: 10 },
      { contextBudgetChars: 5 },
      { warnTokensPerDay: 10 },
      { roles: { creator: "gemini" } },
    ]) {
      expect(AgentSettingsInputSchema.safeParse(invalid).success).toBe(false);
    }
    // an invalid "agents" block never fails the project itself (DR21)
    expect(parses(HERON_PROJECT_DOCUMENT, project)).toBe(true);
    expect(parses(HERON_PROJECT_DOCUMENT, { ...project, agents: { timeoutMs: "x" } })).toBe(true);
  });

  // Covers: R13, R14, R19
  test("grows the envelope with the agent commands, checks and finding codes", () => {
    const run = {
      runId: runRef.runId,
      task: "research-brief",
      provider: "fake",
      role: "creator",
      attempts: 0,
      durationMs: 0,
      model: null,
      path: runRef.path,
      reused: true,
      usage,
    };
    const payloads: [string, unknown][] = [
      [
        "direction propose",
        {
          directions,
          run,
          phase: { from: "research-ready", to: "directions-ready" },
          written: [],
          stateRevision: 3,
        },
      ],
      ["research brief", { brief, run, written: [], stateRevision: 3 }],
      [
        "research analyze",
        {
          analyzed: [],
          fresh: ["REF-1"],
          pending: [],
          analysis: null,
          run: null,
          written: [],
          stateRevision: 3,
        },
      ],
    ];
    for (const [command, data] of payloads) {
      expect(CLI_COMMANDS).toContain(command as never);
      const result = CLI_ENVELOPE_DOCUMENT.schema.safeParse(researchEnvelope(command, data));
      expect(result.success ? [] : result.error.issues.slice(0, 3)).toEqual([]);
    }
    expect(CLI_COMMANDS).toContain("direction select");
    expect(DOCTOR_CHECK_IDS).toContain("probe.codex-cli");
    expect(FINDING_CODES.indexOf("SECRET_REDACTED")).toBeLessThan(
      FINDING_CODES.indexOf("PENPOT_NOT_CONFIGURED"),
    );
    expect(FINDING_CODES.indexOf("AGENT_UNAVAILABLE")).toBe(
      FINDING_CODES.indexOf("LOWER_TIER_ITEMS_SKIPPED") + 1,
    );
  });
});

describe("penpot documents", () => {
  const sha = "a".repeat(64);
  const syncState: PenpotSyncState = {
    kind: "PenpotSyncState",
    schemaVersion: 1,
    scope: "review",
    file: { id: "file-1", name: "Heron review" },
    penpotVersion: "2.17.2",
    entries: [
      {
        heronId: "heron:proposal:DIR-A",
        kind: "proposal-page",
        pageId: "page-1",
        pageName: "Heron · DIR-A",
        template: { id: "review-page", version: 1, sha256: sha },
        sourceSha256: sha,
        contentSha256: sha,
        mode: "reference-only",
      },
    ],
  };

  // Covers: R15
  test("round-trips the Penpot sync syncState and rejects an unknown schemaVersion", () => {
    const parsed = parseVersionedDocument(
      syncState,
      PENPOT_SYNC_STATE_DOCUMENT,
      "review-sync.json",
    );
    expect(parsed).toEqual(syncState);
    expect(PENPOT_SYNC_SCOPES).toEqual(["review", "system"]);
    expect(() =>
      parseVersionedDocument(
        { ...syncState, schemaVersion: 2 },
        PENPOT_SYNC_STATE_DOCUMENT,
        "review-sync.json",
      ),
    ).toThrow(UnsupportedSchemaVersionError);
    expect(
      PENPOT_SYNC_STATE_DOCUMENT.schema.safeParse({
        ...syncState,
        entries: [{ ...syncState.entries[0], heronId: "proposal" }],
      }).success,
    ).toBe(false);
  });

  // Covers: R4, R5, R8
  test("registers the penpot commands, checks and 22 finding codes", () => {
    for (const c of ["link", "doctor", "inspect", "sync"]) {
      expect(CLI_COMMANDS).toContain(`penpot ${c}` as never);
    }
    expect(DOCTOR_CHECK_IDS.filter((id) => id.startsWith("penpot."))).toHaveLength(7);
    const added = FINDING_CODES.slice(FINDING_CODES.indexOf("SECRET_REDACTED") + 1);
    expect(added).toHaveLength(22);
    expect(added.every((c) => c.startsWith("PENPOT_"))).toBe(true);
    const data = {
      file: { id: "f", name: "n" },
      penpotVersion: "2.17.2",
      previousFileId: null,
      written: [".heron/project.json"],
      stateRevision: 2,
    };
    const result = CLI_ENVELOPE_DOCUMENT.schema.safeParse({
      kind: "CliEnvelope",
      schemaVersion: 1,
      command: "penpot link",
      ok: true,
      code: 0,
      data,
      findings: [],
      runId: "run-20261001T120000Z-3f9a1c2b",
      durationMs: 1,
      next: [],
    });
    expect(result.success).toBe(true);
  });
});
