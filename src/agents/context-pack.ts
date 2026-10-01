import {
  PACK_ITEM_KINDS,
  type AgentTaskId,
  type FindingIssue,
  type PackItemKind,
  type PackItemRef,
  type PackTrim,
  type ResearchReference,
} from "../core/contracts/index.ts";
import { sha256Hex } from "../core/store/hash.ts";
import type { ContextItem, ContextPack } from "./ports.ts";

/** DR40 caps. */
export const PACK_LIMITS = {
  maxReferences: 30,
  maxExternalChars: 6_000,
  maxBrandInputs: 20,
  maxQueries: 20,
} as const;

/** Repair packs carry at most this much of the previous output (DR43). */
const MAX_PREVIOUS_OUTPUT_CHARS = 32_000;
/** Trimmable items are cut to this many characters before they are dropped (DR8). */
const TRIM_TO_CHARS = 2_000;
const TRUNCATION_PREFIX = "[…truncated by Heron: ";
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/;

export type PackInput = {
  task: AgentTaskId;
  budget: number;
  /** AGENT_TASKS[task].allowedItems; passed in so this module never imports the task table. */
  allowed: readonly PackItemKind[];
  items: readonly ContextItem[];
};
export type PackResult =
  | { ok: true; pack: ContextPack }
  | { ok: false; chars: number; budget: number; trimmed: PackTrim[] };

const truncationMarker = (omitted: number): string =>
  `${TRUNCATION_PREFIX}${omitted} chars omitted]`;
const isTruncated = (content: string): boolean =>
  content.endsWith(" chars omitted]") && content.includes(TRUNCATION_PREFIX);

/** Case-insensitive ASCII match of `needle` (lowercase) at `at`. */
function matchesAt(text: string, at: number, needle: string): boolean {
  if (at + needle.length > text.length) return false;
  for (let i = 0; i < needle.length; i += 1) {
    if ((text.charCodeAt(at + i) | 0x20) !== needle.charCodeAt(i)) return false;
  }
  return true;
}
const isNameChar = (code: number): boolean =>
  (code >= 48 && code <= 57) || ((code | 0x20) >= 97 && (code | 0x20) <= 122) || code === 45;

/** Index just after the `</name ...>` closing tag, or text.length when there is none. Linear. */
function skipRawTextElement(text: string, from: number, name: string): number {
  let at = text.indexOf("</", from);
  while (at !== -1) {
    if (matchesAt(text, at + 2, name) && !isNameChar(text.charCodeAt(at + 2 + name.length))) {
      const close = text.indexOf(">", at);
      return close === -1 ? text.length : close + 1;
    }
    at = text.indexOf("</", at + 2);
  }
  return text.length;
}

const RAW_TEXT_ELEMENTS = ["script", "style", "noscript"] as const;

/** Single-pass, linear HTML-to-text: drops raw-text elements and tags, never backtracks. */
function htmlToText(html: string): string {
  const parts: string[] = [];
  let noMoreClose = false;
  let from = 0;
  let i = html.indexOf("<");
  while (i !== -1) {
    const next = html.charCodeAt(i + 1);
    const isTag =
      (next | 0x20) >= 97 && (next | 0x20) <= 122
        ? true
        : next === 47 || next === 33 || next === 63;
    if (!isTag) {
      i = html.indexOf("<", i + 1);
      continue;
    }
    parts.push(html.slice(from, i), " ");
    const raw = RAW_TEXT_ELEMENTS.find(
      (name) => matchesAt(html, i + 1, name) && !isNameChar(html.charCodeAt(i + 1 + name.length)),
    );
    let end: number;
    if (raw !== undefined) {
      end = skipRawTextElement(html, i + 1, raw);
    } else {
      const close = noMoreClose ? -1 : html.indexOf(">", i);
      if (close === -1) noMoreClose = true;
      end = close === -1 ? html.length : close + 1; // an unterminated tag swallows the rest
    }
    from = end;
    i = end >= html.length ? -1 : html.indexOf("<", end);
  }
  parts.push(html.slice(from));
  return parts.join("");
}

const ENTITIES: Readonly<Record<string, string>> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  "#39": "'",
  nbsp: " ",
};

