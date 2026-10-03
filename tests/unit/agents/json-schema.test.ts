// Covers: R1
import { describe, expect, test } from "bun:test";
import { z } from "zod";
import {
  DirectionProposalOutputSchema,
  ProbeOutputSchema,
  ResearchAnalysisOutputSchema,
  ResearchBriefOutputSchema,
} from "../../../src/core/contracts/index.ts";
import {
  OPENAI_STRICT_KEYWORDS,
  assertStrictCompatible,
  toProviderSchema,
} from "../../../src/agents/json-schema.ts";

const OUTPUTS = {
  brief: ResearchBriefOutputSchema,
  analysis: ResearchAnalysisOutputSchema,
  directions: DirectionProposalOutputSchema,
  probe: ProbeOutputSchema,
} as const;

/** Every key that is a schema keyword (not a property name or enum value) in the tree. */
function keywordsIn(node: unknown, out: Set<string>): void {
  if (Array.isArray(node)) return node.forEach((child) => keywordsIn(child, out));
  if (typeof node !== "object" || node === null) return;
  for (const [key, value] of Object.entries(node)) {
    out.add(key);
    if (key === "properties" && typeof value === "object" && value !== null) {
      Object.values(value).forEach((child) => keywordsIn(child, out));
    } else if (key !== "enum" && key !== "const" && key !== "required") keywordsIn(value, out);
  }
}

describe("toProviderSchema", () => {
  test("communicates component color and typography references to both providers", () => {
    for (const dialect of ["openai-strict", "claude"] as const) {
      const schema = JSON.stringify(toProviderSchema(DirectionProposalOutputSchema, dialect));
      expect(schema).toContain(
        "Text color ID from this direction’s palette.colors[].id; not label text or UI copy.",
      );
      expect(schema).toContain("Background color ID from this direction’s palette.colors[].id");
      expect(schema).toContain("Typography step ID from this direction’s typeScale.steps[].id.");
    }
  });

  test("communicates stripped constraints through descriptions without widening strict keywords", () => {
    const schema = z.strictObject({
      id: z
        .string()
        .regex(/^n[0-9]{1,2}$/)
        .min(2)
        .max(3)
        .describe("Node ID"),
      list: z.array(z.number().min(0).max(5)).min(1).max(3),
    });
    const strict = toProviderSchema(schema, "openai-strict");
    const text = JSON.stringify(strict);
    expect(text).toContain("n[0-9]{1,2}");
    expect(text).toContain("Node ID");
    for (const constraint of [
      "minLength",
      "maxLength",
      "minItems",
      "maxItems",
      "minimum",
      "maximum",
    ])
      expect(text).toContain(constraint);
    expect(() => assertStrictCompatible(strict, "openai-strict")).not.toThrow();
    const used = new Set<string>();
    keywordsIn(strict, used);
    for (const key of used) expect(OPENAI_STRICT_KEYWORDS).toContain(key);
    expect(JSON.stringify(toProviderSchema(schema, "openai-strict"))).toBe(text);
    expect(JSON.stringify(toProviderSchema(OUTPUTS.directions, "openai-strict"))).toContain(
      "n[0-9]{1,2}",
    );
  });
  test("emits provider schemas that both CLIs accept in strict mode", () => {
    for (const [name, schema] of Object.entries(OUTPUTS)) {
      const claude = toProviderSchema(schema, "claude");
      const strict = toProviderSchema(schema, "openai-strict");
      expect(() => assertStrictCompatible(claude, "claude")).not.toThrow();
      expect(() => assertStrictCompatible(strict, "openai-strict")).not.toThrow();
      const { $schema: _meta, ...draft7 } = z.toJSONSchema(schema, {
        target: "draft-7",
        io: "output",
        unrepresentable: "throw",
      }) as Record<string, unknown>;
      expect(claude).toEqual(draft7);
      const used = new Set<string>();
      keywordsIn(strict, used);
      for (const key of used) expect(OPENAI_STRICT_KEYWORDS).toContain(key);
      expect(strict["type"], name).toBe("object");
      // deterministic: same bytes on every call
      expect(JSON.stringify(toProviderSchema(schema, "openai-strict"))).toBe(
        JSON.stringify(strict),
      );
    }
    // the strict dialect really strips what the claude one keeps
    expect(JSON.stringify(toProviderSchema(OUTPUTS.brief, "claude"))).toContain("minItems");
    const briefKeywords = new Set<string>();
    keywordsIn(toProviderSchema(OUTPUTS.brief, "openai-strict"), briefKeywords);
    expect(briefKeywords).not.toContain("minItems");
    // property names that collide with keywords survive
    const odd = toProviderSchema(
      z.strictObject({ pattern: z.string().min(1), tag: z.enum(["a", "b"]).nullable() }),
      "openai-strict",
    );
    expect(Object.keys(odd["properties"] as object)).toEqual(["pattern", "tag"]);
  });

  test("claude dialect drops $schema and avoids keywords that need the 2020-12 meta-schema", () => {
    // Covers: R1
    for (const [name, schema] of Object.entries(OUTPUTS)) {
      const claude = toProviderSchema(schema, "claude");
      expect(claude, name).not.toHaveProperty("$schema");
      const text = JSON.stringify(claude);
      for (const keyword of ["$defs", "definitions", "prefixItems", "$ref", "$dynamicRef"]) {
        expect(text, `${name}: ${keyword}`).not.toContain(`"${keyword}"`);
      }
    }
  });

  test("assertStrictCompatible rejects loose objects, optional keys and foreign keywords", () => {
    const loose = toProviderSchema(z.looseObject({ a: z.string() }), "claude");
    expect(() => assertStrictCompatible(loose, "claude")).toThrow("additionalProperties");
    const optional = toProviderSchema(z.strictObject({ a: z.string().optional() }), "claude");
    expect(() => assertStrictCompatible(optional, "claude")).toThrow("not required");
    const nested = toProviderSchema(
      z.strictObject({ list: z.array(z.looseObject({ a: z.string() })) }),
      "claude",
    );
    expect(() => assertStrictCompatible(nested, "claude")).toThrow("/properties/list/items");
    const union = toProviderSchema(
      z.strictObject({ u: z.union([z.strictObject({ a: z.string() }), z.looseObject({})]) }),
      "claude",
    );
    expect(() => assertStrictCompatible(union, "claude")).toThrow("anyOf/1");
    const withMin = toProviderSchema(z.strictObject({ a: z.string().min(1) }), "claude");
    expect(() => assertStrictCompatible(withMin, "claude")).not.toThrow();
    expect(() => assertStrictCompatible(withMin, "openai-strict")).toThrow("is not allowed");
  });
});
