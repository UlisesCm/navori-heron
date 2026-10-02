import { canonicalJson } from "../../core/contracts/index.ts";
import type { PenpotNode, ReviewPage } from "./nodes.ts";
import type { PenpotTemplate } from "./templates.ts";

export const MAX_SCRIPT_BYTES = 32_768;

/** A JS string literal containing canonical JSON, never executable user input. */
export function safeJsonLiteral(data: unknown): string {
  return JSON.stringify(canonicalJson(data))
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029");
}

/** The only producer of code sent to Penpot. Measures the entire UTF-8 script. */
export function renderScript(
  template: PenpotTemplate,
  data: unknown,
): { ok: true; code: string } | { ok: false; bytes: number } {
  const code = `const HERON = JSON.parse(${safeJsonLiteral(data)});\n${template.text}`;
  const bytes = new TextEncoder().encode(code).byteLength;
  return bytes <= MAX_SCRIPT_BYTES ? { ok: true, code } : { ok: false, bytes };
}

export type ReviewScriptData = {
  page: Pick<
    ReviewPage,
    "heronId" | "kind" | "name" | "mode" | "sourceSha256" | "contentSha256"
  > & { template: string };
  targetPageId: string | null;
  nodes: PenpotNode[];
};

/** Budgeting and session.apply must serialize exactly the same payload. */
export function reviewScriptData(page: ReviewPage, targetPageId: string | null): ReviewScriptData {
  return {
    page: {
      heronId: page.heronId,
      kind: page.kind,
      name: page.name,
      mode: page.mode,
      sourceSha256: page.sourceSha256,
      contentSha256: page.contentSha256,
      template: `${page.template.id}@v${page.template.version}`,
    },
    targetPageId,
    nodes: page.nodes,
  };
}