/** DR40: text/html -> text (drops script/style/noscript blocks and tags, decodes &amp; &lt; &gt; &quot; &#39; &nbsp;,
 * collapses whitespace; linear), then head truncation to `maxChars` with a marker. Other media types are only truncated. */
export function compactText(
  text: string,
  mediaType: string,
  maxChars: number,
): { text: string; omitted: number } {
  let out = text;
  if (mediaType.trim().toLowerCase().startsWith("text/html")) {
    out = htmlToText(text)
      .replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (_whole, name: string) => ENTITIES[name] ?? "")
      .replace(/\s+/g, " ")
      .trim();
  }
  if (out.length <= maxChars) return { text: out, omitted: 0 };
  let keep = maxChars;
  const last = out.charCodeAt(keep - 1);
  if (keep > 0 && last >= 0xd800 && last <= 0xdbff) keep -= 1; // never split a surrogate pair
  const omitted = out.length - keep;
  return { text: `${out.slice(0, keep)}${truncationMarker(omitted)}`, omitted };
}

/** Hidden, control and bidi code points become `\u{XXXX}` so they cannot steer a reader or hide text. */
function revealHidden(text: string): string {
  let out = "";
  let from = 0;
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    const hidden =
      (code < 0x20 && code !== 0x09 && code !== 0x0a) ||
      code === 0x7f ||
      (code >= 0x200b && code <= 0x200f) ||
      (code >= 0x202a && code <= 0x202e) ||
      (code >= 0x2060 && code <= 0x2064) ||
      (code >= 0x2066 && code <= 0x2069) ||
      code === 0xfeff;
    if (!hidden) continue;
    out += `${text.slice(from, i)}\\u{${code.toString(16).toUpperCase().padStart(4, "0")}}`;
    from = i + 1;
  }
  return from === 0 ? text : out + text.slice(from);
}

/** A delimited body can never contain its own closing marker or the item closing tag. */
const neutralize = (text: string): string =>
  revealHidden(text).replaceAll("<<<", "<<\\u{3C}").replaceAll("</item>", "<\\u{2F}item>");

function renderItem(item: ContextItem): string {
  const sha = sha256Hex(new TextEncoder().encode(item.content));
  const safe = neutralize(item.content);
  const body =
    item.trust === "heron"
      ? safe
      : (() => {
          const sha8 = sha256Hex(new TextEncoder().encode(safe)).slice(0, 8);
          return `<<<data:${item.trust}:${sha8}>>>\n${safe}\n<<<end:${sha8}>>>`;
        })();
  const flag = isTruncated(item.content) ? " truncated" : "";
  return `<item kind="${item.kind}" id="${item.id}" trust="${item.trust}" sha256="${sha}" findings="${item.findings}"${flag}>\n${body}\n</item>\n`;
}

const headerFor = (task: AgentTaskId, budget: number): string =>
  `# Heron context pack · task ${task} · budget ${budget} chars\n`;

/** Header + per item `<item ...>` + content (non-heron items delimited as DR9) + `</item>`. No clock, run id or path. */
export function renderContextPack(
  task: AgentTaskId,
  budget: number,
  items: readonly ContextItem[],
): string {
  return headerFor(task, budget) + items.map(renderItem).join("");
}

const KIND_ORDER = new Map<PackItemKind, number>(PACK_ITEM_KINDS.map((kind, i) => [kind, i]));
const kindIndex = (kind: PackItemKind): number => KIND_ORDER.get(kind) ?? PACK_ITEM_KINDS.length;

/** `REF-12` -> ["REF-", 12]; ids without a numeric tail sort by text alone. */
function splitId(id: string): readonly [string, number] {
  let i = id.length;
  while (i > 0 && id.charCodeAt(i - 1) >= 48 && id.charCodeAt(i - 1) <= 57) i -= 1;
  return [id.slice(0, i), i < id.length ? Number(id.slice(i)) : -1];
}
function compareIds(a: string, b: string): number {
  const [pa, na] = splitId(a);
  const [pb, nb] = splitId(b);
  if (pa !== pb) return pa < pb ? -1 : 1;
  if (na !== nb) return na - nb;
  return a === b ? 0 : a < b ? -1 : 1;
}
/** Order of the pack: (priority, kind order, id number). Static items (priority 0) come first (DR41). */
function compareItems(a: ContextItem, b: ContextItem): number {
  return a.priority - b.priority || kindIndex(a.kind) - kindIndex(b.kind) || compareIds(a.id, b.id);
}

