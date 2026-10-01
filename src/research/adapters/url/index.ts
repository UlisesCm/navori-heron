import { fetchExternalText, PAGE_MEDIA_TYPES } from "../../external-text.ts";
import { wrongInput, type ResearchSource } from "../../ports.ts";

/** A web page stored as untrusted text (DR19), fetched only through the injected SSRF-safe Fetcher. */
export const urlSource: ResearchSource = {
  kind: "url",
  capture: async ({ input, services, limits }) => {
    if (input.kind !== "url") return wrongInput("url", input);
    const result = await fetchExternalText({
      services,
      url: input.url,
      allowLocal: input.allowLocal,
      accept: PAGE_MEDIA_TYPES,
      maxBytes: limits.maxTextBytes,
      extension: "by-media-type",
    });
    if (!result.ok) return result;
    const { capture } = result;
    return {
      ok: true,
      captured: {
        capture: { kind: "url", fetch: capture.fetch, content: capture.content },
        files: [capture.file],
        securityFindings: capture.securityFindings,
      },
    };
  },
};
