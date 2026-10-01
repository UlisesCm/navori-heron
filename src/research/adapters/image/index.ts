import { captureImageFile } from "../../image-file.ts";
import { wrongInput, type ResearchSource } from "../../ports.ts";

/** A local image or screenshot, sanitized to WebP under research/assets/ (D15). */
export const imageSource: ResearchSource = {
  kind: "image",
  capture: async ({ input, services, limits }) => {
    if (input.kind !== "image") return wrongInput("image", input);
    const result = await captureImageFile({
      services,
      file: input.file,
      limits,
      assetsDir: "research/assets",
    });
    if (!result.ok) return result;
    const { image, file, record, securityFindings } = result.capture;
    return {
      ok: true,
      captured: {
        capture: { kind: "image", method: input.method, file: record, image },
        files: [file],
        securityFindings,
      },
    };
  },
};