const isTrimmable = (item: ContextItem): boolean =>
  item.kind === "external-text" ||
  item.kind === "analysis-note" ||
  (item.kind === "brief-query" && item.trust === "untrusted");

/** DR40 caps by kind; returns the survivors and what was dropped. */
function applyCaps(items: readonly ContextItem[]): { kept: ContextItem[]; dropped: ContextItem[] } {
  const dropped: ContextItem[] = [];
  const keepFirst = (kind: PackItemKind, max: number): Set<ContextItem> => {
    const own = items
      .filter((item) => item.kind === kind)
      .toSorted((a, b) => compareIds(a.id, b.id));
    own.slice(max).forEach((item) => dropped.push(item));
    return new Set(own.slice(0, max));
  };
  const references = keepFirst("reference", PACK_LIMITS.maxReferences);
  const droppedRefIds = new Set(dropped.map((item) => item.id));
  const brand = keepFirst("brand-input", PACK_LIMITS.maxBrandInputs);
  const operatorQueries = keepFirst("operator-query", PACK_LIMITS.maxQueries);
  const briefQueries = keepFirst("brief-query", PACK_LIMITS.maxQueries);
  const kept = items.filter((item) => {
    if (item.kind === "reference") return references.has(item);
    if (item.kind === "brand-input") return brand.has(item);
    if (item.kind === "operator-query") return operatorQueries.has(item);
    if (item.kind === "brief-query") return briefQueries.has(item);
    if (
      (item.kind === "reference-origin" ||
        item.kind === "external-text" ||
        item.kind === "analysis-note") &&
      droppedRefIds.has(item.id)
    ) {
      dropped.push(item);
      return false;
    }
    return true;
  });
  return { kept, dropped };
}

const refOf = (item: ContextItem): PackItemRef => ({
  kind: item.kind,
  id: item.id,
  trust: item.trust,
  sha256: sha256Hex(new TextEncoder().encode(item.content)),
  chars: item.content.length,
});

function assemble(
  task: AgentTaskId,
  budget: number,
  items: ContextItem[],
  trimmed: PackTrim[],
): ContextPack {
  const text = renderContextPack(task, budget, items);
  return {
    task,
    budget,
    items,
    text,
    sha256: sha256Hex(new TextEncoder().encode(text)),
    chars: text.length,
    refs: items.map(refOf),
    trimmed,
  };
}

/** Asserts allowed kinds (throws: programming error), applies DR40 caps and compaction, sorts, renders and trims as
 * DR8: truncate to 2 000 chars, then drop, the trimmable items of highest priority number and highest id first;
 * priority 0 is never touched. Deterministic. */
