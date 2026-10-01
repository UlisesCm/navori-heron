import type { Sha256Hex, TemplateRef } from "../core/contracts/index.ts";
import { sha256Hex } from "../core/store/hash.ts";
import directionPropose from "../../prompts/design-director/direction-propose@v1.md" with { type: "text" };
import repair from "../../prompts/shared/repair@v1.md" with { type: "text" };
import probe from "../../prompts/shared/probe@v1.md" with { type: "text" };
import researchAnalyze from "../../prompts/visual-researcher/research-analyze@v1.md" with { type: "text" };
import researchBrief from "../../prompts/visual-researcher/research-brief@v1.md" with { type: "text" };

/** A published, immutable template: `prompts/<persona>/<task>@v<version>.md`. Changing the copy means a new `@v<n+1>`. */
export type PromptTemplate = {
  /** "<persona>/<task>" */
  id: string;
  version: number;
  text: string;
  /** sha256 of the template bytes (UTF-8). */
  sha256: Sha256Hex;
  ref: TemplateRef;
};

function template(id: string, version: number, text: string): PromptTemplate {
  const sha256 = sha256Hex(new TextEncoder().encode(text));
  return { id, version, text, sha256, ref: { id, version, sha256 } };
}

/** Static text only (DR41): no dates, run ids or interpolated data, so the prefix stays cacheable. */
export const PROMPT_TEMPLATES: readonly PromptTemplate[] = [
  template("visual-researcher/research-brief", 1, researchBrief),
  template("visual-researcher/research-analyze", 1, researchAnalyze),
  template("design-director/direction-propose", 1, directionPropose),
  template("shared/repair", 1, repair),
  template("shared/probe", 1, probe),
];

/** The registered template for `id` (one entry per id: a `@v2` replaces its `@v1` entry). Throws on an unknown id
 * (programming error: ids are literals in `AGENT_TASKS`). */
export function templateFor(id: string): PromptTemplate {
  const found = PROMPT_TEMPLATES.find((entry) => entry.id === id);
  if (found === undefined) throw new Error(`unknown prompt template: ${id}`);
  return found;
}

/** Template of repair attempts 2 and 3 (DR10). */
export const REPAIR_TEMPLATE: PromptTemplate = templateFor("shared/repair");
