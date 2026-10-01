// Covers: R11, R15
import { describe, expect, test } from "bun:test";
import {
  CLI_ENVELOPE_DOCUMENT,
  CONTRACT_DOCUMENTS,
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

  test("validates every registered document kind and its schema file name", () => {
    expect(CONTRACT_DOCUMENTS.map((d) => d.schemaFile)).toEqual([
      "heron-project.v1.schema.json",
      "heron-state.v1.schema.json",
      "mode-decision.v1.schema.json",
      "cli-envelope.v1.schema.json",
    ]);
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
