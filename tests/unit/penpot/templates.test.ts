// Covers: R9, R10, R13, R17, R19, R20
import { describe, expect, test } from "bun:test";
import { WrittenPageSchema, type WrittenPage } from "../../../src/penpot/results.ts";
import type { BoardLayout, PenpotNode, ReviewPage } from "../../../src/penpot/compiler/nodes.ts";
import { renderScript, reviewScriptData } from "../../../src/penpot/compiler/script.ts";
import { penpotTemplate } from "../../../src/penpot/compiler/templates.ts";
import { sha256Hex } from "../../../src/core/store/hash.ts";
import {
  createFakePenpot,
  runPenpotScript,
  type FakePenpot,
  type FakePage,
  type FakeShape,
} from "../../helpers/fake-penpot.ts";

const hash = sha256Hex(new Uint8Array());
const textNode = (
  key = "title",
  family = "Inter",
  width: number | null = 200,
): Extract<PenpotNode, { type: "text" }> => ({
  type: "text",
  key,
  name: key,
  characters: 'SYNTHETIC "); throw new Error("injected"); // 😀\u2028',
  width,
  fontFamily: family,
  fontSize: 24,
  fontWeight: 700,
  lineHeight: 1.4,
  color: "#112233",
});
const rectNode = (key = "swatch"): PenpotNode => ({
  type: "rect",
  key,
  name: key,
  width: 80,
  height: 40,
  fill: "#AABBCC",
  radius: 8,
  stroke: { color: "#112233", width: 2, style: "dashed" },
});
const boardNode = (
  layout: BoardLayout | null = { kind: "flex", dir: "column", gap: 12, padding: 16, wrap: false },
): PenpotNode => ({
  type: "board",
  key: "frame",
  name: "Frame",
  x: 30,
  y: 40,
  width: 400,
  height: null,
  fill: null,
  radius: 0,
  stroke: null,
  layout,
  children: [textNode(), rectNode()],
});
const review = (nodes: PenpotNode[] = [boardNode()]): ReviewPage => ({
  heronId: "heron:proposal:DIR-A",
  kind: "proposal-page",
  name: "REFERENCE ONLY — A",
  mode: "reference-only",
  sourceSha256: hash,
  contentSha256: hash,
  nodes,
  template: penpotTemplate("review-page").ref,
  issues: [],
});
function code(page: ReviewPage, target: string | null = null): string {
  const result = renderScript(penpotTemplate("review-page"), reviewScriptData(page, target));
  if (!result.ok) throw new Error(`fixture script exceeds budget: ${result.bytes}`);
  return result.code;
}
async function write(
  fake: FakePenpot,
  page: ReviewPage,
  target: string | null = null,
): Promise<WrittenPage> {
  return WrittenPageSchema.parse(await runPenpotScript(fake, code(page, target)));
}
function pageOf(fake: FakePenpot, id: string): FakePage {
  const page = fake.penpot.currentFile?.pages.find((candidate) => candidate.id === id);
  if (!page) throw new Error("fixture page missing");
  return page;
}
function shapes(root: FakeShape): FakeShape[] {
  return root.children.flatMap((child) => [child, ...shapes(child)]);
}
function shapeOf(page: FakePage, key: string): FakeShape {
  const shape = shapes(page.root).find(
    (candidate) => candidate.getSharedPluginData("heron", "id") === `heron:proposal:DIR-A/${key}`,
  );
  if (!shape) throw new Error(`fixture shape missing: ${key}`);
  return shape;
}

