// Covers: R9, R17, R19
import { expect, test } from "bun:test";
import { canonicalJson } from "../../../src/core/contracts/index.ts";
import { contentSha256 } from "../../../src/penpot/compiler/ids.ts";
import {
  makeBoard,
  makeRect,
  makeText,
  type ReviewPage,
} from "../../../src/penpot/compiler/nodes.ts";
import { renderScript, reviewScriptData } from "../../../src/penpot/compiler/script.ts";
import { penpotTemplate } from "../../../src/penpot/compiler/templates.ts";
import { createFakePenpot, runPenpotScript } from "../../helpers/fake-penpot.ts";
import { sha256Hex } from "../../../src/core/store/hash.ts";

const v1 = penpotTemplate("review-page");
const v2 = penpotTemplate("review-page", 2);
const hash = sha256Hex(new Uint8Array());
function page(version: number): ReviewPage {
  const template = penpotTemplate("review-page", version).ref;
  const nodes = [
    makeBoard(
      "frame",
      [
        makeText("text", '"); throw new Error("injected"); // ` ${penpot}\n\u0000\u2028\u2029😀', {
          name: "",
          width: null,
        }),
        makeRect("rect", 30, 40, {
          name: "alias",
          fill: null,
          stroke: { color: "#000000", width: 2, style: "dashed" },
        }),
        makeBoard("nested", [makeText("nested/text", "Nested")], {
          layout: { kind: "grid", columns: 2, gap: 4, padding: 5 },
          height: 80,
        }),
      ],
      { x: -2, y: 4 },
    ),
  ];
  return {
    heronId: "heron:proposal:DIR-A",
    kind: "proposal-page",
    name: "Review",
    mode: "reference-only",
    sourceSha256: hash,
    contentSha256: contentSha256({
      template,
      heronId: "heron:proposal:DIR-A",
      name: "Review",
      mode: "reference-only",
      sourceSha256: hash,
      nodes,
    }),
    template,
    nodes,
    issues: [],
  };
}

test("keeps frozen v1 bytes and fingerprints while versioning transport", () => {
  const renderer = v2.text.slice(v2.text.indexOf("// All external values"));
  expect(renderer).toBe(v1.text.replaceAll("review-page@v1", "review-page@v2"));
  expect(v1.sha256).toBe("ddf8f71c73de88dfbf65d4efd9c3f78bbddcd1d02ae8d7849ccc0832b17a8cb5");
  expect(penpotTemplate("inspect").sha256).toBe(
    "a049f753a7cc5a01658400989c9558b95a6c27fe2a2860d34423600f4c0e55c4",
  );
  const old = page(1);
  const next = page(2);
  expect(next.nodes).toEqual(old.nodes);
  expect(next.sourceSha256).toBe(old.sourceSha256);
  expect(next.contentSha256).not.toBe(old.contentSha256);
  expect(() => penpotTemplate("review-page", 5)).toThrow("unknown Penpot template");
});

test("rejects unknown transport discriminants before any Penpot mutation", async () => {
  const fake = createFakePenpot();
  const script = renderScript(v2, {
    ...reviewScriptData(page(2), null),
    nodes: [[9, "bad", null]],
  });
  if (!script.ok) throw new Error("small invalid script refused");
  await expect(runPenpotScript(fake, script.code)).rejects.toThrow("invalid Heron transport node");
  expect(fake.counters.mutations).toBe(0);
});

test("round-trips every semantic field including aliases, nulls, layouts and hostile strings", () => {
  const original = page(2);
  const payload = reviewScriptData(original, "x".repeat(36));
  const decoder = v2.text.split("// All external values")[0];
  const echo = { ...v2, text: `${decoder}return HERON;` };
  const script = renderScript(echo, payload);
  if (!script.ok) throw new Error("small codec script refused");
  const decoded: unknown = new Function(script.code)();
  expect(canonicalJson(decoded)).toBe(canonicalJson({ ...payload, nodes: original.nodes }));
  expect(reviewScriptData(original, "x".repeat(36))).toEqual(payload);
});

for (const version of [2, 3])
  test(`executes v${version} with the official API subset and preserves human work on retries`, async () => {
    const current = penpotTemplate("review-page", version);
    const fake = createFakePenpot();
    const original = page(version);
    const first = renderScript(current, reviewScriptData(original, null));
    if (!first.ok) throw new Error("small v2 script refused");
    const result = await runPenpotScript(fake, first.code);
    expect(result).toMatchObject({
      heron: `review-page@v${version}`,
      outcome: "written",
      shapes: 5,
    });
    const target = fake.penpot.currentFile?.pages[0];
    if (!target) throw new Error("page missing");
    expect(target.getSharedPluginData("heron", "template")).toBe(`review-page@v${version}`);
    const human = fake.penpot.createRectangle();
    const board = target.root.children[0];
    if (!board) throw new Error("board missing");
    board.appendChild(human);
    const retry = renderScript(current, reviewScriptData(original, target.id));
    if (!retry.ok) throw new Error("small retry refused");
    const before = fake.counters.mutations;
    expect(await runPenpotScript(fake, retry.code)).toMatchObject({ outcome: "human-shapes" });
    expect(fake.counters.mutations).toBe(before);
  });

test("fits complete repetitive node trees rejected by v1 and still blocks oversized v2", () => {
  const original = page(1);
  original.nodes = [
    makeBoard(
      "many",
      Array.from({ length: 160 }, (_, i) => makeText(`text-${i}`, `Label ${i}`)),
    ),
  ];
  expect(renderScript(v1, reviewScriptData(original, "x".repeat(36))).ok).toBe(false);
  const next = { ...original, template: v2.ref };
  expect(renderScript(v2, reviewScriptData(next, "x".repeat(36))).ok).toBe(true);
  const oversized = { ...next, nodes: [makeText("large", "😀".repeat(32768))] };
  expect(renderScript(v2, reviewScriptData(oversized, null)).ok).toBe(false);
});
