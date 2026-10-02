import { describe, expect, test } from "bun:test";
import { analysisInputKey, agentCacheKey } from "../../../src/agents/cache.ts";
import type { Sha256Hex } from "../../../src/core/contracts/index.ts";

const h = (c: string): Sha256Hex => c.repeat(64) as Sha256Hex;
const base = {
  task: "research-brief",
  template: { id: "visual-researcher/research-brief", version: 1, sha256: h("a") },
  schema: { dialect: "claude", sha256: h("b") },
  provider: "claude-code",
  model: null,
  packSha256: h("c"),
} as const;

describe("agent cache key", () => {
  test("derives the cache key from template, schema, provider, model and projected input", () => {
    // Covers: R19
    const key = agentCacheKey(base);
    expect(key).toMatch(/^[0-9a-f]{64}$/);
    expect(agentCacheKey({ ...base })).toBe(key);
    // Unrelated template fields do not matter: only id, version and sha256.
    expect(agentCacheKey({ ...base, template: { ...base.template } })).toBe(key);

    const changed = [
      { ...base, template: { ...base.template, version: 2 } },
      { ...base, template: { ...base.template, sha256: h("d") } },
      { ...base, schema: { ...base.schema, sha256: h("d") } },
      { ...base, schema: { ...base.schema, dialect: "openai-strict" } },
      { ...base, provider: "codex-cli" },
      { ...base, model: "opus" },
      { ...base, packSha256: h("d") },
    ] as const;
    const keys = changed.map((input) => agentCacheKey(input));
    for (const other of keys) expect(other).not.toBe(key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  test("keys each reference analysis by digest, template, schema, provider and model", () => {
    // Covers: R19
    const input = {
      referenceDigest: h("e"),
      template: base.template,
      schema: base.schema,
      provider: base.provider,
      model: null,
    } as const;
    const key = analysisInputKey(input);
    expect(analysisInputKey({ ...input })).toBe(key);
    expect(analysisInputKey({ ...input, referenceDigest: h("f") })).not.toBe(key);
    expect(analysisInputKey({ ...input, model: "opus" })).not.toBe(key);
    expect(analysisInputKey({ ...input, provider: "codex-cli" })).not.toBe(key);
    expect(analysisInputKey({ ...input, template: { ...base.template, version: 2 } })).not.toBe(
      key,
    );
  });
});
