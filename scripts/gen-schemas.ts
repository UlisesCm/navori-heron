import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { z } from "zod";
import {
  CONTRACT_DOCUMENTS,
  canonicalJson,
  type DocumentSpec,
} from "../src/core/contracts/index.ts";

export function schemaFileName(spec: DocumentSpec<unknown>): string {
  return spec.schemaFile;
}

/** File name -> canonical JSON Schema text (draft 2020-12, output side) for every contract. */
export function generateSchemas(): Map<string, string> {
  const out = new Map<string, string>();
  for (const spec of CONTRACT_DOCUMENTS as readonly DocumentSpec<unknown>[]) {
    const schema = z.toJSONSchema(spec.schema, {
      target: "draft-2020-12",
      io: "output",
      unrepresentable: "throw",
    });
    out.set(
      schemaFileName(spec),
      canonicalJson({ ...schema, $id: spec.schemaFile, title: spec.kind }),
    );
  }
  return out;
}

if (import.meta.main) {
  const dir = new URL("../schemas/", import.meta.url);
  const generated = generateSchemas();
  mkdirSync(dir, { recursive: true });
  for (const name of readdirSync(dir)) {
    if (name.endsWith(".schema.json") && !generated.has(name)) rmSync(new URL(name, dir));
  }
  for (const [name, text] of generated) writeFileSync(new URL(name, dir), text);
}
