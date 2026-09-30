// Covers: R15
import { describe, expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { generateSchemas } from "../../scripts/gen-schemas.ts";

const dir = new URL("../../schemas/", import.meta.url);

describe("json schemas", () => {
  test("schemas directory matches the Zod contracts", async () => {
    const generated = generateSchemas();
    const onDisk = readdirSync(dir)
      .filter((n) => n.endsWith(".schema.json"))
      .toSorted();
    expect(onDisk).toEqual([...generated.keys()].toSorted());
    for (const [name, text] of generated) {
      expect(await Bun.file(new URL(name, dir)).text()).toBe(text);
    }
  });
});
