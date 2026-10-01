import {
  BRAND_KINDS,
  type BrandKind,
  type Finding,
  type RelativeArtifactPath,
  type SourceKind,
} from "../core/contracts/index.ts";
import { candidateSink, type CandidateSink } from "./candidates.ts";
import type { Candidate } from "./ports.ts";
import { actorKeys, normalizeText, stripInline } from "./text.ts";

export const SECTION_ROLES = [
  "summary",
  "moscow",
  "actors",
  "rules",
  "functional",
  "nonFunctional",
  "entities",
  "questions",
  "brand",
] as const;
export type SectionRole = (typeof SECTION_ROLES)[number];

/** Normalized (see `normalizeText`) heading vocabulary, Spanish ∪ English, taken from the real harness
 * templates: MASTER (`Actores y permisos`, `Dominio y datos`) and DIGEST (`Actores`, `Entidades de datos`). */
export const ROLE_HEADINGS: Readonly<Record<SectionRole, readonly string[]>> = {
  summary: ["resumen ejecutivo", "executive summary"],
  moscow: ["alcance (moscow)", "scope (moscow)"],
  actors: ["actores y permisos", "actors and permissions", "actores", "actors"],
  rules: ["reglas de negocio", "business rules"],
  functional: ["requisitos funcionales", "functional requirements"],
  nonFunctional: ["requisitos no funcionales", "non-functional requirements"],
  entities: ["dominio y datos", "domain and data", "entidades de datos", "data entities"],
  questions: ["preguntas abiertas", "open questions"],
  brand: ["marca", "brand", "insumos de marca", "brand inputs"],
};

/** Bodies that mean "nothing here" (`Ninguna` in MASTER, `Ninguno` in DIGEST, `None`). */
export const NONE_LITERALS: readonly string[] = ["ninguna", "ninguno", "none"];

/** Lines are 0-based indexes into `MarkdownDoc.lines`; they never reach a persisted locator (DR2). */
export type MarkdownSection = {
  heading: string;
  level: number;
  role: SectionRole | null;
  uxKind: string | null;
  startLine: number;
  endLine: number;
};
/** `lines` keeps the original numbering with code blocks and HTML comments blanked. `title` is the first
 * `#` heading (its span ends at the next heading); `sections` holds every other heading. */
export type MarkdownDoc = {
  lines: string[];
  sections: MarkdownSection[];
  title: MarkdownSection | null;
};

