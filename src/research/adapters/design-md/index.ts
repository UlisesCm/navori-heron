import {
  DESIGN_MD_MEDIA_TYPES,
  fetchExternalText,
  readExternalTextFile,
} from "../../external-text.ts";
import { wrongInput, type CaptureResult, type ResearchSource } from "../../ports.ts";

/** A DESIGN.md from a local file or an https URL, always stored as untrusted `.md` (DR19). */
export const designMdSource: ResearchSource = {
  kind: "design-md",
  capture: async ({ input, services, limits }): Promise<CaptureResult> => {
    if (input.kind !== "design-md") return wrongInput("design-md", input);
    const result =
      "file" in input.from
        ? readExternalTextFile({ services, file: input.from.file, maxBytes: limits.maxTextBytes })
        : await fetchExternalText({
            services,
            url: input.from.url,
            allowLocal: input.from.allowLocal,
            accept: DESIGN_MD_MEDIA_TYPES,
            maxBytes: limits.maxTextBytes,
            extension: "md",
          });
    if (!result.ok) return result;
    const { content, file, fetch, input: record, securityFindings } = result.capture;
    return {
      ok: true,
      captured: {
        capture: { kind: "design-md", fetch, file: record, content },
        files: [file],
        securityFindings,
      },
    };
  },
};
