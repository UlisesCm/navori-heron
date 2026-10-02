import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { Ajv2020 } from "ajv/dist/2020.js";
import { CONTRACT_DOCUMENTS, ExitCode, type DocumentSpec } from "../../src/core/contracts/index.ts";
import { runCliCaptured } from "../helpers/cli.ts";
import { e2eSetup } from "../helpers/e2e.ts";
import { type FixtureName } from "../helpers/fixtures.ts";

const SCHEMAS = new URL("../../schemas/", import.meta.url).pathname;
const FIXTURES = new URL("../../fixtures/", import.meta.url).pathname;
const MARKER = "SYNTHETIC fixture — not a real product.";
const MD_MARKER = "> SYNTHETIC — fixture data, not a real product.";

const { initialized } = e2eSetup();

/** Every regular file under `dir`, repo-relative with "/" separators, byte-ordered. */
function listFiles(dir: string, base = dir): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFiles(full, base));
    else if (entry.isFile()) out.push(relative(base, full).split("\\").join("/"));
  }
  return out.toSorted((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

const fixtureNames = readdirSync(FIXTURES, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .toSorted();

describe("emitted JSON Schemas", () => {
  // Covers: R11
  test("emitted JSON Schemas validate every fixture and fixtures are marked SYNTHETIC", async () => {
    const ajv = new Ajv2020({ strict: true });
    const specs = CONTRACT_DOCUMENTS as readonly DocumentSpec<unknown>[];
    const validators = new Map<string, ReturnType<typeof ajv.compile>>();
    const schemaFiles = readdirSync(SCHEMAS)
      .filter((name) => name.endsWith(".schema.json"))
      .toSorted();
    expect(schemaFiles).toEqual(specs.map((spec) => spec.schemaFile).toSorted());
    for (const spec of specs) {
      const schema: unknown = JSON.parse(readFileSync(join(SCHEMAS, spec.schemaFile), "utf8"));
      validators.set(spec.kind, ajv.compile(schema as object));
    }
    for (const kind of ["ProductContext", "IntakeConflicts", "ManualContext"]) {
      expect(validators.has(kind)).toBe(true);
    }

    const manual: unknown = JSON.parse(
      readFileSync(new URL("../assets/intake/manual-context.json", import.meta.url), "utf8"),
    );
    const validateManual = validators.get("ManualContext");
    expect(validateManual?.(manual), JSON.stringify(validateManual?.errors)).toBe(true);

    expect(fixtureNames.length).toBeGreaterThan(0);
    for (const name of fixtureNames) {
      // SYNTHETIC manifest: marker line, blank line, sorted data files = disk minus SYNTHETIC.
      const dir = join(FIXTURES, name);
      const manifest = readFileSync(join(dir, "SYNTHETIC"), "utf8").split("\n");
      expect(manifest[0]).toBe(MARKER);
      expect(manifest[1]).toBe("");
      const declared = manifest.slice(2).filter((line) => line !== "");
      const onDisk = listFiles(dir).filter((file) => file !== "SYNTHETIC");
      expect(declared).toEqual(onDisk);
      for (const file of onDisk.filter((f) => f.endsWith(".md"))) {
        expect(readFileSync(join(dir, file), "utf8").split("\n")[0]).toBe(MD_MARKER);
      }
      for (const file of onDisk.filter((f) => f.endsWith(".json"))) {
        expect(() => JSON.parse(readFileSync(join(dir, file), "utf8"))).not.toThrow();
      }

      // Every Heron document emitted from a copy of the fixture validates against its schema.
      const root = await initialized(name as FixtureName);
      expect((await runCliCaptured(["intake", "--json", root])).code).toBe(ExitCode.Ok);
      const emitted = listFiles(join(root, ".heron")).filter((f) => f.endsWith(".json"));
      const kinds = new Set<string>();
      for (const file of emitted) {
        const doc = JSON.parse(readFileSync(join(root, ".heron", file), "utf8")) as {
          kind?: string;
        };
        const validate = validators.get(doc.kind ?? "");
        expect(validate, `${name}/${file}: kind ${String(doc.kind)} has no schema`).toBeDefined();
        if (validate === undefined) continue;
        expect(validate(doc), `${name}/${file}: ${JSON.stringify(validate.errors)}`).toBe(true);
        kinds.add(doc.kind as string);
      }
      for (const kind of ["HeronProject", "HeronState", "ProductContext", "IntakeConflicts"]) {
        expect(kinds.has(kind), `${name} emits ${kind}`).toBe(true);
      }
    }
  });
});