const HEADING_LINE = /^ {0,3}(#{1,6})[ \t]+(\S.*)$/;
const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const UX_KIND = /<!--\s*ux-kind:\s*([a-z0-9-]+)\s*-->/;

/** ATX heading of a line, with an optional closing `#` run dropped. Linear: no lazy or unbounded
 * backtracking over the (untrusted) line. */
function headingOf(line: string): { level: number; heading: string } | null {
  const match = HEADING_LINE.exec(line);
  if (match === null) return null;
  const body = (match[2] ?? "").trimEnd();
  let end = body.length;
  while (end > 0 && body[end - 1] === "#") end--;
  const closing = end < body.length && end > 0 && /[ \t]/.test(body[end - 1] ?? "");
  const heading = closing ? body.slice(0, end).trimEnd() : body;
  return { level: (match[1] ?? "").length, heading: heading === "" ? body : heading };
}

/** Removes complete `<!-- … -->` comments in one forward pass; an unclosed `<!--` cuts the rest of the
 * line and reports `opened`. Same result as a lazy regex, without its quadratic worst case. */
function stripComments(line: string): { visible: string; opened: boolean } {
  let visible = "";
  let from = 0;
  for (;;) {
    const open = line.indexOf("<!--", from);
    if (open < 0) return { visible: visible + line.slice(from), opened: false };
    const close = line.indexOf("-->", open + 4);
    if (close < 0) return { visible: visible + line.slice(from, open), opened: true };
    visible += line.slice(from, open);
    from = close + 3;
  }
}

const roleOf = (heading: string): SectionRole | null => {
  const normalized = normalizeText(heading);
  return SECTION_ROLES.find((role) => ROLE_HEADINGS[role].includes(normalized)) ?? null;
};

/** Splits Markdown into sections. Fenced code and HTML comments are blanked (never read as data);
 * the `<!-- ux-kind: … -->` marker on the line(s) right after a heading becomes `uxKind`. */
export function parseMarkdown(text: string): MarkdownDoc {
  const lines: string[] = [];
  const kindAt = new Map<number, string>();
  let fence: string | null = null;
  let inComment = false;
  for (const [index, line] of text.split(/\r?\n/).entries()) {
    if (fence !== null) {
      lines.push("");
      if (line.trim().startsWith(fence)) fence = null;
      continue;
    }
    if (inComment) {
      lines.push("");
      inComment = !line.includes("-->");
      continue;
    }
    const opening = FENCE.exec(line)?.[1];
    if (opening !== undefined) {
      fence = opening;
      lines.push("");
      continue;
    }
    const kind = UX_KIND.exec(line)?.[1];
    if (kind !== undefined) kindAt.set(index, kind);
    const stripped = stripComments(line);
    inComment = stripped.opened;
    lines.push(stripped.visible);
  }
  const headings: { index: number; level: number; heading: string }[] = [];
  for (const [index, line] of lines.entries()) {
    const parsed = headingOf(line);
    if (parsed !== null) headings.push({ index, ...parsed });
  }
  const all = headings.map((entry, at): MarkdownSection => {
    let kind: string | null = null;
    for (let next = entry.index + 1; next < lines.length; next++) {
      const candidate = kindAt.get(next);
      if (candidate !== undefined) kind = candidate;
      if ((lines[next] ?? "").trim() !== "" || kind !== null) break;
    }
    const closing = headings.slice(at + 1).find((other) => other.level <= entry.level);
    return {
      heading: entry.heading,
      level: entry.level,
      role: roleOf(entry.heading),
      uxKind: kind,
      startLine: entry.index,
      endLine: (closing?.index ?? lines.length) - 1,
    };
  });
  const titleAt = all.findIndex((section) => section.level === 1);
  const first = titleAt >= 0 ? all[titleAt] : undefined;
  const title: MarkdownSection | null =
    first === undefined
      ? null
      : { ...first, endLine: (headings[titleAt + 1]?.index ?? lines.length) - 1 };
  return { lines, sections: all.filter((_, at) => at !== titleAt), title };
}

/** `§<heading>` with inline formatting stripped: the stable locator of a Markdown section (DR2). */
export function sectionAnchor(section: MarkdownSection): string {
  return `§${stripInline(section.heading)}`;
}

// ---- blocks -----------------------------------------------------------------

export type MdBlock =
  | { kind: "item"; text: string }
  | { kind: "paragraph"; text: string }
  | { kind: "table"; header: string[]; rows: string[][] };

const BULLET = /^\s*(?:[-*+]|\d+[.)])\s+(.*)$/;

const splitRow = (line: string): string[] =>
  line
    .trim()
    .replace(/^\|/, "")
    .replace(/(?<!\\)\|$/, "")
    .split(/(?<!\\)\|/)
    .map((cell) => cell.replaceAll("\\|", "|").trim());

const isSeparator = (cells: string[]): boolean =>
  cells.length > 0 && cells.every((cell) => /^:?-+:?$/.test(cell));

/** Body lines of a section (children included), without heading lines. */
export function sectionBody(doc: MarkdownDoc, section: MarkdownSection): string[] {
  return doc.lines
    .slice(section.startLine + 1, section.endLine + 1)
    .map((line) => (headingOf(line) !== null ? "" : line));
}

