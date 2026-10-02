// Covers: R11, R16
import { describe, expect, test } from "bun:test";
import {
  canonicalJson,
  ResearchReferencesSchema,
  type ResearchReference,
} from "../../../src/core/contracts/index.ts";
import {
  buildReferencesPage,
  REFERENCES_LIMITS,
} from "../../../src/penpot/compiler/references-page.ts";
import { resolvePenpotCopy } from "../../../src/penpot/compiler/copy.ts";
import { contentSha256, referencesSourceSha256 } from "../../../src/penpot/compiler/ids.ts";
import {
  MAX_SCRIPT_BYTES,
  renderScript,
  reviewScriptData,
} from "../../../src/penpot/compiler/script.ts";
import { penpotTemplate } from "../../../src/penpot/compiler/templates.ts";
import type { BoardNode, ReviewPage } from "../../../src/penpot/compiler/nodes.ts";
import { WrittenPageSchema } from "../../../src/penpot/results.ts";
import { sampleReference } from "../../helpers/research.ts";
import { createFakePenpot, runPenpotScript } from "../../helpers/fake-penpot.ts";

const template = penpotTemplate("review-page");
const context = { mode: "reference-only" as const, copy: resolvePenpotCopy("en"), template };
const uuid = "00000000-0000-0000-0000-000000000000";
function gridOf(page: ReviewPage): BoardNode {
  const grid = page.nodes[1];
  if (grid?.type !== "board") throw new Error("expected reference grid");
  return grid;
}
function cardOf(page: ReviewPage, index = 0): BoardNode {
  const card = gridOf(page).children[index];
  if (card?.type !== "board") throw new Error("expected reference card");
  return card;
}
function dataText(card: BoardNode, suffix: string): string {
  const node = card.children.find((child) => child.key.endsWith(`/${suffix}`));
  if (node?.type !== "text") throw new Error(`expected text ${suffix}`);
  return node.characters;
}