export function buildContextPack(input: PackInput): PackResult {
  const seen = new Set<string>();
  for (const item of input.items) {
    if (!input.allowed.includes(item.kind)) {
      throw new Error(`context item kind "${item.kind}" is not allowed for task ${input.task}`);
    }
    if (!ID_RE.test(item.id))
      throw new Error(`invalid context item id: ${JSON.stringify(item.id)}`);
    const key = `${item.kind}\u0000${item.id}`;
    if (seen.has(key)) throw new Error(`duplicate context item ${item.kind}/${item.id}`);
    seen.add(key);
  }
  const { kept, dropped } = applyCaps(input.items);
  const trimmed: PackTrim[] = dropped.map((item) => ({
    id: item.id,
    action: "dropped",
    originalChars: item.content.length,
    keptChars: 0,
  }));
  const compacted = kept.map((item): ContextItem => {
    if (item.kind !== "external-text") return item;
    const { text } = compactText(item.content, "text/plain", PACK_LIMITS.maxExternalChars);
    return text === item.content ? item : { ...item, content: text };
  });
  const sorted = compacted.toSorted(compareItems);
  const header = headerFor(input.task, input.budget);
  const rendered = new Map<ContextItem, string>(sorted.map((item) => [item, renderItem(item)]));
  const entries = sorted.slice();
  const total = (): number =>
    header.length + entries.reduce((sum, item) => sum + (rendered.get(item) ?? "").length, 0);

  if (total() > input.budget) {
    // Pass 1 truncates, pass 2 drops; both walk the trimmable items from the last priority and the highest id.
    const order = entries.filter(isTrimmable).toSorted((a, b) => -compareItems(a, b));
    const records = new Map<ContextItem, PackTrim>();
    const replaced = new Map<ContextItem, ContextItem>();
    for (const item of order) {
      if (total() <= input.budget) break;
      if (item.content.length <= TRIM_TO_CHARS) continue;
      const cut: ContextItem = {
        ...item,
        content: compactText(item.content, "text/plain", TRIM_TO_CHARS).text,
      };
      entries[entries.indexOf(item)] = cut;
      rendered.set(cut, renderItem(cut));
      replaced.set(item, cut);
      records.set(item, {
        id: item.id,
        action: "truncated",
        originalChars: item.content.length,
        keptChars: cut.content.length,
      });
    }
    for (const item of order) {
      if (total() <= input.budget) break;
      const current = replaced.get(item) ?? item;
      entries.splice(entries.indexOf(current), 1);
      records.set(item, {
        id: item.id,
        action: "dropped",
        originalChars: item.content.length,
        keptChars: 0,
      });
    }
    trimmed.push(...records.values());
  }
  trimmed.sort((a, b) => compareIds(a.id, b.id) || a.action.localeCompare(b.action));
  if (total() > input.budget) {
    return { ok: false, chars: total(), budget: input.budget, trimmed };
  }
  return { ok: true, pack: assemble(input.task, input.budget, entries, trimmed) };
}

const listLines = (label: string, values: readonly string[]): string[] =>
  values.length === 0 ? [`${label}: none`] : [`${label}:`, ...values.map((value) => `- ${value}`)];

/** reference -> one `reference` item (operator; allowlist projection: id, source, reason, studies, doNotCopy,
 * influences, crops[].note) + one `reference-origin` item (untrusted; origin). Never `securityFindings[].phrase`
 * (only the count, in the header). No capture internals, `capturedAt`, paths or images (DR40). */
export function referenceItems(reference: ResearchReference): ContextItem[] {
  const content = [
    `id: ${reference.id}`,
    `source: ${reference.source}`,
    `reason: ${reference.reason}`,
    ...listLines("studies", reference.studies),
    ...listLines("doNotCopy", reference.doNotCopy),
    ...listLines("influences", reference.influences),
    ...listLines(
      "crops",
      reference.crops.map((crop) => crop.note),
    ),
  ].join("\n");
  return [
    {
      kind: "reference",
      id: reference.id,
      trust: "operator",
      priority: 0,
      content,
      findings: reference.securityFindings.length,
    },
    {
      kind: "reference-origin",
      id: reference.id,
      trust: "untrusted",
      priority: 1,
      content: reference.origin,
      findings: 0,
    },
  ];
}

/** Repair pack (DR43): ONLY the `task-input` items of `pack` + `previous-output` (untrusted, <= 32 000 chars) +
 * `validation-issues` (heron); never the other original items; not trimmed. */
export function repairPack(
  pack: ContextPack,
  previousOutput: string | null,
  issues: readonly FindingIssue[],
): ContextPack {
  const items: ContextItem[] = pack.items.filter((item) => item.kind === "task-input");
  if (previousOutput !== null) {
    items.push({
      kind: "previous-output",
      id: "previous-output",
      trust: "untrusted",
      priority: 5,
      content: compactText(previousOutput, "text/plain", MAX_PREVIOUS_OUTPUT_CHARS).text,
      findings: 0,
    });
  }
  items.push({
    kind: "validation-issues",
    id: "validation-issues",
    trust: "heron",
    priority: 0,
    content: issues.map((issue) => `- ${issue.pointer}: ${issue.message}`).join("\n"),
    findings: 0,
  });
  return assemble(pack.task, pack.budget, items.toSorted(compareItems), []);
}