/** Splits lines into bullet items (with indented continuations), paragraphs and tables, in order. */
export function blocksOf(lines: readonly string[]): MdBlock[] {
  const blocks: MdBlock[] = [];
  let open: { kind: "item" | "paragraph"; parts: string[] } | null = null;
  const close = (): void => {
    if (open !== null) blocks.push({ kind: open.kind, text: open.parts.join(" ") });
    open = null;
  };
  let at = 0;
  while (at < lines.length) {
    const line = lines[at] ?? "";
    if (line.trim() === "") {
      close();
      at++;
    } else if (line.trim().startsWith("|")) {
      close();
      const table: string[][] = [];
      while (at < lines.length && (lines[at] ?? "").trim().startsWith("|")) {
        table.push(splitRow(lines[at] ?? ""));
        at++;
      }
      const [header = [], ...rest] = table;
      const rows = rest.length > 0 && isSeparator(rest[0] ?? []) ? rest.slice(1) : rest;
      blocks.push({ kind: "table", header, rows });
    } else {
      const bullet = BULLET.exec(line);
      if (bullet !== null) {
        close();
        open = { kind: "item", parts: [(bullet[1] ?? "").trim()] };
      } else if (open !== null && (open.kind === "paragraph" || /^\s/.test(line))) {
        open.parts.push(line.trim());
      } else {
        close();
        open = { kind: "paragraph", parts: [line.trim()] };
      }
      at++;
    }
  }
  close();
  return blocks;
}

const SOURCE_MARKER = /^(?:origen|source|fuente):/i;
/** Prose a section carries besides data: `Origen:`/`Source:` lines and "none" bodies. */
export const isNoise = (text: string): boolean => {
  const plain = stripInline(text).trim();
  return plain === "" || SOURCE_MARKER.test(plain) || NONE_LITERALS.includes(normalizeText(plain));
};

// ---- extraction -------------------------------------------------------------

type Origin = { source: SourceKind; path: RelativeArtifactPath };

const unreadable = (path: string, message: string): Finding => ({
  code: "CONTEXT_SECTION_UNREADABLE",
  severity: "warning",
  message,
  paths: [path],
  issues: [],
});

const MOSCOW = /^([MSCW]\d+)(?:\s*[.:)—–-]\s*|\s+)(.+)$/;
const PRIORITY = { M: "must", S: "should", C: "could" } as const;
const ID_ROLES = {
  rules: { id: /^RN-\d+$/, lead: /^(RN-\d+)\b[\s:.—–-]*(.*)$/, section: "businessRules" },
  functional: {
    id: /^RF-\d+$/,
    lead: /^(RF-\d+)\b[\s:.—–-]*(.*)$/,
    section: "functionalRequirements",
  },
  nonFunctional: {
    id: /^RNF-\d+$/,
    lead: /^(RNF-\d+)\b[\s:.—–-]*(.*)$/,
    section: "nonFunctionalRequirements",
  },
} as const;
const CAN = ["puede", "can"];
const CANNOT = ["no puede", "cannot", "can't", "can not"];
const BRAND_KIND_LINE = /^([a-z][a-z-]*)\s*:\s*(.+)$/;

const splitList = (cell: string): string[] =>
  stripInline(cell)
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part !== "");

const keyOfName = (name: string): string => actorKeys(name).keys[0] ?? normalizeText(name);

/** First " — " / " – " (dash with whitespace on both sides) splits name from description. */
function splitAtDash(text: string): [string, string] | null {
  for (let at = 1; at < text.length - 1; at++) {
    const ch = text[at];
    if (
      (ch === "—" || ch === "–") &&
      /\s/.test(text[at - 1] ?? "") &&
      /\s/.test(text[at + 1] ?? "")
    ) {
      const name = text.slice(0, at).trimEnd();
      return name === "" ? null : [name, text.slice(at + 1).trimStart()];
    }
  }
  return null;
}

/** Drops a trailing `(… context/md/… )` citation (single-level parentheses). */
function dropCitation(text: string): string {
  if (!text.endsWith(")")) return text;
  const open = text.lastIndexOf("(");
  const inner = open < 0 ? "" : text.slice(open + 1, -1);
  return inner.includes("context/md/") && !inner.includes(")")
    ? text.slice(0, open).trimEnd()
    : text;
}

/** A bullet naming a thing: bold first, else the text before " — "; the rest (minus a trailing
 * `(context/md/…)` citation) is its description. */
