// Covers: R6, R7, R8, R14, R15
import { describe, expect, test } from "bun:test";
import { GATE_BINDINGS } from "../../../src/core/state/gates.ts";
import { matchesGlob, PHASE_ARTIFACTS } from "../../../src/core/state/stale.ts";
import type {
  BrandInput,
  BrandInputDraft,
  ReferenceInput,
} from "../../../src/core/contracts/index.ts";
import { nextBrandInputId, validateBrandInput } from "../../../src/research/brand.ts";
import { sharedValues } from "../../../src/research/compare.ts";
import {
  missingProvenance,
  nextReferenceId,
  PROVENANCE_FIELDS,
  researchMode,
  validateCrops,
  validateReferenceInput,
} from "../../../src/research/provenance.ts";
import { RESEARCH_FILES } from "../../../src/research/layout.ts";
import { sampleReference } from "../../helpers/research.ts";

const input = (overrides: Partial<ReferenceInput> = {}): ReferenceInput => ({
  source: "manual",
  origin: "Linear pricing",
  reason: "Calm table",
  studies: ["density"],
  doNotCopy: ["brand"],
  influences: ["layout"],
  file: null,
  url: null,
  screenshot: false,
  allowLocal: false,
  crops: [],
  ...overrides,
});

function problem(result: ReturnType<typeof validateReferenceInput>) {
  if (result.ok) throw new Error("expected a rejection");
  return result;
}

const message = (overrides: Partial<ReferenceInput>) =>
  problem(validateReferenceInput(input(overrides), "")).message;

const ok = (overrides: Partial<ReferenceInput>) => {
  const result = validateReferenceInput(input(overrides), "");
  if (!result.ok) throw new Error(result.message);
  return result.value;
};

const draft = (overrides: Partial<BrandInputDraft> = {}): BrandInputDraft => ({
  kind: "brand-color",
  origin: "provided",
  value: " #0A84FF ",
  file: null,
  reference: null,
  note: null,
  ...overrides,
});

const at = (id: string) => ({ id }) as BrandInput;