describe("Penpot templates against the official API subset", () => {
  test("renders a review page and marks the page and every shape", async () => {
    const fake = createFakePenpot();
    const result = await write(fake, review());
    expect(result).toMatchObject({
      outcome: "written",
      created: true,
      shapes: 3,
      fontFallbacks: [],
      humanShapes: [],
    });
    const page = pageOf(fake, result.pageId);
    expect(page.name).toBe(review().name);
    expect(page.getSharedPluginData("heron", "id")).toBe(review().heronId);
    expect(page.getSharedPluginData("heron", "content")).toBe(hash);
    expect(page.getSharedPluginData("heron", "source")).toBe(hash);
    expect(page.getSharedPluginData("heron", "template")).toBe("review-page@v1");
    expect(page.getSharedPluginData("heron", "mode")).toBe("reference-only");
    expect(shapes(page.root).map((shape) => shape.getSharedPluginData("heron", "id"))).toEqual([
      "heron:proposal:DIR-A/frame",
      "heron:proposal:DIR-A/title",
      "heron:proposal:DIR-A/swatch",
    ]);
    const title = shapeOf(page, "title");
    expect(title.characters).toBe(textNode().characters);
    expect([title.fontSize, title.fontWeight, title.lineHeight]).toEqual(["24", "700", "1.4"]);
    expect(title.fontVariantId).toBe("bold");
    expect(title.growType).toBe("auto-height");
    expect(title.width).toBe(200);
    const frame = shapeOf(page, "frame");
    expect([frame.x, frame.y, frame.width, frame.verticalSizing]).toEqual([30, 40, 400, "auto"]);
    expect(frame.children.map((shape) => shape.name)).toEqual(["title", "swatch"]);
    expect(frame.flex).toMatchObject({
      dir: "column",
      wrap: "nowrap",
      rowGap: 12,
      columnGap: 12,
      topPadding: 16,
    });
    const swatch = shapeOf(page, "swatch");
    expect(swatch.fills).toEqual([{ fillColor: "#AABBCC", fillOpacity: 1 }]);
    expect(swatch.strokes).toMatchObject([{ strokeStyle: "dashed", strokeWidth: 2 }]);
    expect(swatch.borderRadius).toBe(8);
    expect(fake.penpot.flags).toEqual({
      naturalChildOrdering: false,
      throwValidationErrors: false,
    });
  });

  test("rewrites only heron-marked shapes and keeps human shapes", async () => {
    const fake = createFakePenpot();
    const first = await write(fake, review());
    const page = pageOf(fake, first.pageId);
    const old = shapes(page.root).map((shape) => shape.id);
    const human = fake.penpot.createBoard();
    human.name = "Human root board";
    const other = fake.penpot.createBoard();
    other.setSharedPluginData("heron", "id", "heron:references/foreign");
    const result = await write(fake, review([textNode()]), page.id);
    expect(result).toMatchObject({ created: false, outcome: "written", shapes: 1 });
    expect(page.root.children.map((shape) => shape.id)).toContain(human.id);
    expect(page.root.children.map((shape) => shape.id)).toContain(other.id);
    expect(shapes(page.root).some((shape) => old.includes(shape.id))).toBe(false);
    // Owned shapes moved into an unmarked human container are removed individually, not with the parent.
    human.appendChild(shapeOf(page, "title"));
    await write(fake, review([]), page.id);
    expect(page.root.children.map((shape) => shape.id)).toEqual([human.id, other.id]);
    expect(human.children).toEqual([]);
  });

  test("refuses to rewrite a page whose Heron boards contain human shapes", async () => {
    for (const foreignMark of ["", "heron:references/foreign"]) {
      const fake = createFakePenpot();
      const first = await write(fake, review());
      const page = pageOf(fake, first.pageId);
      const board = shapeOf(page, "frame");
      for (let index = 0; index < 12; index += 1) {
        const human = fake.penpot.createRectangle();
        human.name = `Human ${index}`;
        if (foreignMark) human.setSharedPluginData("heron", "id", foreignMark);
        board.appendChild(human);
      }
      const ids = shapes(page.root).map((shape) => shape.id);
      const before = fake.counters.mutations;
      const result = await write(fake, review([]), page.id);
      expect(result.outcome).toBe("human-shapes");
      expect(result.humanShapes).toEqual(
        Array.from({ length: 10 }, (_, index) => `Human ${index}`),
      );
      expect(fake.counters.mutations).toBe(before);
      expect(shapes(page.root).map((shape) => shape.id)).toEqual(ids);
      expect(page.getSharedPluginData("heron", "content")).toBe(hash);
    }
  });

  test("selects the exact font family instead of a substring match", async () => {
    const fake = createFakePenpot();
    const nodes = [
      textNode("exact", "iNtEr", null),
      textNode("missing", "Missing Font"),
      textNode("missing-again", "Missing Font"),
    ];
    const result = await write(fake, review(nodes));
    const page = pageOf(fake, result.pageId);
    expect(shapeOf(page, "exact").fontFamily).toBe("Inter");
    expect(shapeOf(page, "exact").growType).toBe("auto-width");
    expect(shapeOf(page, "missing").fontFamily).toBe("Default");
    expect(result.fontFallbacks).toEqual(["Missing Font"]);
    // The missing weight uses Font's default variant, not an unrelated font family.
    fake.penpot.fonts.all[1]!.variants = [];
    const second = await write(fake, review([textNode()]), page.id);
    expect(second.outcome).toBe("written");
    expect(shapeOf(page, "title").fontFamily).toBe("Inter");
    expect(shapeOf(page, "title").fontWeight).toBe("700");
  });

  test("uses official grid tracks, flex wrap enums and shape resizing", async () => {
    const fake = createFakePenpot();
    const grid = await write(
      fake,
      review([boardNode({ kind: "grid", columns: 2, gap: 8, padding: 4 })]),
    );
    const page = pageOf(fake, grid.pageId);
    const frame = shapeOf(page, "frame");
    expect(frame.grid?.columns).toEqual([
      { type: "flex", value: 1 },
      { type: "flex", value: 1 },
    ]);
    expect(frame.grid?.rows).toEqual([{ type: "auto" }]);
    await write(
      fake,
      review([boardNode({ kind: "flex", dir: "row", gap: 3, padding: 2, wrap: true })]),
      page.id,
    );
    expect(shapeOf(page, "frame").flex?.wrap).toBe("wrap");
    await write(fake, review([boardNode(null)]), page.id);
    expect(shapeOf(page, "frame").flex).toBeUndefined();
    expect(() => Reflect.set(frame, "width", 20)).toThrow("readonly");
    expect(() => Reflect.set(shapeOf(page, "title"), "fontSize", 20)).toThrow("strings");
  });

  test("leaves content empty when createText returns null and converges after recovery", async () => {
    const fake = createFakePenpot();
    const first = await write(fake, review());
    const page = pageOf(fake, first.pageId);
    fake.controls.failText = true;
    await expect(write(fake, review(), page.id)).rejects.toThrow("could not create a text shape");
    expect(page.getSharedPluginData("heron", "content")).toBe("");
    expect(fake.penpot.flags.throwValidationErrors).toBe(false);
    fake.controls.failText = false;
    expect((await write(fake, review(), page.id)).outcome).toBe("written");
    expect(shapes(page.root)).toHaveLength(3);
    expect(page.getSharedPluginData("heron", "content")).toBe(hash);
  });

  test("inspects heron pages without mutating the file", async () => {
    const fake = createFakePenpot();
    const first = await write(fake, review());
    const managed = pageOf(fake, first.pageId);
    const human = fake.penpot.createPage();
    await fake.penpot.openPage(human);
    const before = { ...fake.counters };
    const rendered = renderScript(penpotTemplate("inspect"), {});
    if (!rendered.ok) throw new Error("inspect fixture refused");
    const inspected = await runPenpotScript(fake, rendered.code);
    expect(inspected).toEqual({
      heron: "inspect@v1",
      penpotVersion: "2.17.2",
      file: { id: "file-1", name: "Test file" },
      pages: [
        {
          pageId: managed.id,
          name: managed.name,
          marks: {
            id: review().heronId,
            content: hash,
            source: hash,
            template: "review-page@v1",
            mode: "reference-only",
          },
        },
      ],
      unmanagedPages: 1,
    });
    expect(fake.counters.mutations).toBe(before.mutations);
    expect(fake.counters.opens).toBe(before.opens);
    expect(fake.counters.reads).toBeGreaterThan(before.reads);
    expect(fake.penpot.currentPage?.id).toBe(human.id);
    managed.setSharedPluginData("heron", "content", "");
    const result = await runPenpotScript(fake, rendered.code);
    expect(result).toMatchObject({ pages: [{ marks: { content: null } }] });
    fake.penpot.currentFile = null;
    expect(await runPenpotScript(fake, rendered.code)).toEqual({
      heron: "inspect@v1",
      penpotVersion: "2.17.2",
      file: null,
      pages: [],
      unmanagedPages: 0,
    });
  });

  test("awaits openPage before creating shapes and safely serializes delayed writes", async () => {
    const fake = createFakePenpot();
    let release: (() => void) | undefined;
    const wait = new Promise<void>((resolve) => {
      release = resolve;
    });
    fake.controls.beforeOpen = async (): Promise<void> => {
      await wait;
    };
    const delayed = write(fake, review());
    const page = fake.penpot.currentFile!.pages[0]!;
    expect(page.root.children).toHaveLength(0);
    expect(page.getSharedPluginData("heron", "content")).toBe("");
    fake.controls.beforeOpen = null;
    expect((await write(fake, review(), page.id)).outcome).toBe("written");
    release!();
    expect((await delayed).outcome).toBe("written");
    expect(shapes(page.root)).toHaveLength(3);
    expect(page.getSharedPluginData("heron", "content")).toBe(hash);
  });

  test("leaves the page without a content mark when two writes interleave", async () => {
    const fake = createFakePenpot();
    const first = await write(fake, review());
    const page = pageOf(fake, first.pageId);
    const lateShapes = page.root.children;
    // Fault injection: queued mutations of the earlier writer land during the new writer's final marks.
    fake.controls.afterMutation = (operation): void => {
      if (operation !== "mark:source") return;
      fake.controls.afterMutation = null;
      for (const late of lateShapes) page.root.appendChild(late);
      page.setSharedPluginData("heron", "content", hash); // earlier writer completed its final mark late
    };
    const result = await write(fake, review(), page.id);
    expect(result.outcome).toBe("conflict");
    expect(page.getSharedPluginData("heron", "content")).toBe("");
    expect(shapes(page.root)).toHaveLength(0);
    expect((await write(fake, review(), page.id)).outcome).toBe("written");
    expect(shapes(page.root)).toHaveLength(3);
  });

  test("detects replaced shapes with identical keys and preserves late human work", async () => {
    for (const addHuman of [false, true]) {
      const fake = createFakePenpot();
      const first = await write(fake, review([rectNode()]));
      const page = pageOf(fake, first.pageId);
      fake.controls.afterMutation = (operation): void => {
        if (operation !== "mark:source") return;
        fake.controls.afterMutation = null;
        if (addHuman) {
          // Duplicate owned shape has a human descendant: conflict cleanup must not delete it.
          const duplicate = fake.penpot.createBoard();
          duplicate.setSharedPluginData("heron", "id", review().heronId + "/late");
          const human = fake.penpot.createRectangle();
          human.name = "Late human";
          duplicate.appendChild(human);
        } else {
          shapeOf(page, "swatch").remove();
          const replacement = fake.penpot.createRectangle();
          replacement.setSharedPluginData("heron", "id", review().heronId + "/swatch");
        }
      };
      expect((await write(fake, review([rectNode()]), page.id)).outcome).toBe("conflict");
      expect(page.getSharedPluginData("heron", "content")).toBe("");
      expect(shapes(page.root).some((shape) => shape.name === "Late human")).toBe(addHuman);
    }
  });

  test("rejects duplicate keys and unmanaged targets before changing document data", async () => {
    const fake = createFakePenpot();
    const human = fake.penpot.createPage();
    const before = fake.counters.mutations;
    await expect(write(fake, review([textNode(), textNode()]))).rejects.toThrow(
      "duplicate Heron node key",
    );
    await expect(write(fake, review(), human.id)).rejects.toThrow("target page is not marked");
    expect(fake.counters.mutations).toBe(before);
    fake.penpot.currentFile = null;
    await expect(write(fake, review())).rejects.toThrow("no Penpot file is open");
  });
});