function namedBullet(text: string): { name: string; rest: string } | null {
  const bold = /^\*\*(.+?)\*\*[\s—–-]*(.*)$/.exec(text);
  const split = bold === null ? splitAtDash(text) : [bold[1] ?? "", bold[2] ?? ""];
  if (split === null) return null;
  const name = stripInline(split[0] ?? "").trim();
  const rest = dropCitation(stripInline(split[1] ?? "").trim());
  return name === "" ? null : { name, rest };
}

function extractActors(
  blocks: readonly MdBlock[],
  sink: CandidateSink,
  locator: string,
  warn: (message: string) => void,
): void {
  const tables = blocks.filter((block) => block.kind === "table");
  const withColumns = tables.filter((table) => {
    const header = table.header.map(normalizeText);
    return (
      header.some((cell) => CAN.includes(cell)) && header.some((cell) => CANNOT.includes(cell))
    );
  });
  if (withColumns.length > 0) {
    for (const table of withColumns) {
      const header = table.header.map(normalizeText);
      const canAt = header.findIndex((cell) => CAN.includes(cell));
      const cannotAt = header.findIndex((cell) => CANNOT.includes(cell));
      for (const row of table.rows) {
        if (row.length !== header.length) {
          warn(`a table row has ${row.length} cells; it is skipped.`);
          continue;
        }
        const cell = row[0] ?? "";
        const { pinnedId } = actorKeys(cell);
        const name = stripInline(cell.replace(/`?ACT-[A-Z0-9-]+`?/, ""))
          .replace(/\s+/g, " ")
          .trim();
        if (name === "") continue;
        sink.add(
          "actors",
          keyOfName(cell),
          {
            id: pinnedId,
            name,
            goal: null,
            can: splitList(row[canAt] ?? ""),
            cannot: splitList(row[cannotAt] ?? ""),
            capabilities: [],
            forbiddenActions: [],
            constraints: [],
            surfaces: [],
            relations: [],
            extensions: [],
          },
          locator,
        );
      }
    }
    return;
  }
  for (const block of blocks) {
    if (block.kind !== "item") continue;
    const named = namedBullet(block.text);
    if (named === null) continue;
    sink.add(
      "actors",
      keyOfName(named.name),
      {
        id: null,
        name: named.name,
        goal: null,
        can: [],
        cannot: [],
        capabilities: [],
        forbiddenActions: [],
        constraints: [],
        surfaces: [],
        relations: [],
        extensions: [],
      },
      locator,
    );
  }
}

function extractEntities(
  blocks: readonly MdBlock[],
  sink: CandidateSink,
  locator: string,
  warn: (message: string) => void,
): void {
  const table = blocks.find((block) => block.kind === "table");
  if (table !== undefined) {
    for (const row of table.rows) {
      if (row.length !== table.header.length) {
        warn(`a table row has ${row.length} cells; it is skipped.`);
        continue;
      }
      const name = stripInline(row[0] ?? "").trim();
      if (name === "") continue;
      const details = row
        .slice(1)
        .map((cell) => stripInline(cell).trim())
        .filter((cell) => cell !== "");
      sink.add("entities", keyOfName(name), { name, details }, locator);
    }
    return;
  }
  for (const block of blocks) {
    if (block.kind !== "item") continue;
    const named = namedBullet(block.text);
    if (named === null) continue;
    sink.add(
      "entities",
      keyOfName(named.name),
      { name: named.name, details: named.rest === "" ? [] : [named.rest] },
      locator,
    );
  }
}