describe("validateReferenceInput", () => {
  test("names every missing provenance field in contract order", () => {
    const empty = problem(
      validateReferenceInput(
        input({
          source: null,
          origin: null,
          reason: null,
          studies: [],
          doNotCopy: [],
          influences: [],
        }),
        "",
      ),
    );
    expect(empty.code).toBe("PROVENANCE_INCOMPLETE");
    expect(empty.message).toBe(
      "Reference is missing required field(s): source (--source), origin (--origin), reason (--reason), studies (--study), doNotCopy (--do-not-copy), influences (--influence). Nothing was written.",
    );
    expect(empty.issues.map((issue) => issue.pointer)).toEqual(
      PROVENANCE_FIELDS.map((field) => `/${field}`),
    );
    // each field alone, and blanks count as missing
    const flags = ["--source", "--origin", "--reason", "--study", "--do-not-copy", "--influence"];
    PROVENANCE_FIELDS.forEach((field, index) => {
      const blank: Partial<ReferenceInput> = {
        source: { source: " " },
        origin: { origin: "" },
        reason: { reason: "  " },
        studies: { studies: [" "] },
        doNotCopy: { doNotCopy: [] },
        influences: { influences: [""] },
      }[field];
      const result = problem(validateReferenceInput(input(blank), ""));
      expect(result.message).toBe(
        `Reference is missing required field(s): ${field} (${flags[index]}). Nothing was written.`,
      );
    });
    // batch item: pointer prefix and numbering
    const batch = problem(validateReferenceInput(input({ reason: null }), "/references/2"));
    expect(batch.message).toBe(
      "Batch item 3 is missing required field(s): reason (--reason). Nothing was written.",
    );
    expect(batch.issues).toEqual([{ pointer: "/references/2/reason", message: "is required" }]);
  });

  test("asks for the target each source needs", () => {
    expect(message({ source: "url", origin: null })).toContain("url (--url)");
    expect(message({ source: "image" })).toContain("file (--file)");
    expect(message({ source: "design-md" })).toContain("file (--file or --url)");
    expect(message({ source: "design-md", origin: null, url: null })).toContain(
      "origin (--origin), file (--file or --url)",
    );
  });

  test("builds a valid input per source and trims, dedupes and redacts", () => {
    expect(ok({ studies: [" density ", "Density", "x"] }).studies).toEqual(["density", "x"]);
    expect(ok({ origin: "https://user:pw@linear.app/p?token=abc&a=1" }).origin).toBe(
      "https://linear.app/p?token=REDACTED&a=1",
    );
    expect(ok({}).capture).toEqual({ kind: "manual" });
    expect(
      ok({ source: "url", origin: null, url: "https://a.test/", allowLocal: true }),
    ).toMatchObject({
      origin: null,
      capture: { kind: "url", url: "https://a.test/", allowLocal: true },
    });
    expect(
      ok({
        source: "image",
        file: "a.png",
        screenshot: true,
        crops: [{ x: 0, y: 1, width: 2, height: 3, note: " n " }],
      }),
    ).toMatchObject({
      capture: { kind: "image", file: "a.png", method: "screenshot" },
      crops: [{ x: 0, y: 1, width: 2, height: 3, note: "n" }],
    });
    expect(ok({ source: "image", file: "a.png" }).capture).toEqual({
      kind: "image",
      file: "a.png",
      method: "file",
    });
    expect(ok({ source: "design-md", file: "D.md" }).capture).toEqual({
      kind: "design-md",
      file: "D.md",
    });
    expect(ok({ source: "design-md", origin: null, url: "https://a.test/D.md" }).capture).toEqual({
      kind: "design-md",
      url: "https://a.test/D.md",
      allowLocal: false,
    });
    // kinds without an adapter yet are valid names: app answers ADAPTER_NOT_AVAILABLE
    expect(ok({ source: "penpot" }).capture).toEqual({ kind: "penpot" });
  });

  test("rejects contradictions and limits as REFERENCE_INPUT_INVALID", () => {
    const crop = { x: 0, y: 0, width: 1, height: 1, note: "n" };
    const cases: [Partial<ReferenceInput>, string][] = [
      [{ source: "wat" }, 'unknown source "wat"'],
      [{ file: "a.png" }, "takes no --file or --url"],
      [
        { source: "url", origin: null, url: "https://a.test/", file: "x" },
        "takes --url, not --file",
      ],
      [{ source: "image", file: "a.png", url: "https://a.test/" }, "takes --file, not --url"],
      [
        { source: "design-md", origin: null, file: "a.md", url: "https://a.test/" },
        "either --file or --url",
      ],
      [{ source: "url", url: "https://a.test/" }, "derived from --url"],
      [{ source: "design-md", url: "https://a.test/" }, "derived from it"],
      [{ screenshot: true }, "--screenshot only applies"],
      [{ allowLocal: true }, "--allow-local only applies"],
      [{ crops: [crop] }, "crops only apply"],
      [
        { source: "image", file: "a.png", crops: Array.from({ length: 21 }, () => crop) },
        "at most 20 crops",
      ],
      [{ source: "image", file: "a.png", crops: [{ ...crop, width: 0 }] }, "crop 1 needs integer"],
      [{ source: "image", file: "a.png", crops: [{ ...crop, x: 0.5 }] }, "crop 1 needs integer"],
      [{ source: "image", file: "a.png", crops: [{ ...crop, note: " " }] }, "needs a note"],
      [{ origin: "x".repeat(2049) }, "origin exceeds 2048"],
      [{ reason: "x".repeat(2001) }, "reason exceeds 2000"],
      [
        { studies: Array.from({ length: 21 }, (_, i) => `s${i}`) },
        "studies has more than 20 items",
      ],
      [{ influences: ["x".repeat(501)] }, "a influences item exceeds 500"],
    ];
    for (const [overrides, detail] of cases) {
      const result = problem(validateReferenceInput(input(overrides), "/references/0"));
      expect(result.code).toBe("REFERENCE_INPUT_INVALID");
      expect(result.message).toContain(detail);
      expect(result.message.startsWith("Invalid reference input: ")).toBe(true);
      expect(result.message.endsWith(". Nothing was written.")).toBe(true);
    }
  });
});

describe("reference helpers", () => {
  test("detects missing provenance on stored references", () => {
    expect(missingProvenance(sampleReference())).toEqual([]);
    expect(
      missingProvenance(sampleReference({ origin: " ", studies: [" "], influences: [] })),
    ).toEqual(["origin", "studies", "influences"]);
    expect(
      missingProvenance(sampleReference({ reason: "", doNotCopy: [], source: "" as "manual" })),
    ).toEqual(["source", "reason", "doNotCopy"]);
  });

  test("validates crops, numbers ids and derives the research mode", () => {
    const crops = [
      { x: 0, y: 0, width: 10, height: 10, note: "a" },
      { x: 95, y: 0, width: 10, height: 10, note: "b" },
    ];
    expect(validateCrops(crops.slice(0, 1), 100, 100)).toEqual({ ok: true });
    expect(validateCrops(crops, 100, 100)).toEqual({
      ok: false,
      message: "Crop 2 (95,0 10x10) falls outside the 100x100 image.",
      issues: [{ pointer: "/crops/1", message: "falls outside the image" }],
    });
    expect(nextReferenceId([])).toBe("REF-1");
    const removed = { at: "2026-09-30T12:00:00.000Z", reason: null };
    expect(
      nextReferenceId([
        sampleReference({ id: "REF-2" }),
        sampleReference({ id: "REF-9", removed }),
        sampleReference({ id: "REF-10" }),
      ]),
    ).toBe("REF-11");
    expect(researchMode([], "full")).toBe("full");
    expect(researchMode([], "reference-only")).toBe("reference-only");
    expect(researchMode([sampleReference({ mode: "full" })], "reference-only")).toBe("full");
    expect(
      researchMode([sampleReference({ mode: "full" }), sampleReference({ id: "REF-2" })], "full"),
    ).toBe("reference-only");
    // a removed reference-only capture no longer pins the mode
    expect(
      researchMode(
        [sampleReference({ removed }), sampleReference({ id: "REF-2", mode: "full" })],
        "reference-only",
      ),
    ).toBe("full");
  });

  test("shares values present in every list", () => {
    expect(sharedValues([])).toEqual([]);
    expect(sharedValues([["a", "B", "b"]])).toEqual(["a", "B"]);
    expect(sharedValues([[" Table ", "x"], ["table", "y"], ["TABLE "]])).toEqual([" Table "]);
    expect(sharedValues([["x"], ["y"]])).toEqual([]);
  });
});

