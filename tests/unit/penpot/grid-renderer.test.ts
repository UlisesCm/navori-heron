// Covers: R9, R10, R17, R19
import { expect, test } from "bun:test";
import { makeBoard, makeRect, type ReviewPage } from "../../../src/penpot/compiler/nodes.ts";
import { penpotTemplate } from "../../../src/penpot/compiler/templates.ts";
import { renderScript, reviewScriptData } from "../../../src/penpot/compiler/script.ts";
import { sha256Hex } from "../../../src/core/store/hash.ts";
import { createFakePenpot, runPenpotScript } from "../../helpers/fake-penpot.ts";

test("assigns every grid child to a distinct row-major cell", async () => {
  const template = penpotTemplate("review-page", 3);
  const hash = sha256Hex(new Uint8Array());
  const page: ReviewPage = {
    heronId: "heron:proposal:DIR-A",
    kind: "proposal-page",
    name: "Grid",
    mode: "reference-only",
    sourceSha256: hash,
    contentSha256: hash,
    template: template.ref,
    nodes: [
      makeBoard(
        "grid",
        Array.from({ length: 5 }, (_, i) => makeRect(`r${i}`, 80, 40)),
        { layout: { kind: "grid", columns: 2, gap: 8, padding: 4 } },
      ),
    ],
    issues: [],
  };
  const script = renderScript(template, reviewScriptData(page, null));
  if (!script.ok) throw new Error("fixture exceeds budget");
  const fake = createFakePenpot();
  await runPenpotScript(fake, script.code);
  const board = fake.penpot.currentPage?.root.children[0];
  expect(board?.children.map((child) => child.layoutCell)).toEqual([
    { row: 1, column: 1 },
    { row: 1, column: 2 },
    { row: 2, column: 1 },
    { row: 2, column: 2 },
    { row: 3, column: 1 },
  ]);
});

test("keeps v2 frozen and shares its reversible transport with v3", () => {
  const v2 = penpotTemplate("review-page", 2);
  const v3 = penpotTemplate("review-page", 3);
  expect(v2.sha256).toBe("712e7d4db8df16f2c7aa48183d891023e1770bcc3170816afdc2593541eacb8d");
  expect(v3.text.split("// All external values")[0]).toBe(
    v2.text.split("// All external values")[0],
  );
  expect(v3.sha256).not.toBe(v2.sha256);
});
