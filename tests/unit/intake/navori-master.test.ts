// Covers: R2
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseDecisions } from "../../../src/intake/adapters/navori-master/decisions.ts";
import { parseMarkdown } from "../../../src/intake/markdown.ts";
import { extractUxMarkdown, UX_MARKDOWN_KINDS } from "../../../src/intake/ux-markdown.ts";

const STAGE = join(
  import.meta.dir,
  "..",
  "..",
  "..",
  "fixtures",
  "membership-product",
  "specs",
  "_master",
  "01-mvp",
);
const read = (file: string): string => readFileSync(join(STAGE, file), "utf8");
const DECISIONS_PATH = "specs/_master/01-mvp/DECISIONS.md";
const UX_PATH = "specs/_master/01-mvp/UX.md";

const summary = (candidates: { section: string; key: string }[]): string[] =>
  candidates.map((c) => `${c.section}:${c.key}`);

describe("navori-master Markdown readers", () => {
  test("parses decisions and UX.md ux-kind sections", () => {
    // DECISIONS.md, English labels (the fixture)
    const decisions = parseDecisions(parseMarkdown(read("DECISIONS.md")), DECISIONS_PATH);
    expect([...decisions.ids]).toEqual(["D1", "D2"]);
    expect(decisions.findings).toEqual([]);
    expect(decisions.candidates[0]).toEqual({
      section: "decisions",
      key: "D1",
      value: {
        id: "D1",
        question: "Which surface comes first?",
        chosen: "Mobile app for members",
        discarded: ["Web app for members", "Dashboard first"],
        date: "2026-09-01",
      },
      ref: { source: "DECISIONS.md", path: DECISIONS_PATH, locator: "§D1" },
      order: 0,
    });

    // Spanish labels, bold labels, a repeated id and a decision without fields
    const spanish = parseDecisions(
      parseMarkdown(
        [
          "# Decisiones",
          "## D1",
          "- Pregunta: ¿Cuál primero?",
          "- Elegida: Móvil",
          "- Descartadas: Web; Panel",
          "- Fecha: 2026-09-01",
          "## D2",
          "## D1",
          "- **Pregunta:** otra",
        ].join("\n"),
      ),
      DECISIONS_PATH,
    );
    expect(summary(spanish.candidates)).toEqual(["decisions:D1", "decisions:D2"]);
    expect(spanish.candidates[0]?.value).toMatchObject({
      question: "¿Cuál primero?",
      discarded: ["Web", "Panel"],
    });
    expect(spanish.candidates[1]?.value).toEqual({
      id: "D2",
      question: null,
      chosen: null,
      discarded: [],
      date: null,
    });
    expect(spanish.findings.map((f) => f.code)).toEqual(["CONTEXT_DUPLICATE_ID"]);

    // "No decisions" / "Sin decisiones" and non-D headings contribute nothing
    for (const body of ["No decisions", "Sin decisiones", "# Title\n\n## Notes\n- Question: x"]) {
      expect(parseDecisions(parseMarkdown(body), DECISIONS_PATH).candidates).toEqual([]);
    }

    // UX.md: only the four ux-kind sections feed elements
    expect(UX_MARKDOWN_KINDS).toEqual([
      "global-states",
      "open-questions",
      "out-of-scope",
      "heron-handoff",
    ]);
    const ux = extractUxMarkdown(parseMarkdown(read("UX.md")), UX_PATH);
    expect(ux.findings).toEqual([]);
    expect(summary(ux.candidates)).toEqual([
      "states:loading",
      "states:empty",
      "states:error",
      "states:unauthorized",
      "states:membership-expired",
      "unresolvedQuestions:should a member see expired benefits in the catalog?",
      "constraints:corporate onboarding",
      "constraints:review system",
      "constraints:heron-must-preserve/business rules, roles, permissions and requirements",
      "constraints:heron-may-improve/screen grouping, navigation and pattern reuse",
      "constraints:heron-owns/layout, visual hierarchy, typography and the design system",
    ]);
    expect(ux.candidates[0]).toMatchObject({
      value: { name: "loading", global: true, screens: [] },
      ref: { source: "UX.md", path: UX_PATH, locator: "§Global states" },
    });
    expect(ux.candidates.at(-1)?.ref.locator).toBe("§Heron owns");
    expect(ux.candidates.find((c) => c.key === "corporate onboarding")?.value).toEqual({
      kind: "out-of-scope",
      id: null,
      subject: null,
      text: "Corporate onboarding.",
    });

    // markers drive the extraction, not headings: Spanish headings, bullet states, "Ninguna" bodies
    const spanishUx = extractUxMarkdown(
      parseMarkdown(
        [
          "# Contrato",
          "## Estados globales",
          "<!-- ux-kind: global-states -->",
          "- cargando",
          "- vacío",
          "## Preguntas abiertas UX",
          "<!-- ux-kind: open-questions -->",
          "Ninguna",
          "## Fuera de alcance",
          "<!-- ux-kind: out-of-scope -->",
          "None",
          "## Superficies",
          "<!-- ux-kind: surfaces -->",
          "- MOBILE: app",
          "## Sin marcador",
          "- ignorado",
        ].join("\n"),
      ),
      UX_PATH,
    );
    expect(summary(spanishUx.candidates)).toEqual(["states:cargando", "states:vacío"]);
  });
});
