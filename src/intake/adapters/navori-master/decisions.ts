import type { Finding, RelativeArtifactPath } from "../../../core/contracts/index.ts";
import { candidateSink } from "../../candidates.ts";
import { blocksOf, sectionAnchor, sectionBody, type MarkdownDoc } from "../../markdown.ts";
import type { Candidate } from "../../ports.ts";
import { normalizeText, stripInline } from "../../text.ts";

// Field labels of DECISIONS.md in both harness languages (navori-harness markers.ts).
const LABELS = {
  question: ["pregunta", "question"],
  chosen: ["elegida", "chosen"],
  discarded: ["descartadas", "discarded"],
  date: ["fecha", "date"],
} as const;
type Field = keyof typeof LABELS;

const DECISION_HEADING = /^(D\d+)(?:\s|$|[:—–-])/;
const FIELD_LINE = /^([^:]+):\s*(.*)$/;

const fieldOf = (label: string): Field | null => {
  const normalized = normalizeText(label);
  return (
    (Object.keys(LABELS) as Field[]).find((f) => LABELS[f].some((l) => l === normalized)) ?? null
  );
};

/** Reads `## D<n>` sections with `Pregunta:`/`Question:`, `Elegida:`/`Chosen:`, `Descartadas:`/`Discarded:`
 * (split on ";") and `Fecha:`/`Date:`. `Sin decisiones`/`No decisions` and any other prose yield nothing.
 * A repeated `D<n>` keeps the first and reports CONTEXT_DUPLICATE_ID. Locator: `§D<n>`. */
export function parseDecisions(
  doc: MarkdownDoc,
  path: RelativeArtifactPath,
): { candidates: Candidate[]; ids: Set<string>; findings: Finding[] } {
  const sink = candidateSink({ source: "DECISIONS.md", path });
  const ids = new Set<string>();
  const repeated = new Set<string>();
  for (const section of doc.sections) {
    const id = DECISION_HEADING.exec(stripInline(section.heading).trim())?.[1];
    if (id === undefined) continue;
    if (ids.has(id)) {
      repeated.add(id);
      continue;
    }
    ids.add(id);
    const fields: Partial<Record<Field, string>> = {};
    for (const block of blocksOf(sectionBody(doc, section))) {
      if (block.kind !== "item") continue;
      const match = FIELD_LINE.exec(stripInline(block.text).trim());
      const field = match === null ? null : fieldOf(match[1] ?? "");
      if (field !== null && fields[field] === undefined) fields[field] = (match?.[2] ?? "").trim();
    }
    const text = (field: Field): string | null => {
      const value = fields[field];
      return value === undefined || value === "" ? null : value;
    };
    sink.add(
      "decisions",
      id,
      {
        id,
        question: text("question"),
        chosen: text("chosen"),
        discarded: (fields.discarded ?? "")
          .split(";")
          .map((part) => part.trim())
          .filter((part) => part !== ""),
        date: text("date"),
      },
      sectionAnchor(section),
    );
  }
  const findings: Finding[] = [...repeated].map((id) => ({
    code: "CONTEXT_DUPLICATE_ID",
    severity: "warning",
    message: `${id} appears more than once in ${path}; the first one is used.`,
    paths: [path],
    issues: [],
  }));
  return { candidates: sink.items, ids, findings };
}
