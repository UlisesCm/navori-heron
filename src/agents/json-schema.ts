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

/** Keeps only OPENAI_STRICT_KEYWORDS at every schema node; property names and enum/const values are data, not keywords. */
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
  return out;
}

/** claude: `z.toJSONSchema` as is. openai-strict: keeps only OPENAI_STRICT_KEYWORDS at every node (DR13). */
export function toProviderSchema(
  schema: z.ZodType<unknown>,
  dialect: SchemaDialect,
): JsonSchemaObject {
  const json = z.toJSONSchema(schema, {
    target: "draft-2020-12",
    io: "output",
    unrepresentable: "throw",
  }) as Node;
  return dialect === "claude" ? json : strictNode(json);
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
