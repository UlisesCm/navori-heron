import type { Finding, RelativeArtifactPath } from "../core/contracts/index.ts";
import { candidateSink } from "./candidates.ts";
import {
  blocksOf,
  isNoise,
  sectionAnchor,
  sectionBody,
  type MarkdownDoc,
  type MarkdownSection,
} from "./markdown.ts";
import type { Candidate } from "./ports.ts";
import { normalizeText, stripInline } from "./text.ts";

/** The `<!-- ux-kind: … -->` sections of UX.md that carry elements (the rest are structure, owned by ux.json). */
export const UX_MARKDOWN_KINDS = [
  "global-states",
  "open-questions",
  "out-of-scope",
  "heron-handoff",
] as const;

const HANDOFF: Readonly<
  Record<string, "heron-must-preserve" | "heron-may-improve" | "heron-owns">
> = {
  "heron must preserve": "heron-must-preserve",
  "heron may improve": "heron-may-improve",
  "heron owns": "heron-owns",
};
const BACKTICKED = /`([^`]+)`/g;

/** Reads UX.md by `ux-kind` marker, not by heading, so it works in either harness language:
 * `global-states` -> states (`global: true`; backticked tokens, else bullets), `open-questions` ->
 * unresolvedQuestions, `out-of-scope` -> constraints and `heron-handoff` (its `### Heron MUST preserve`,
 * `MAY improve` and `owns` subsections) -> constraints of that kind. `None`/`Ninguna` bodies yield nothing. */
export function extractUxMarkdown(
  doc: MarkdownDoc,
  path: RelativeArtifactPath,
): { candidates: Candidate[]; findings: Finding[] } {
  const sink = candidateSink({ source: "UX.md", path });
  const entries = (section: MarkdownSection): string[] =>
    blocksOf(sectionBody(doc, section))
      .filter((block) => block.kind !== "table" && !isNoise(block.text))
      .map((block) => (block.kind === "table" ? "" : stripInline(block.text).trim()));
  for (const section of doc.sections) {
    const locator = sectionAnchor(section);
    switch (section.uxKind) {
      case "global-states": {
        const body = sectionBody(doc, section).join("\n");
        const tokens = [...body.matchAll(BACKTICKED)].map((m) => (m[1] ?? "").trim());
        for (const name of tokens.length > 0 ? tokens : entries(section)) {
          if (name !== "") {
            sink.add("states", normalizeText(name), { name, global: true, screens: [] }, locator);
          }
        }
        break;
      }
      case "open-questions":
        for (const text of entries(section)) {
          sink.add("unresolvedQuestions", normalizeText(text), { text }, locator);
        }
        break;
      case "out-of-scope":
        for (const text of entries(section)) {
          sink.add(
            "constraints",
            normalizeText(text),
            { kind: "out-of-scope", id: null, subject: null, text },
            locator,
          );
        }
        break;
      case "heron-handoff":
        for (const child of doc.sections) {
          const kind = HANDOFF[normalizeText(child.heading)];
          if (kind === undefined || child.startLine <= section.startLine) continue;
          if (child.startLine > section.endLine) continue;
          for (const text of entries(child)) {
            sink.add(
              "constraints",
              `${kind}/${normalizeText(text)}`,
              { kind, id: null, subject: null, text },
              sectionAnchor(child),
            );
          }
        }
        break;
      default:
        break;
    }
  }
  return { candidates: sink.items, findings: [] };
}
