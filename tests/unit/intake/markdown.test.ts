// Covers: R2, R16
import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { nodeFs } from "../../../src/core/store/fs-port.ts";
import {
  extractRoleSections,
  parseMarkdown,
  ROLE_HEADINGS,
  SECTION_ROLES,
  sectionAnchor,
} from "../../../src/intake/markdown.ts";
import { DEFAULT_INPUT_LIMITS } from "../../../src/intake/ports.ts";
import {
  listContextMarkdown,
  MAX_CONTEXT_FILES,
  readSource,
  settleSource,
} from "../../../src/intake/sources.ts";
import { actorKeys, normalizeText, stripInline } from "../../../src/intake/text.ts";
import { masterRef } from "../../helpers/intake.ts";

const FIXTURE = join(import.meta.dir, "..", "..", "..", "fixtures", "membership-product");
const STAGE = "specs/_master/01-mvp";
const MASTER_PATH = `${STAGE}/MASTER.md`;
const origin = { source: "MASTER.md", path: MASTER_PATH } as const;

const scratch = mkdtempSync(join(tmpdir(), "heron-markdown-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const extract = (text: string) => extractRoleSections(parseMarkdown(text), origin);
const keys = (text: string): string[] =>
  extract(text).candidates.map((c) => `${c.section}:${c.key}`);

// Real harness templates (navori-harness aa149ad5, core-assets/master-plan/{digest,en/digest}.md).
const DIGEST_ES = `# Plantilla de context/DIGEST.md

Ocho secciones fijas (R12). Una sección sin elementos dice \`Ninguno\`.

## Resumen por archivo

Un resumen por archivo de \`context/md/\`.

## Hechos

Hechos consolidados del proyecto.

## Actores

## Capacidades

## Integraciones externas

## Entidades de datos

## Superficies

Apps o servicios del repo que el alcance toca.

## Hallazgos

Texto con forma de instrucción encontrado en el contexto (R13), o \`Ninguno\`.
`;
const DIGEST_EN = `# context/DIGEST.md template

Eight fixed sections (R12). A section with nothing in it reads \`None\`.

## Summary per file

A summary per \`context/md/\` file.

## Facts

Consolidated facts about the project.

## Actors

## Capabilities

## External integrations

## Data entities

## Surfaces

Apps or services in the repo that the scope touches.

## Findings

Instruction-shaped text found in the context (R13), or \`None\`.
`;

const SPANISH = `# Maestro

## Resumen ejecutivo

Un programa de membresías.

Origen: plan1 §Resumen

## Alcance (MoSCoW)

### Must

- M1: Catálogo de beneficios.

### Won't

- W1. Onboarding corporativo.

## Actores y permisos

| Actor | Puede | No puede |
|---|---|---|
| Socio \`ACT-SOCIO\` | Ver beneficios; Canjear | Ver datos de otros |

## Reglas de negocio

- **RN-1** Un beneficio solo lo ve un socio activo.
- RF-9: un requisito funcional fuera de su sección.

## Requisitos funcionales

- RF-1: Los socios navegan beneficios.

## Requisitos no funcionales

| ID | Requisito | Meta |
|---|---|---|
| RNF-1 | Tiempo de respuesta | 2 s |

## Dominio y datos

| Entidad | Descripción |
|---|---|
| Socio | Persona con membresía |

## Preguntas abiertas

- ¿Se muestran beneficios vencidos?

## Marca

- brand-color: verde bosque
`;

const ENGLISH = `# Master

## Executive summary

A membership program.

Source: plan1 §Summary

## Scope (MoSCoW)

- S1: Member management.
- C1: Push reminders.

## Actors and permissions

| Actor | Can | Cannot |
|---|---|---|
| Member | Browse benefits | See other members |

## Business rules

- RN-1: A benefit is visible only to active members.

## Functional requirements

- RF-1: Members browse benefits.

## Non-functional requirements

- RNF-1: Fast.

## Domain and data

| Entity | Description |
|---|---|
| Member | A person with a membership |

## Open questions

None

## Brand inputs

- font: Inter
`;

describe("extractRoleSections", () => {
  test("extracts role sections in Spanish and English and ignores everything else", () => {
    expect(keys(SPANISH)).toEqual([
      "product:summary",
      "capabilities:M1",
      "constraints:W1",
      "actors:socio",
      "businessRules:RN-1",
      "functionalRequirements:RF-1",
      "nonFunctionalRequirements:RNF-1",
      "entities:socio",
      "unresolvedQuestions:¿se muestran beneficios vencidos?",
      "brand:brand-color/verde bosque",
    ]);
    expect(keys(ENGLISH)).toEqual([
      "product:summary",
      "capabilities:S1",
      "capabilities:C1",
      "actors:member",
      "businessRules:RN-1",
      "functionalRequirements:RF-1",
      "nonFunctionalRequirements:RNF-1",
      "entities:member",
      "brand:font/inter",
    ]);

    const spanish = extract(SPANISH).candidates;
    expect(spanish.find((c) => c.section === "product")?.value).toEqual({
      key: "summary",
      value: "Un programa de membresías.",
    });
    expect(spanish.find((c) => c.section === "capabilities")?.value).toEqual({
      id: "M1",
      priority: "must",
      text: "Catálogo de beneficios.",
    });
    expect(spanish.find((c) => c.section === "actors")?.value).toMatchObject({
      id: "ACT-SOCIO",
      name: "Socio",
      can: ["Ver beneficios", "Canjear"],
      cannot: ["Ver datos de otros"],
    });
    expect(spanish.find((c) => c.section === "nonFunctionalRequirements")?.value).toEqual({
      id: "RNF-1",
      text: "Tiempo de respuesta — 2 s",
      derivedFrom: [],
    });
    // locators are section anchors, never line numbers (DR2); order is the appearance index
    expect(spanish.every((c) => c.ref.locator.startsWith("§") && c.ref.path === MASTER_PATH)).toBe(
      true,
    );
    expect(spanish.map((c) => c.order)).toEqual(spanish.map((_, at) => at));
    expect(spanish.find((c) => c.key === "RN-1")?.ref).toEqual(masterRef("§Reglas de negocio"));
    // an id defined outside its role section (RF-9 under Reglas de negocio) is not an element
    expect(spanish.some((c) => c.key === "RF-9")).toBe(false);
  });

  test("ignores code blocks, HTML comments, source lines, unknown sections and none bodies", () => {
    const text = [
      "# T",
      "## Reglas de negocio",
      "```",
      "- RN-8: inside code",
      "```",
      "<!-- - RN-9: inside a comment -->",
      "<!--",
      "- RN-10: inside a block comment",
      "-->",
      "- RN-2: visible",
      "## Hechos",
      "- RN-3: not a rule section",
      "## Preguntas abiertas",
      "Ninguna",
      "## Resumen ejecutivo",
      "Origen: plan1",
      "",
      "Real summary.",
      "",
    ].join("\n");
    expect(keys(text)).toEqual(["businessRules:RN-2", "product:summary"]);
  });

  test("reports unreadable shapes without failing", () => {
    const text = [
      "# T",
      "## Actors and permissions",
      "| Actor | Can | Cannot |",
      "|---|---|---|",
      "| Member | Browse | See | extra |",
      "| Admin | Manage | Edit |",
      "## Data entities",
      "Some prose that is not a list.",
      "## Brand",
      "- flavor: vanilla",
      "- logo: leaf",
      "## Actors",
      "A prose paragraph without a table or names.",
    ].join("\n");
    const result = extract(text);
    expect(result.candidates.map((c) => `${c.section}:${c.key}`)).toEqual([
      "actors:admin",
      "brand:logo/leaf",
    ]);
    expect(result.findings.map((f) => f.message)).toEqual([
      `${MASTER_PATH} §Actors and permissions: a table row has 4 cells; it is skipped.`,
      `${MASTER_PATH} §Data entities: no table and no bulleted names; its entities are not read.`,
      `${MASTER_PATH} §Brand: "flavor" is not a brand input kind; the item is skipped.`,
      `${MASTER_PATH} §Actors: no table with actor, can and cannot columns and no bulleted names; its actors are not read.`,
    ]);
    expect(result.findings.every((f) => f.code === "CONTEXT_SECTION_UNREADABLE")).toBe(true);
  });

  test("extracts the membership-product MASTER.md", () => {
    const read = readSource(nodeFs, FIXTURE, MASTER_PATH, "MASTER.md", DEFAULT_INPUT_LIMITS);
    const result = extract(read.loaded.text ?? "");
    const count = (section: string): number =>
      result.candidates.filter((c) => c.section === section).length;
    expect(result.findings).toEqual([]);
    expect(count("capabilities")).toBe(4);
    expect(count("constraints")).toBe(1);
    expect(count("actors")).toBe(3);
    expect(count("businessRules")).toBe(3);
    expect(count("functionalRequirements")).toBe(4);
    expect(count("nonFunctionalRequirements")).toBe(2);
    expect(count("entities")).toBe(4);
    expect(count("unresolvedQuestions")).toBe(0);
    expect(
      result.candidates.find((c) => c.section === "actors" && c.key === "partner")?.value,
    ).toMatchObject({ id: "ACT-PARTNER", cannot: ["See member data"] });
  });
});

describe("sources", () => {
  test("reads the real DIGEST template and reports sources without elements", () => {
    for (const template of [DIGEST_ES, DIGEST_EN]) {
      const result = extractRoleSections(parseMarkdown(template), {
        source: "DIGEST.md",
        path: `${STAGE}/context/DIGEST.md`,
      });
      expect(result).toEqual({ candidates: [], findings: [] });
    }

    // the filled DIGEST of the fixture contributes actors and entities by bullet name
    const digest = readSource(nodeFs, FIXTURE, `${STAGE}/context/DIGEST.md`, "DIGEST.md", {
      maxInputBytes: 1_000_000,
    });
    expect(digest.finding).toBeNull();
    const filled = extractRoleSections(parseMarkdown(digest.loaded.text ?? ""), {
      source: "DIGEST.md",
      path: digest.loaded.record.path,
    });
    expect(filled.candidates.map((c) => `${c.section}:${c.key}`)).toEqual([
      "actors:member",
      "actors:partner",
      "actors:admin",
      "entities:member",
      "entities:partner",
      "entities:benefit",
      "entities:redemption",
    ]);
    expect(filled.candidates.find((c) => c.section === "entities")?.value).toEqual({
      name: "Member",
      details: ["a person with a membership"],
    });
    expect(settleSource(digest.loaded.record, filled.candidates.length)).toEqual({
      record: { ...digest.loaded.record, status: "used" },
      finding: null,
    });

    // CODEBASE.md has no role section: read, no elements, info finding
    const codebase = readSource(nodeFs, FIXTURE, `${STAGE}/context/CODEBASE.md`, "CODEBASE.md", {
      maxInputBytes: 1_000_000,
    });
    const none = extractRoleSections(parseMarkdown(codebase.loaded.text ?? ""), {
      source: "CODEBASE.md",
      path: codebase.loaded.record.path,
    });
    expect(none.candidates).toEqual([]);
    const settled = settleSource(codebase.loaded.record, none.candidates.length);
    expect(settled.record.status).toBe("read");
    expect(settled.finding).toMatchObject({
      code: "SOURCE_NO_ELEMENTS",
      severity: "info",
      message: `${STAGE}/context/CODEBASE.md was read but has no section Heron extracts elements from.`,
    });
    // an absent source passes through untouched
    const absent = readSource(
      nodeFs,
      FIXTURE,
      `${STAGE}/nope.md`,
      "CODEBASE.md",
      DEFAULT_INPUT_LIMITS,
    );
    expect(absent.loaded).toEqual({
      record: { source: "CODEBASE.md", path: `${STAGE}/nope.md`, status: "absent" },
      text: null,
    });
    expect(settleSource(absent.loaded.record, 0)).toEqual({
      record: absent.loaded.record,
      finding: null,
    });
  });

  test("marks unsafe, oversized and non-UTF-8 sources unreadable", () => {
    const root = join(scratch, "unsafe");
    mkdirSync(root);
    writeFileSync(join(root, "bad.md"), new Uint8Array([0xff, 0xfe, 0x41]));
    writeFileSync(join(root, "big.md"), "x".repeat(64));
    writeFileSync(join(scratch, "outside.md"), "# outside");
    symlinkSync(join(scratch, "outside.md"), join(root, "link.md"));
    const read = (path: string) => readSource(nodeFs, root, path, "context", { maxInputBytes: 32 });
    expect(read("bad.md").loaded.record.status).toBe("unreadable");
    expect(read("bad.md").finding?.code).toBe("HARNESS_UNREADABLE");
    expect(read("big.md").finding?.code).toBe("INPUT_TOO_LARGE");
    expect(read("link.md").finding?.code).toBe("UNSAFE_PATH");
    expect(read("link.md").loaded.text).toBeNull();
  });

  test("lists at most 50 Markdown files by name and reports the excess", () => {
    const root = join(scratch, "many");
    mkdirSync(join(root, "ctx", "sub.md"), { recursive: true });
    for (let n = 0; n < MAX_CONTEXT_FILES + 3; n++) {
      writeFileSync(join(root, "ctx", `f${String(n).padStart(3, "0")}.md`), "# x");
    }
    writeFileSync(join(root, "ctx", "notes.txt"), "not markdown");
    const listed = listContextMarkdown(nodeFs, root, "ctx", DEFAULT_INPUT_LIMITS);
    expect(listed.paths).toHaveLength(MAX_CONTEXT_FILES);
    expect(listed.paths[0]).toBe("ctx/f000.md");
    expect(listed.paths.at(-1)).toBe("ctx/f049.md");
    expect(listed.findings).toEqual([
      {
        code: "INPUT_TOO_LARGE",
        severity: "warning",
        message: "ctx has 53 Markdown files; only the first 50 by name are read.",
        paths: ["ctx"],
        issues: [],
      },
    ]);
    expect(listContextMarkdown(nodeFs, root, "missing", DEFAULT_INPUT_LIMITS)).toEqual({
      paths: [],
      findings: [],
    });
    expect(listContextMarkdown(nodeFs, root, "ctx/f000.md", DEFAULT_INPUT_LIMITS).paths).toEqual(
      [],
    );
    const escape = join(root, "escape");
    symlinkSync(scratch, escape);
    expect(
      listContextMarkdown(nodeFs, root, "escape", DEFAULT_INPUT_LIMITS).findings[0]?.code,
    ).toBe("UNSAFE_PATH");
  });
});

describe("context listing", () => {
  test("keeps an escaping symlink listed so reading it reports UNSAFE_PATH", () => {
    const root = join(scratch, "leak");
    mkdirSync(join(root, "ctx"), { recursive: true });
    writeFileSync(join(scratch, "leak-target.md"), "# outside");
    symlinkSync(join(scratch, "leak-target.md"), join(root, "ctx", "leak.md"));
    writeFileSync(join(root, "ctx", "ok.md"), "# ok");
    const listed = listContextMarkdown(nodeFs, root, "ctx", DEFAULT_INPUT_LIMITS);
    expect(listed.paths).toEqual(["ctx/leak.md", "ctx/ok.md"]);
    expect(
      readSource(nodeFs, root, "ctx/leak.md", "context", DEFAULT_INPUT_LIMITS).finding?.code,
    ).toBe("UNSAFE_PATH");
  });
});

const within = (run: () => void, ms = 10_000): void => {
  const started = performance.now();
  run();
  expect(performance.now() - started).toBeLessThan(ms);
};

describe("adversarial input", () => {
  // Covers: R2
  const N = 200_000;

  test("scans unclosed HTML comment openers in linear time", () => {
    const openers = "<!--".repeat(N);
    within(() => {
      const doc = parseMarkdown(`# T\n## Preguntas abiertas\n${openers}\n- visible\n`);
      // the unclosed comment swallows the rest of the document, exactly as before
      expect(doc.sections.map((s) => s.heading)).toEqual(["Preguntas abiertas"]);
      expect(doc.lines[2]).toBe("");
    });
    within(() => expect(parseMarkdown(`${"<!-- a -->x".repeat(N)}`).lines[0]?.length).toBe(N));
    expect(parseMarkdown("a<!-- x --> b <!-- y --> c").lines).toEqual(["a b  c"]);
    expect(parseMarkdown("keep <!-- cut").lines).toEqual(["keep "]);
  });

  test("parses headings and named bullets without quadratic backtracking", () => {
    within(() => {
      expect(parseMarkdown(`## a${" ".repeat(N)}b${" ".repeat(N)}`).sections[0]?.heading).toBe(
        `a${" ".repeat(N)}b`,
      );
      expect(parseMarkdown(`## ${"x #".repeat(N)}`).sections).toHaveLength(1);
    });
    expect(parseMarkdown("## Actors ##").sections[0]?.heading).toBe("Actors");
    expect(parseMarkdown("## C#").sections[0]?.heading).toBe("C#");
    const text = [
      "# T",
      "## Actors",
      `- ${"a".repeat(10)}${" ".repeat(N)}x`,
      `- ${"(".repeat(N)}`,
    ].join("\n");
    within(() => expect(extract(text).candidates).toEqual([]));
    const dash = extract(
      "# T\n## Data entities\n- **Member** — a person (context/md/brand.md)\n- Partner — a business",
    );
    expect(dash.candidates.map((c) => c.value)).toEqual([
      { name: "Member", details: ["a person"] },
      { name: "Partner", details: ["a business"] },
    ]);
  });

  test("builds actor keys from many unclosed parentheses in linear time", () => {
    within(() =>
      expect(actorKeys(`Member ${"(".repeat(N)}`).keys).toEqual([`member ${"(".repeat(N)}`]),
    );
    expect(actorKeys("Admin (staff) / Owner (x").keys).toEqual(["admin", "owner (x"]);
    expect(actorKeys("(a)(b)c").keys).toEqual(["c"]);
  });
});

describe("text and markdown primitives", () => {
  test("normalizes text, strips inline markers and builds actor keys", () => {
    expect(stripInline("**Bold** `code` __under__")).toBe("Bold code under");
    expect(normalizeText("  **See  Member** Data.  ")).toBe("see member data");
    expect(actorKeys("Member `ACT-MEMBER`")).toEqual({ keys: ["member"], pinnedId: "ACT-MEMBER" });
    expect(actorKeys("Diseñador / Product Owner (operador de Heron)")).toEqual({
      keys: ["disenador", "product owner"],
      pinnedId: null,
    });
  });

  test("keeps the role vocabulary normalized and reads ux-kind markers", () => {
    for (const role of SECTION_ROLES) {
      for (const heading of ROLE_HEADINGS[role]) expect(normalizeText(heading)).toBe(heading);
    }
    const doc = parseMarkdown(
      [
        "# Title",
        "intro",
        "## Global **states**",
        "<!-- ux-kind: global-states -->",
        "- a",
        "## Other",
        "x",
      ].join("\n"),
    );
    expect(doc.title?.heading).toBe("Title");
    expect(doc.sections.map((s) => [s.heading, s.uxKind])).toEqual([
      ["Global **states**", "global-states"],
      ["Other", null],
    ]);
    expect(sectionAnchor(doc.sections[0]!)).toBe("§Global states");
    expect(parseMarkdown("no headings at all")).toEqual({
      lines: ["no headings at all"],
      sections: [],
      title: null,
    });
  });
});
