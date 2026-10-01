import { wrongInput, type ResearchSource } from "../../ports.ts";

/** A reference typed by hand: no fetch, no file, no I/O. */
export const manualSource: ResearchSource = {
  kind: "manual",
  capture: async ({ input }) =>
    input.kind === "manual"
      ? { ok: true, captured: { capture: { kind: "manual" }, files: [], securityFindings: [] } }
      : wrongInput("manual", input),
};