describe("references page compiler", () => {
  test("builds one text card per active reference within the caps", () => {
    const values = Array.from(
      { length: 7 },
      (_, index) => `SYNTHETIC ${index} ${"😀".repeat(210)}`,
    );
    const refs = [
      sampleReference({ id: "REF-10" }),
      sampleReference({
        id: "REF-2",
        origin: "😀".repeat(201),
        reason: "x".repeat(2000),
        studies: values,
        doNotCopy: values,
        influences: values,
      }),
      sampleReference({ id: "REF-1", removed: { at: "2026-10-02T10:00:00.000Z", reason: null } }),
    ];
    const before = canonicalJson(refs);
    const page = buildReferencesPage(refs, context);
    expect(page.heronId).toBe("heron:references");
    expect(page.kind).toBe("references-page");
    expect(page.name).toContain("REFERENCE ONLY");
    expect(gridOf(page).layout).toMatchObject({ kind: "grid", columns: 4 });
    expect(gridOf(page).children.map((card) => card.name)).toEqual(["REF-2", "REF-10"]);
    const card = cardOf(page);
    for (const field of ["studies", "doNotCopy", "influences"])
      expect(
        card.children.filter(
          (node) => node.key.includes(`/${field}/`) && !node.key.endsWith("/label"),
        ),
      ).toHaveLength(5);
    expect(Array.from(dataText(card, "origin/0"))).toHaveLength(200);
    expect(dataText(card, "origin/0")).toBe(`${"😀".repeat(199)}…`);
    expect(dataText(card, "reason/0")).toEndWith("…");
    expect(
      card.children.every(
        (node) => node.type === "text" && Array.from(node.characters).length <= 200,
      ),
    ).toBe(true);
    expect(page.sourceSha256).toBe(referencesSourceSha256(refs));
    expect(page.contentSha256).toBe(contentSha256(page));
    expect(page.issues).toEqual([]);
    expect(canonicalJson(refs)).toBe(before);
  });

  test("shows localized crop notes and an image placeholder without loading any image", () => {
    const hash = "a".repeat(64);
    const ref = sampleReference({
      source: "image",
      capture: {
        kind: "image",
        method: "file",
        file: { name: "SYNTHETIC.png", location: "repo" },
        image: {
          path: `research/assets/${hash}.webp`,
          sha256: hash,
          mediaType: "image/webp",
          width: 100,
          height: 100,
          bytes: 10,
          trust: "untrusted",
          original: { sha256: hash, mediaType: "image/png", bytes: 20 },
          removedMetadata: [],
        },
      },
      crops: Array.from({ length: 6 }, (_, index) => ({
        x: index,
        y: 0,
        width: 10,
        height: 10,
        note: `SYNTHETIC crop ${index}`,
      })),
    });
    const page = buildReferencesPage([ref], { ...context, copy: resolvePenpotCopy("es-MX") });
    const card = cardOf(page);
    expect(dataText(card, "crops/0")).toBe("0,0 10×10 · SYNTHETIC crop 0");
    expect(dataText(card, "crops/label")).toBe("Recortes");
    expect(dataText(card, "image")).toBe("Imagen no mostrada en P12");
    expect(
      card.children.filter((node) => node.key.includes("/crops/") && !node.key.endsWith("/label")),
    ).toHaveLength(5);
    expect(canonicalJson(page.nodes)).not.toContain("assets/");
    expect(page.name).toContain("SOLO REFERENCIA");
    const full = buildReferencesPage([], { ...context, mode: "full" });
    expect(full.name).not.toContain("REFERENCE ONLY");
    expect(gridOf(full).children).toEqual([]);
    expect(full.issues).toEqual([]);
  });

  test("fits the longest deterministic reference prefix into the script byte budget", () => {
    const refs: ResearchReference[] = Array.from({ length: 51 }, (_, index) =>
      sampleReference({
        id: `REF-${index + 1}`,
        origin: `SYNTHETIC ${'😀\\"\u2028'.repeat(300)}`,
        reason: "\\".repeat(2000),
        studies: Array.from({ length: 20 }, (_value, item) => `${item}${"😀".repeat(200)}`),
        doNotCopy: Array.from({ length: 20 }, (_value, item) => `${item}${"\\".repeat(498)}`),
        influences: Array.from({ length: 20 }, (_value, item) => `${item}${'"'.repeat(498)}`),
      }),
    );
    expect(
      ResearchReferencesSchema.safeParse({
        kind: "ResearchReferences",
        schemaVersion: 1,
        mode: "reference-only",
        references: refs,
      }).success,
    ).toBe(true);
    const page = buildReferencesPage(refs.toReversed(), context);
    const count = gridOf(page).children.length;
    expect(count).toBeGreaterThan(0);
    expect(count).toBeLessThan(REFERENCES_LIMITS.maxCards);
    expect(gridOf(page).children.map((card) => card.name)).toEqual(
      refs.slice(0, count).map((ref) => ref.id),
    );
    expect(page.issues).toEqual([
      {
        code: "PENPOT_REFERENCES_TRUNCATED",
        pointer: null,
        message: `Showing ${count} references; omitted: ${refs
          .slice(count)
          .map((ref) => ref.id)
          .join(", ")}.`,
      },
    ]);
    expect(page.sourceSha256).toBe(referencesSourceSha256(refs));
    for (const target of [null, uuid]) {
      const rendered = renderScript(template, reviewScriptData(page, target));
      expect(rendered.ok).toBe(true);
      if (!rendered.ok) throw new Error("selected prefix must fit");
      expect(new TextEncoder().encode(rendered.code).byteLength).toBeLessThanOrEqual(
        MAX_SCRIPT_BYTES,
      );
    }
    const next = structuredClone(page);
    gridOf(next).children.push(cardOf(buildReferencesPage([refs[count]!], context)));
    next.contentSha256 = contentSha256(next);
    expect(renderScript(template, reviewScriptData(next, uuid)).ok).toBe(false);
    expect(canonicalJson(page)).toBe(canonicalJson(buildReferencesPage(refs, context)));
    const changed = structuredClone(refs);
    changed[50]!.reason = "Changed omitted reference";
    expect(buildReferencesPage(changed, context).sourceSha256).not.toBe(page.sourceSha256);
  });

  test("returns no cards when only the header fits and lets the renderer reject an oversized header", () => {
    const header = buildReferencesPage([], context);
    const rendered = renderScript(template, reviewScriptData(header, uuid));
    if (!rendered.ok) throw new Error("header must fit");
    const padded = {
      ...template,
      text:
        template.text +
        " ".repeat(MAX_SCRIPT_BYTES - new TextEncoder().encode(rendered.code).byteLength),
    };
    const page = buildReferencesPage([sampleReference()], { ...context, template: padded });
    expect(gridOf(page).children).toEqual([]);
    expect(renderScript(padded, reviewScriptData(page, uuid)).ok).toBe(true);
    const oversized = { ...padded, text: padded.text + " ".repeat(100) };
    const blocked = buildReferencesPage([sampleReference()], { ...context, template: oversized });
    expect(gridOf(blocked).children).toEqual([]);
    expect(renderScript(oversized, reviewScriptData(blocked, null)).ok).toBe(false);
    expect(blocked.issues[0]?.message).toContain("REF-1");
  });

  test("executes hostile reference text as data in the real review template", async () => {
    const origin = 'SYNTHETIC "); throw new Error("injected"); // ` ${penpot}';
    const page = buildReferencesPage([sampleReference({ origin })], context);
    const script = renderScript(template, reviewScriptData(page, null));
    if (!script.ok) throw new Error("single reference must fit");
    const fake = createFakePenpot();
    expect(WrittenPageSchema.parse(await runPenpotScript(fake, script.code)).outcome).toBe(
      "written",
    );
    expect(dataText(cardOf(page), "origin/0")).toBe(origin);
    const root = fake.penpot.currentFile?.pages[0]?.root;
    const shapes =
      root?.children.flatMap((section) => section.children.flatMap((card) => card.children)) ?? [];
    expect(shapes.some((shape) => shape.characters === origin)).toBe(true);
  });
});
