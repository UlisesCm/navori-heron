import { PRODUCT_CONTEXT_SECTIONS, type IntakeData } from "../core/contracts/index.ts";
import { MODE_LABELS } from "./render.ts";

/** Text output of `heron intake`; findings are appended by the caller with renderFindings. */
export function renderIntakeText(data: IntakeData): string {
  const state = data.dryRun ? "not written (dry run)" : data.written ? "written" : "unchanged";
  const open = data.conflicts.length;
  const pending = data.conflicts.filter((c) => !c.acknowledged).length;
  return [
    `Product context (${MODE_LABELS[data.mode]}, adapter ${data.adapter}${data.stage === null ? "" : `, stage ${data.stage.dir}`}):`,
    `- intake/product-context.json: ${state}`,
    `- intake/conflicts.json: ${state}`,
    `Sections: ${PRODUCT_CONTEXT_SECTIONS.map((section) => `${section} ${data.counts[section]}`).join(", ")}`,
    `Conflicts: ${open === 0 ? "none" : `${open} open, ${pending} not acknowledged`}`,
    ...data.conflicts.map(
      (c) =>
        `- ${c.id} ${c.kind} ${c.subject}: ${c.acknowledged ? "acknowledged" : "not acknowledged"}`,
    ),
    ...(data.dryRun ? ["Dry run: nothing was written to .heron/"] : []),
  ].join("\n");
}
