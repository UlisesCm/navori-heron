import { describe, expect, test } from "bun:test";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  PRODUCT_CONTEXT_SECTIONS,
  ProductContextSchema,
  type ProductContext,
} from "../../src/core/contracts/index.ts";
import { nodeFs } from "../../src/core/store/fs-port.ts";
import { navoriMasterAdapter } from "../../src/intake/adapters/navori-master/index.ts";
import { DEFAULT_INPUT_LIMITS } from "../../src/intake/ports.ts";
import { parseMarkdown, sectionAnchor, sectionBody } from "../../src/intake/markdown.ts";
import {
  buildProductContext,
  countSections,
  elementKey,
} from "../../src/intake/product-context.ts";
import { normalizeText } from "../../src/intake/text.ts";
import { copyFixture } from "../helpers/fixtures.ts";
import { loadMasterDraft } from "../helpers/intake.ts";

const META = { adapter: "navori-master", mode: "full", stage: null } as const;
const STAGE = "specs/_master/01-mvp";

const language = (context: ProductContext) =>
  context.product.find((fact) => fact.key === "language")?.value ?? null;

const build = (root: string) => buildProductContext(loadMasterDraft(root), META);

/** Resolves an RFC 6901 pointer into parsed JSON. */
function resolvePointer(value: unknown, pointer: string): unknown {
  return pointer
    .split("/")
    .slice(1)
    .reduce<unknown>(
      (node, token) =>
        (node as Record<string, unknown> | undefined)?.[
          token.replaceAll("~1", "/").replaceAll("~0", "~")
        ],
      value,
    );
}

/** What an element must show in its source: its id, else its text or value, else its name. */
function witnesses(element: Record<string, unknown>): string[] {
  const fields = ["id", "requirement", "text", "value", "name"];
  return fields.flatMap((field) => {
    const value = element[field];
    return typeof value === "string" && value !== "" ? [value] : [];
  });
}

