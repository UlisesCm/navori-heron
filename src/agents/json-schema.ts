import { z } from "zod";
import type { JsonSchemaObject } from "./ports.ts";

export type SchemaDialect = "claude" | "openai-strict";

/** The closed keyword list of the conservative strict dialect (DR13); widen a word only when the live probe proves it. */
export const OPENAI_STRICT_KEYWORDS: readonly string[] = [
  "type",
  "properties",
  "required",
  "additionalProperties",
  "items",
  "enum",
  "const",
  "anyOf",
  "description",
];

type Node = Record<string, unknown>;
const isNode = (value: unknown): value is Node =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Local constraints stay out of the conservative keyword dialect, but must reach the model. */
const CONSTRAINT_HINT_KEYWORDS: readonly string[] = [
  "pattern",
  "format",
  "minLength",
  "maxLength",
  "minItems",
  "maxItems",
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "multipleOf",
];

/** Keeps only strict keywords; stripped constraints become description hints, never weaker local validation. */
function strictNode(node: Node): Node {
  const out: Node = {};
  for (const [key, value] of Object.entries(node)) {
    if (!OPENAI_STRICT_KEYWORDS.includes(key)) continue;
    if (key === "properties" && isNode(value)) {
      out[key] = Object.fromEntries(
        Object.entries(value).map(([name, child]) => [
          name,
          isNode(child) ? strictNode(child) : child,
        ]),
      );
    } else if (key === "items" && isNode(value)) {
      out[key] = strictNode(value);
    } else if (key === "additionalProperties" && isNode(value)) {
      out[key] = strictNode(value);
    } else if (key === "anyOf" && Array.isArray(value)) {
      out[key] = value.map((child: unknown) => (isNode(child) ? strictNode(child) : child));
    } else {
      out[key] = value;
    }
  }
  const hints = Object.fromEntries(
    Object.entries(node).filter(([key]) => CONSTRAINT_HINT_KEYWORDS.includes(key)),
  );
  if (Object.keys(hints).length > 0) {
    const description = typeof node["description"] === "string" ? `${node["description"]}\n` : "";
    out["description"] = `${description}Heron validation constraints: ${JSON.stringify(hints)}`;
  }
  return out;
}

/**
 * claude: draft-7 `z.toJSONSchema` without the root `$schema`, so the CLI's own validator applies its default dialect
 * (its Ajv does not resolve the 2020-12 meta-schema; live probe 2026-10-01, DR13).
 * openai-strict: keeps only OPENAI_STRICT_KEYWORDS at every node, with local constraint hints in descriptions (DR13).
 */
export function toProviderSchema(
  schema: z.ZodType<unknown>,
  dialect: SchemaDialect,
): JsonSchemaObject {
  const json = z.toJSONSchema(schema, {
    target: dialect === "claude" ? "draft-7" : "draft-2020-12",
    io: "output",
    unrepresentable: "throw",
  }) as Node;
  if (dialect === "claude") {
    const { $schema: _dropped, ...rest } = json;
    return rest;
  }
  return strictNode(json);
}

function check(node: Node, dialect: SchemaDialect, at: string): void {
  if (dialect === "openai-strict") {
    for (const key of Object.keys(node)) {
      if (!OPENAI_STRICT_KEYWORDS.includes(key))
        throw new Error(`${at}: keyword "${key}" is not allowed`);
    }
  }
  const properties = node["properties"];
  if (node["type"] === "object" || isNode(properties)) {
    if (node["additionalProperties"] !== false) {
      throw new Error(`${at}: object without additionalProperties:false`);
    }
    const names = isNode(properties) ? Object.keys(properties) : [];
    const required = Array.isArray(node["required"]) ? (node["required"] as unknown[]) : [];
    for (const name of names) {
      if (!required.includes(name)) throw new Error(`${at}: property "${name}" is not required`);
    }
  }
  if (isNode(properties)) {
    for (const [name, child] of Object.entries(properties)) {
      if (isNode(child)) check(child, dialect, `${at}/properties/${name}`);
    }
  }
  const items = node["items"];
  if (isNode(items)) check(items, dialect, `${at}/items`);
  const anyOf = node["anyOf"];
  if (Array.isArray(anyOf)) {
    anyOf.forEach((child: unknown, index) => {
      if (isNode(child)) check(child, dialect, `${at}/anyOf/${index}`);
    });
  }
}

/** Throws when an object node lacks additionalProperties:false, lists fewer required keys than properties, or
 * (openai-strict) uses a keyword outside OPENAI_STRICT_KEYWORDS. Tests only. */
export function assertStrictCompatible(schema: JsonSchemaObject, dialect: SchemaDialect): void {
  check(schema as Node, dialect, "");
}
