import { createDraftKit } from "../../draft-kit.ts";
import { detectSelected } from "../../inputs.ts";
import { extractRoleSections } from "../../markdown.ts";
import type { AdapterLoadResult, LoadRequest, ProductContextAdapter } from "../../ports.ts";

/** Sources, in selection order: each `--context` Markdown file, as `context` tier, through the same role
 * extraction as `context/md/*.md`. Always reference-only (DR22): there are no UX sources to read. */
function loadMarkdown(request: LoadRequest): AdapterLoadResult {
  const kit = createDraftKit(request);
  for (const path of request.selection?.inputs ?? []) {
    kit.markdown(path, "context", (doc) => extractRoleSections(doc, { source: "context", path }));
  }
  return kit.finish();
}

/** Explicit selection only (`heron init --adapter markdown --context <file>...`). */
export const markdownAdapter: ProductContextAdapter = {
  id: "markdown",
  detect: (request) => detectSelected("markdown", request),
  load: loadMarkdown,
};