describe("ProductContext from navori-master", () => {
  // Covers: R1, R2, R13
  test("maps membership-product into ProductContext v1 with its nineteen sections", () => {
    const { context } = build(copyFixture("membership-product"));
    expect(ProductContextSchema.safeParse(context).success).toBe(true);
    expect(PRODUCT_CONTEXT_SECTIONS).toHaveLength(19);
    const counts = countSections(context);
    for (const section of PRODUCT_CONTEXT_SECTIONS) expect(counts[section]).toBeGreaterThan(0);
    expect(counts).toMatchObject({
      surfaces: 3,
      screens: 6,
      flows: 3,
      patterns: 2,
      decisions: 2,
    });
    for (const section of PRODUCT_CONTEXT_SECTIONS) {
      for (const element of context[section]) expect(element.sourceRef.path).not.toBe("");
    }
    expect(context.metadata).toMatchObject({
      adapter: "navori-master",
      mode: "full",
    });
    expect(context.metadata.uxReader).toBe("provisional-1");
    expect(context.metadata.sources.map((s) => [s.source, s.status])).toEqual([
      ["DECISIONS.md", "used"],
      ["MASTER.md", "used"],
      ["parts.json", "used"],
      ["ux.json", "used"],
      ["UX.md", "used"],
      ["DIGEST.md", "used"],
      ["CODEBASE.md", "read"],
      ["context", "used"],
      ["navori.config.json", "used"],
    ]);
  });

  // Covers: R3
  test("every element points to the source text it came from", () => {
    const root = copyFixture("membership-product");
    const { context } = build(root);
    const read = (path: string): string => readFileSync(join(root, path), "utf8");
    let checked = 0;
    for (const section of PRODUCT_CONTEXT_SECTIONS) {
      for (const element of context[section]) {
        const { path, locator } = element.sourceRef;
        const names = witnesses(element as unknown as Record<string, unknown>);
        const label = `${section}/${elementKey(element)} <- ${path} ${locator}`;
        let haystack: string;
        if (locator.startsWith("§")) {
          const doc = parseMarkdown(read(path));
          const found = [...doc.sections, ...(doc.title === null ? [] : [doc.title])].find(
            (candidate) => sectionAnchor(candidate) === locator,
          );
          if (found === undefined) throw new Error(`no section for ${label}`);
          haystack = [found.heading, ...sectionBody(doc, found)].join("\n");
        } else {
          const target = resolvePointer(JSON.parse(read(path)), locator);
          if (target === undefined) throw new Error(`pointer does not resolve for ${label}`);
          haystack = JSON.stringify(target);
        }
        const text = normalizeText(haystack);
        expect(
          names.some((name) => text.includes(normalizeText(name))),
          label,
        ).toBe(true);
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThan(60);
  });

  // Covers: R15, R16
  test("reads the harness language and tolerates unknown sections and fields", () => {
    const root = copyFixture("membership-product");
    const baseline = countSections(build(root).context);
    expect(language(build(root).context)).toBeNull();

    const config = join(root, "navori.config.json");
    writeFileSync(config, JSON.stringify({ name: "membership-product", language: "es" }));
    expect(language(build(root).context)).toBe("es");
    writeFileSync(config, JSON.stringify({ name: "membership-product", language: "fr" }));
    expect(language(build(root).context)).toBeNull();

    appendFileSync(join(root, STAGE, "MASTER.md"), "\n## Appendix\n\n- RN-99: Not a known role.\n");
    const rawUx = JSON.parse(readFileSync(join(root, STAGE, "ux.json"), "utf8")) as Record<
      string,
      unknown
    >;
    writeFileSync(
      join(root, STAGE, "ux.json"),
      JSON.stringify({
        ...rawUx,
        futureSection: [{ id: "X1" }],
        futureFlag: true,
      }),
    );
    const parts = JSON.parse(readFileSync(join(root, STAGE, "parts.json"), "utf8")) as {
      parts: Record<string, unknown>[];
    };
    writeFileSync(
      join(root, STAGE, "parts.json"),
      JSON.stringify({
        ...parts,
        extra: 1,
        parts: parts.parts.map((p) => ({ ...p, owner: "x" })),
      }),
    );

    const tolerant = build(root).context;
    expect(countSections(tolerant)).toEqual(baseline);
    expect(tolerant.businessRules.some((rule) => rule.text.includes("Not a known role"))).toBe(
      false,
    );
    expect(tolerant.metadata.uxExtensions.map((e) => e.key)).toEqual([
      "futureSection",
      "futureFlag",
    ]);
  });

  // Covers: R2, R3
  test("keeps UX sources unused outside full and fails when ux.json changes after detection", () => {
    const root = copyFixture("membership-product");
    const reference = buildProductContext(loadMasterDraft(root, "reference-only"), {
      ...META,
      mode: "reference-only",
    }).context;
    const status = (source: string) =>
      reference.metadata.sources.find((s) => s.source === source)?.status;
    expect([status("ux.json"), status("UX.md")]).toEqual(["unused", "unused"]);
    expect(countSections(reference)).toMatchObject({ surfaces: 0, screens: 0, states: 0 });
    expect(reference.metadata.uxReader).toBeNull();

    const request = { root, stage: null, fs: nodeFs, limits: DEFAULT_INPUT_LIMITS };
    const detected = navoriMasterAdapter.detect(request);
    if (detected.kind !== "detected") throw new Error("expected detected");
    appendFileSync(join(root, STAGE, "ux.json"), "\n");
    expect(
      navoriMasterAdapter.load({ ...request, report: detected.report, mode: "full" }),
    ).toMatchObject({ ok: false, code: "INPUTS_CHANGED" });
  });

  // Covers: R2, R16
  test("reports sources that cannot be read and keeps loading the rest", () => {
    const root = copyFixture("ux-invalid");
    writeFileSync(join(root, STAGE, "parts.json"), JSON.stringify({ version: 2, parts: [] }));
    const request = { root, stage: null, fs: nodeFs, limits: DEFAULT_INPUT_LIMITS };
    const detected = navoriMasterAdapter.detect(request);
    if (detected.kind !== "detected") throw new Error("expected detected");
    const loaded = navoriMasterAdapter.load({ ...request, report: detected.report, mode: "full" });
    if (!loaded.ok) throw new Error(loaded.message);
    const { draft } = loaded;
    const status = (source: string) => draft.sources.find((s) => s.source === source)?.status;
    expect([status("parts.json"), status("ux.json")]).toEqual(["unreadable", "unreadable"]);
    expect(status("MASTER.md")).not.toBe("unreadable");
    expect(draft.findings.map((f) => f.code)).toEqual(
      expect.arrayContaining(["HARNESS_VERSION_UNSUPPORTED", "UX_CONTRACT_INVALID"]),
    );
    expect(draft.uxReader).toBeNull();
  });
});
