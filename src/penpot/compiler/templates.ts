import type { Sha256Hex, TemplateRef } from "../../core/contracts/index.ts";
import { sha256Hex } from "../../core/store/hash.ts";
import inspect from "../../../templates/penpot/inspect@v1.penpot.js" with { type: "text" };
import reviewPage from "../../../templates/penpot/review-page@v1.penpot.js" with { type: "text" };

export type PenpotTemplate = {
  id: "inspect" | "review-page";
  version: number;
  text: string;
  sha256: Sha256Hex;
  ref: TemplateRef;
};

function template(id: PenpotTemplate["id"], text: string): PenpotTemplate {
  // Keep the transport escaping bound valid even after a template edit (DR11).
  // oxlint-disable-next-line no-control-regex -- trusted code must exclude C0 for the RPC byte bound
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(text)) {
    throw new Error(`Penpot template contains a forbidden control character: ${id}`);
  }
  const version = 1;
  const sha256 = sha256Hex(new TextEncoder().encode(text));
  return { id, version, text, sha256, ref: { id, version, sha256 } };
}

/** Frozen after the live probe in T12; subsequent changes require a new version. */
export const PENPOT_TEMPLATES: readonly PenpotTemplate[] = [
  template("inspect", inspect),
  template("review-page", reviewPage),
];

export function penpotTemplate(id: PenpotTemplate["id"]): PenpotTemplate {
  const found = PENPOT_TEMPLATES.find((entry) => entry.id === id);
  if (found === undefined) throw new Error(`unknown Penpot template: ${id}`);
  return found;
}
