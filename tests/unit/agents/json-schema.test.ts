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
  test("emits provider schemas that both CLIs accept in strict mode", () => {
    for (const [name, schema] of Object.entries(OUTPUTS)) {
      const claude = toProviderSchema(schema, "claude");
      const strict = toProviderSchema(schema, "openai-strict");
      expect(() => assertStrictCompatible(claude, "claude")).not.toThrow();
      expect(() => assertStrictCompatible(strict, "openai-strict")).not.toThrow();
      expect(claude).toEqual(
        z.toJSONSchema(schema, { target: "draft-2020-12", io: "output", unrepresentable: "throw" }),
      );
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
    expect(JSON.stringify(toProviderSchema(OUTPUTS.brief, "openai-strict"))).not.toContain(
      "minItems",
    );
    // property names that collide with keywords survive
    const odd = toProviderSchema(
      z.strictObject({ pattern: z.string().min(1), tag: z.enum(["a", "b"]).nullable() }),
      "openai-strict",
    );
    expect(Object.keys(odd["properties"] as object)).toEqual(["pattern", "tag"]);
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