describe("validateBrandInput", () => {
  test("requires kind, origin and value and names the flags", () => {
    const empty = validateBrandInput(draft({ kind: null, origin: " ", value: "" }));
    expect(empty).toMatchObject({
      ok: false,
      message:
        "Brand input is missing required field(s): kind (--kind), origin (--origin provided, derived, inferred or reference-derived), value (--value). Nothing was written.",
    });
    expect(validateBrandInput(draft({ origin: null }))).toMatchObject({
      ok: false,
      issues: [{ pointer: "/origin", message: "is required" }],
    });
  });

  test("accepts the 4 origins and the 11 kinds and rejects contradictions", () => {
    const bad = (overrides: Partial<BrandInputDraft>) => {
      const result = validateBrandInput(draft(overrides));
      if (result.ok) throw new Error("expected a rejection");
      return result.message;
    };
    expect(validateBrandInput(draft({ note: " n ", file: " logo.png " }))).toEqual({
      ok: true,
      value: {
        kind: "brand-color",
        origin: "provided",
        value: "#0A84FF",
        note: "n",
        derivedFrom: null,
        file: "logo.png",
      },
    });
    expect(
      validateBrandInput(draft({ origin: "reference-derived", reference: "REF-3" })),
    ).toMatchObject({
      ok: true,
      value: { derivedFrom: "REF-3" },
    });
    for (const origin of ["provided", "derived", "inferred"]) {
      expect(validateBrandInput(draft({ origin })).ok).toBe(true);
    }
    for (const kind of [
      "logo",
      "brand-color",
      "secondary-color",
      "font",
      "brand-guidelines",
      "screenshot",
      "url",
      "existing-product",
      "competitor",
      "liked-reference",
      "disliked-reference",
    ]) {
      expect(validateBrandInput(draft({ kind })).ok).toBe(true);
    }
    expect(bad({ kind: "wat" })).toContain('unknown kind "wat"');
    expect(bad({ origin: "wat" })).toContain('unknown origin "wat"');
    expect(bad({ origin: "reference-derived" })).toBe(
      "Invalid brand input: origin reference-derived needs --reference. Nothing was written.",
    );
    expect(bad({ reference: "REF-1" })).toContain("--reference only applies");
    expect(bad({ origin: "reference-derived", reference: "ref-x" })).toContain(
      "is not a reference id",
    );
    expect(bad({ value: "x".repeat(2001) })).toContain("limited to 2000");
  });

  test("numbers brand inputs after the highest id", () => {
    expect(nextBrandInputId([])).toBe("BRAND-1");
    expect(nextBrandInputId([at("BRAND-2"), at("BRAND-10")])).toBe("BRAND-11");
  });
});

describe("RESEARCH_FILES", () => {
  test("stays aligned with the research gate bindings and the researching artifacts", () => {
    expect(GATE_BINDINGS.research).toEqual([RESEARCH_FILES.references, RESEARCH_FILES.provenance]);
    for (const path of [
      RESEARCH_FILES.references,
      RESEARCH_FILES.provenance,
      RESEARCH_FILES.markdown,
      RESEARCH_FILES.moodboard,
      `${RESEARCH_FILES.assets}/${"a".repeat(64)}.webp`,
      `${RESEARCH_FILES.sources}/${"a".repeat(64)}.md`,
      RESEARCH_FILES.brand,
      `${RESEARCH_FILES.brandAssets}/${"a".repeat(64)}.webp`,
    ]) {
      expect(PHASE_ARTIFACTS.researching.some((pattern) => matchesGlob(path, pattern))).toBe(true);
    }
  });
});