function extractIds(
  role: keyof typeof ID_ROLES,
  blocks: readonly MdBlock[],
  sink: CandidateSink,
  locator: string,
): void {
  const { id: idPattern, lead, section } = ID_ROLES[role];
  for (const block of blocks) {
    if (block.kind === "table") {
      for (const row of block.rows) {
        const id = stripInline(row[0] ?? "").trim();
        if (!idPattern.test(id)) continue;
        const text = row
          .slice(1)
          .map((cell) => stripInline(cell).trim())
          .filter((cell) => cell !== "")
          .join(" — ");
        if (text !== "") sink.add(section, id, { id, text, derivedFrom: [] }, locator);
      }
    } else if (block.kind === "item") {
      const match = lead.exec(stripInline(block.text).trim());
      const id = match?.[1];
      const text = (match?.[2] ?? "").trim();
      if (id !== undefined && text !== "") {
        sink.add(section, id, { id, text, derivedFrom: [] }, locator);
      }
    }
  }
}

/** Extracts elements from the sections whose heading names a role (`ROLE_HEADINGS`, Spanish ∪ English);
 * every other section, and any line outside them, contributes nothing. A role's ids are defined only
 * inside its own section (DR8). Never throws; unreadable shapes become CONTEXT_SECTION_UNREADABLE. */
export function extractRoleSections(
  doc: MarkdownDoc,
  origin: Origin,
): { candidates: Candidate[]; findings: Finding[] } {
  const sink = candidateSink(origin);
  const findings: Finding[] = [];
  for (const section of doc.sections) {
    const role = section.role;
    if (role === null) continue;
    const locator = sectionAnchor(section);
    const blocks = blocksOf(sectionBody(doc, section));
    const warn = (message: string): void => {
      findings.push(unreadable(origin.path, `${origin.path} ${locator}: ${message}`));
    };
    const before = sink.items.length;
    switch (role) {
      case "summary": {
        const paragraph = blocks.find((b) => b.kind === "paragraph" && !isNoise(b.text));
        if (paragraph?.kind === "paragraph") {
          const value = stripInline(paragraph.text).trim();
          sink.add("product", "summary", { key: "summary", value }, locator);
        }
        break;
      }
      case "moscow":
        for (const block of blocks) {
          if (block.kind !== "item") continue;
          const match = MOSCOW.exec(stripInline(block.text).trim());
          const id = match?.[1];
          const text = (match?.[2] ?? "").trim();
          if (id === undefined) continue;
          const letter = id.slice(0, 1);
          if (letter === "W") {
            sink.add("constraints", id, { kind: "out-of-scope", id, subject: null, text }, locator);
          } else {
            const priority = PRIORITY[letter as keyof typeof PRIORITY];
            sink.add("capabilities", id, { id, priority, text }, locator);
          }
        }
        break;
      case "actors":
        extractActors(blocks, sink, locator, warn);
        break;
      case "entities":
        extractEntities(blocks, sink, locator, warn);
        break;
      case "rules":
      case "functional":
      case "nonFunctional":
        extractIds(role, blocks, sink, locator);
        break;
      case "questions":
        for (const block of blocks) {
          if (block.kind === "table" || isNoise(block.text)) continue;
          const text = stripInline(block.text).trim();
          sink.add("unresolvedQuestions", normalizeText(text), { text }, locator);
        }
        break;
      case "brand":
        for (const block of blocks) {
          if (block.kind === "table") continue;
          const match = BRAND_KIND_LINE.exec(stripInline(block.text).trim());
          const kind = match?.[1];
          const value = (match?.[2] ?? "").trim();
          if (kind === undefined) continue;
          if ((BRAND_KINDS as readonly string[]).includes(kind)) {
            sink.add(
              "brand",
              `${kind}/${normalizeText(value)}`,
              { kind: kind as BrandKind, value },
              locator,
            );
          } else if (block.kind === "item") {
            warn(`"${kind}" is not a brand input kind; the item is skipped.`);
          }
        }
        break;
    }
    const unread = role === "actors" || role === "entities";
    if (unread && sink.items.length === before && blocks.some((b) => !noiseBlock(b))) {
      warn(
        role === "actors"
          ? "no table with actor, can and cannot columns and no bulleted names; its actors are not read."
          : "no table and no bulleted names; its entities are not read.",
      );
    }
  }
  return { candidates: sink.items, findings };
}

const noiseBlock = (block: MdBlock): boolean => block.kind !== "table" && isNoise(block.text);
