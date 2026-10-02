import type {
  AgentProviderId,
  AgentTaskId,
  Sha256Hex,
  TemplateRef,
} from "../core/contracts/index.ts";
import { canonicalJson } from "../core/contracts/canonical-json.ts";
import { sha256Hex } from "../core/store/hash.ts";
import type { SchemaDialect } from "./json-schema.ts";

type SchemaRef = { dialect: SchemaDialect; sha256: Sha256Hex };

const digest = (value: unknown): Sha256Hex =>
  sha256Hex(new TextEncoder().encode(canonicalJson(value)));

/** Only the identifying fields of a template: its text is already covered by `sha256` (DR39). */
const templateKey = (template: TemplateRef): TemplateRef => ({
  id: template.id,
  version: template.version,
  sha256: template.sha256,
});

/**
 * Result-cache key of one task run (DR39): it changes if and only if the template (id, version, bytes), the output
 * schema, the provider, the requested model or the projected input (`pack.sha256`) change. Pure.
 */
export function agentCacheKey(input: {
  task: AgentTaskId;
  template: TemplateRef;
  schema: SchemaRef;
  provider: AgentProviderId;
  model: string | null;
  packSha256: Sha256Hex;
}): Sha256Hex {
  return digest({
    task: input.task,
    template: templateKey(input.template),
    schema: { dialect: input.schema.dialect, sha256: input.schema.sha256 },
    provider: input.provider,
    model: input.model,
    pack: input.packSha256,
  });
}

/** Per-reference freshness key of `research-analyze` (DR39): same inputs as the cache key, with the reference digest. */
export function analysisInputKey(input: {
  referenceDigest: Sha256Hex;
  template: TemplateRef;
  schema: SchemaRef;
  provider: AgentProviderId;
  model: string | null;
}): Sha256Hex {
  return digest({
    referenceDigest: input.referenceDigest,
    template: templateKey(input.template),
    schema: { dialect: input.schema.dialect, sha256: input.schema.sha256 },
    provider: input.provider,
    model: input.model,
  });
}
