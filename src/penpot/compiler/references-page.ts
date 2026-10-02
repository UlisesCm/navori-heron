import type { HeronMode, ResearchReference } from "../../core/contracts/index.ts";
import type { PenpotCopy } from "./copy.ts";
import {
  activeReferences,
  contentSha256,
  REFERENCES_PAGE_ID,
  referencesSourceSha256,
} from "./ids.ts";
import { makeBoard, makeText, type PenpotNode, type ReviewPage } from "./nodes.ts";
import { CHROME } from "./proposal-page.ts";
import { renderScript, reviewScriptData } from "./script.ts";
import type { PenpotTemplate } from "./templates.ts";

export const REFERENCES_LIMITS = { maxCards: 48, maxItems: 5, maxChars: 200, columns: 4 } as const;
const RESERVED_TARGET = "00000000-0000-0000-0000-000000000000";
/** Cap data by Unicode code points, including the ellipsis in the limit. */
function capped(text: string): string {
  const points = Array.from(text);
  return points.length <= REFERENCES_LIMITS.maxChars
    ? text
    : `${points.slice(0, REFERENCES_LIMITS.maxChars - 1).join("")}…`;
}
function referenceCard(reference: ResearchReference, copy: PenpotCopy): PenpotNode {
  const key = `references/${reference.id}`;
  const children: PenpotNode[] = [];
  const text = (suffix: string, value: string): void => {
    children.push(makeText(`${key}/${suffix}`, capped(value), { width: 464, color: CHROME.text }));
  };
  const field = (suffix: string, label: string, values: readonly string[]): void => {
    text(`${suffix}/label`, label);
    values
      .slice(0, REFERENCES_LIMITS.maxItems)
      .forEach((value, index) => text(`${suffix}/${index}`, value));
  };
  text("id", reference.id);
  field("source", copy.source, [reference.source]);
  field("origin", copy.origin, [reference.origin]);
  field("reason", copy.reason, [reference.reason]);
  field("studies", copy.studies, reference.studies);
  field("doNotCopy", copy.doNotCopy, reference.doNotCopy);
  field("influences", copy.influences, reference.influences);
  if (reference.crops.length)
    field(
      "crops",
      copy.crops,
      reference.crops.map(
        (crop) => `${crop.x},${crop.y} ${crop.width}×${crop.height} · ${crop.note}`,
      ),
    );
  if (reference.capture.kind === "image") text("image", copy.imageNotShown);
  return makeBoard(key, children, {
    name: reference.id,
    width: 496,
    height: null,
    fill: CHROME.panel,
    layout: { kind: "flex", dir: "column", gap: 8, padding: 16, wrap: false },
  });
}

/** Select the longest active prefix that fits the exact writing payload, reserving a UUID target. */
export function buildReferencesPage(
  references: readonly ResearchReference[],
  context: { mode: HeronMode; copy: PenpotCopy; template: PenpotTemplate },
): ReviewPage {
  const active = activeReferences(references);
  const { mode, copy, template } = context;
  const sourceSha256 = referencesSourceSha256(active);
  const name = `Heron · ${copy.references}${mode === "reference-only" ? ` · ${copy.referenceOnly}` : ""}`;
  const cards = active
    .slice(0, REFERENCES_LIMITS.maxCards)
    .map((reference) => referenceCard(reference, copy));
  const candidate = (count: number): ReviewPage => {
    const nodes: PenpotNode[] = [
      makeBoard(
        "header",
        [
          makeText("header/title", copy.references, { width: 2068, fontSize: 32 }),
          makeText("header/mode", mode === "reference-only" ? copy.referenceOnly : mode, {
            width: 2068,
          }),
        ],
        {
          width: 2100,
          height: null,
          fill: CHROME.band,
          layout: { kind: "flex", dir: "column", gap: 12, padding: 16, wrap: false },
        },
      ),
      makeBoard("references", cards.slice(0, count), {
        y: 180,
        width: 2100,
        height: null,
        layout: { kind: "grid", columns: REFERENCES_LIMITS.columns, gap: 16, padding: 16 },
      }),
    ];
    const base = {
      template: template.ref,
      heronId: REFERENCES_PAGE_ID,
      name,
      mode,
      sourceSha256,
      nodes,
    };
    const omitted = active.slice(count).map((reference) => reference.id);
    return {
      ...base,
      kind: "references-page",
      contentSha256: contentSha256(base),
      issues: omitted.length
        ? [
            {
              code: "PENPOT_REFERENCES_TRUNCATED",
              pointer: null,
              message: `Showing ${count} references; omitted: ${omitted.join(", ")}.`,
            },
          ]
        : [],
    };
  };
  for (let count = cards.length; count > 0; count -= 1) {
    const page = candidate(count);
    if (renderScript(template, reviewScriptData(page, RESERVED_TARGET)).ok) return page;
  }
  // Return even an oversized header: the final renderer rejects it before any write (DR11).
  return candidate(0);
}
