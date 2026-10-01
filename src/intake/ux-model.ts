import {
  toJsonPointer,
  type Extension,
  type Finding,
  type RelativeArtifactPath,
  type ScreenAction,
} from "../core/contracts/index.ts";
import { candidateSink, type CandidateSink } from "./candidates.ts";
import type { Candidate } from "./ports.ts";
import type { UxContract } from "./ux-contract.ts";
import { actorKeys, normalizeText } from "./text.ts";

/** Fields of the harness ux.json contract (navori-harness `UxContractSchema`, aa149ad5), per entity.
 * Any other key is preserved as an `Extension`, never dropped or interpreted (RN-6). */
export const KNOWN_UX_FIELDS: Readonly<
  Record<
    | "root"
    | "surfaces"
    | "actors"
    | "journeys"
    | "flows"
    | "screens"
    | "functionalComponents"
    | "patterns"
    | "uxRequirements"
    | "traceability",
    readonly string[]
  >
> = {
  root: [
    "schemaVersion",
    "masterStage",
    "surfaces",
    "actors",
    "journeys",
    "flows",
    "screens",
    "functionalComponents",
    "patterns",
    "uxRequirements",
    "traceability",
  ],
  surfaces: ["id", "name", "actors", "purpose", "capabilities", "constraints", "requirements"],
  actors: [
    "id",
    "name",
    "goal",
    "capabilities",
    "constraints",
    "surfaces",
    "forbiddenActions",
    "relations",
  ],
  journeys: [
    "id",
    "name",
    "actor",
    "goal",
    "trigger",
    "initialState",
    "expectedResult",
    "flows",
    "requirements",
    "exceptions",
  ],
  flows: [
    "id",
    "name",
    "actor",
    "purpose",
    "trigger",
    "preconditions",
    "steps",
    "decisions",
    "alternateStates",
    "errors",
    "result",
    "screens",
    "requirements",
  ],
  screens: [
    "id",
    "name",
    "surface",
    "actors",
    "purpose",
    "requirements",
    "journeys",
    "flows",
    "information",
    "actions",
    "states",
    "conditions",
    "navigation",
    "permissions",
    "events",
  ],
  functionalComponents: [
    "id",
    "name",
    "responsibility",
    "information",
    "actions",
    "states",
    "screens",
    "variations",
  ],
  patterns: ["id", "name", "purpose", "screens", "states", "rules", "requirements"],
  uxRequirements: ["id", "statement", "derivedFrom"],
  traceability: ["requirement", "journeys", "flows", "screens", "patterns"],
};

/** Unknown keys of a raw `JSON.parse` object, in source order, as own-property entries (DR25).
 * Built from the raw object, not from Zod's output, which drops `__proto__`. */
export function extensionsOf(raw: Record<string, unknown>, known: readonly string[]): Extension[] {
  return Object.entries(raw)
    .filter(([key]) => !known.includes(key))
    .map(([key, value]) => ({ key, value }));
}

export type UxIds = {
  actors: Set<string>;
  surfaces: Set<string>;
  journeys: Set<string>;
  flows: Set<string>;
  screens: Set<string>;
  patterns: Set<string>;
  uxRequirements: Set<string>;
};

type Loose = Record<string, unknown>;
const isRecord = (v: unknown): v is Loose =>
  typeof v === "object" && v !== null && !Array.isArray(v);

type Collection = Exclude<keyof typeof KNOWN_UX_FIELDS, "root">;
const COLLECTIONS: readonly Collection[] = [
  "surfaces",
  "actors",
  "journeys",
  "flows",
  "screens",
  "functionalComponents",
  "patterns",
  "uxRequirements",
  "traceability",
];
const PRIORITIES = ["primary", "secondary", "destructive"] as const;

/** Maps a validated ux.json to candidates (source "ux.json", locator = JSON Pointer, in source order).
 * `raw` is the `JSON.parse` value of the same bytes `contract` was validated from: it carries the
 * unknown fields (`extensions`, root ones in `extensions`) and the collections the provisional contract
 * does not model. A field of an unexpected type is ignored with CONTEXT_SECTION_UNREADABLE, a repeated
 * id keeps the first with CONTEXT_DUPLICATE_ID, an undeclared internal reference is reported as
 * UX_REFERENCE_UNRESOLVED; none of them fails the mapping. */
export function uxCandidates(
  raw: Loose,
  contract: UxContract,
  path: RelativeArtifactPath,
): { candidates: Candidate[]; extensions: Extension[]; ids: UxIds; findings: Finding[] } {
  void contract; // shape and relations were checked by the reader; `raw` is the source of truth here
  const sink = candidateSink({ source: "ux.json", path });
  const findings: Finding[] = [];
  const warn = (code: Finding["code"], message: string): void => {
    findings.push({ code, severity: "warning", message, paths: [path], issues: [] });
  };
  const unexpected = (pointer: string, type: string): void =>
    warn(
      "CONTEXT_SECTION_UNREADABLE",
      `${path} ${pointer}: expected ${type}; the value is ignored.`,
    );

  // entries of one collection: records with a string id (traceability: `requirement`), first of each id
  const entriesOf = (
    kind: Collection,
  ): { index: number; entry: Loose; id: string; pointer: string }[] => {
    const list = raw[kind];
    if (list === undefined) return [];
    if (!Array.isArray(list)) {
      unexpected(toJsonPointer([kind]), "array");
      return [];
    }
    const idField = kind === "traceability" ? "requirement" : "id";
    const seen = new Map<string, string[]>();
    const kept: { index: number; entry: Loose; id: string; pointer: string }[] = [];
    list.forEach((entry: unknown, index) => {
      const pointer = toJsonPointer([kind, index]);
      const id = isRecord(entry) ? entry[idField] : undefined;
      if (!isRecord(entry) || typeof id !== "string" || id === "") {
        unexpected(isRecord(entry) ? `${pointer}/${idField}` : pointer, "string");
        return;
      }
      const earlier = seen.get(id);
      if (earlier !== undefined) {
        earlier.push(pointer);
        return;
      }
      seen.set(id, [pointer]);
      kept.push({ index, entry, id, pointer });
    });
    for (const [id, pointers] of seen) {
      if (pointers.length > 1) {
        warn(
          "CONTEXT_DUPLICATE_ID",
          `${id} appears more than once in ${path} (${pointers.join(", ")}); the first one is used.`,
        );
      }
    }
    return kept;
  };
  const text = (entry: Loose, field: string, pointer: string): string | null => {
    const value = entry[field];
    if (value === undefined || value === null) return null;
    if (typeof value === "string") return value;
    unexpected(`${pointer}/${field}`, "string");
    return null;
  };
  const list = (entry: Loose, field: string, pointer: string): string[] => {
    const value = entry[field];
    if (value === undefined) return [];
    if (Array.isArray(value)) {
      const strings = value.filter((item): item is string => typeof item === "string");
      if (strings.length === value.length) return strings;
    }
    unexpected(`${pointer}/${field}`, "array of strings");
    return [];
  };
  const extra = (entry: Loose, kind: Collection): Extension[] =>
    extensionsOf(entry, KNOWN_UX_FIELDS[kind]);

  const found = Object.fromEntries(COLLECTIONS.map((kind) => [kind, entriesOf(kind)])) as Record<
    Collection,
    ReturnType<typeof entriesOf>
  >;

  for (const { entry, id, pointer } of found.surfaces) {
    sink.add(
      "surfaces",
      id,
      {
        id,
        name: text(entry, "name", pointer),
        purpose: text(entry, "purpose", pointer),
        actors: list(entry, "actors", pointer),
        capabilities: list(entry, "capabilities", pointer),
        constraints: list(entry, "constraints", pointer),
        requirements: list(entry, "requirements", pointer),
        extensions: extra(entry, "surfaces"),
      },
      pointer,
    );
  }
  for (const { entry, id, pointer } of found.actors) {
    const name = text(entry, "name", pointer);
    sink.add(
      "actors",
      actorKeys(name ?? id).keys[0] ?? normalizeText(id),
      {
        id,
        name: name ?? id,
        goal: text(entry, "goal", pointer),
        can: [],
        cannot: [],
        capabilities: list(entry, "capabilities", pointer),
        forbiddenActions: list(entry, "forbiddenActions", pointer),
        constraints: list(entry, "constraints", pointer),
        surfaces: list(entry, "surfaces", pointer),
        relations: list(entry, "relations", pointer),
        extensions: extra(entry, "actors"),
      },
      pointer,
    );
  }
  for (const { entry, id, pointer } of found.journeys) {
    sink.add(
      "journeys",
      id,
      {
        id,
        name: text(entry, "name", pointer),
        actor: text(entry, "actor", pointer),
        goal: text(entry, "goal", pointer),
        trigger: text(entry, "trigger", pointer),
        initialState: text(entry, "initialState", pointer),
        expectedResult: text(entry, "expectedResult", pointer),
        flows: list(entry, "flows", pointer),
        requirements: list(entry, "requirements", pointer),
        exceptions: list(entry, "exceptions", pointer),
        extensions: extra(entry, "journeys"),
      },
      pointer,
    );
  }
  for (const { entry, id, pointer } of found.flows) {
    sink.add(
      "flows",
      id,
      {
        id,
        name: text(entry, "name", pointer),
        actor: text(entry, "actor", pointer),
        purpose: text(entry, "purpose", pointer),
        trigger: text(entry, "trigger", pointer),
        preconditions: list(entry, "preconditions", pointer),
        steps: list(entry, "steps", pointer),
        decisions: list(entry, "decisions", pointer),
        alternateStates: list(entry, "alternateStates", pointer),
        errors: list(entry, "errors", pointer),
        result: text(entry, "result", pointer),
        screens: list(entry, "screens", pointer),
        requirements: list(entry, "requirements", pointer),
        extensions: extra(entry, "flows"),
      },
      pointer,
    );
  }
  for (const { entry, id, pointer } of found.screens) {
    const actions: ScreenAction[] = [];
    const rawActions = entry.actions;
    if (Array.isArray(rawActions)) {
      rawActions.forEach((action: unknown, at) => {
        if (!isRecord(action) || typeof action.label !== "string") {
          unexpected(`${pointer}/actions/${at}`, "object with a label");
          return;
        }
        const priority = PRIORITIES.find((p) => p === action.priority) ?? null;
        actions.push({ label: action.label, priority });
      });
    } else if (rawActions !== undefined) {
      unexpected(`${pointer}/actions`, "array");
    }
    const navigation = isRecord(entry.navigation) ? entry.navigation : {};
    if (entry.navigation !== undefined && !isRecord(entry.navigation)) {
      unexpected(`${pointer}/navigation`, "object");
    }
    sink.add(
      "screens",
      id,
      {
        id,
        name: text(entry, "name", pointer),
        surface: text(entry, "surface", pointer) ?? "",
        actors: list(entry, "actors", pointer),
        purpose: text(entry, "purpose", pointer),
        requirements: list(entry, "requirements", pointer),
        journeys: list(entry, "journeys", pointer),
        flows: list(entry, "flows", pointer),
        information: list(entry, "information", pointer),
        actions,
        states: list(entry, "states", pointer),
        conditions: list(entry, "conditions", pointer),
        navigation: {
          from: list(navigation, "from", `${pointer}/navigation`),
          to: list(navigation, "to", `${pointer}/navigation`),
        },
        permissions: list(entry, "permissions", pointer),
        events: list(entry, "events", pointer),
        extensions: extra(entry, "screens"),
      },
      pointer,
    );
  }
  for (const { entry, id, pointer } of found.functionalComponents) {
    sink.add(
      "functionalComponents",
      id,
      {
        id,
        name: text(entry, "name", pointer),
        responsibility: text(entry, "responsibility", pointer),
        information: list(entry, "information", pointer),
        actions: list(entry, "actions", pointer),
        states: list(entry, "states", pointer),
        screens: list(entry, "screens", pointer),
        variations: list(entry, "variations", pointer),
        extensions: extra(entry, "functionalComponents"),
      },
      pointer,
    );
  }
  for (const { entry, id, pointer } of found.patterns) {
    sink.add(
      "patterns",
      id,
      {
        id,
        name: text(entry, "name", pointer),
        purpose: text(entry, "purpose", pointer),
        screens: list(entry, "screens", pointer),
        states: list(entry, "states", pointer),
        rules: list(entry, "rules", pointer),
        requirements: list(entry, "requirements", pointer),
        extensions: extra(entry, "patterns"),
      },
      pointer,
    );
  }
  for (const { entry, id, pointer } of found.uxRequirements) {
    sink.add(
      "functionalRequirements",
      id,
      {
        id,
        text: text(entry, "statement", pointer) ?? "",
        derivedFrom: list(entry, "derivedFrom", pointer),
      },
      pointer,
    );
  }
  for (const { entry, id, pointer } of found.traceability) {
    sink.add(
      "traceability",
      id,
      {
        requirement: id,
        parts: [],
        journeys: list(entry, "journeys", pointer),
        flows: list(entry, "flows", pointer),
        screens: list(entry, "screens", pointer),
        patterns: list(entry, "patterns", pointer),
      },
      pointer,
    );
  }
  mapStates(sink, found.screens);
  mapConstraints(sink, found.surfaces, found.actors);

  const ids: UxIds = {
    actors: new Set(found.actors.map((e) => e.id)),
    surfaces: new Set(found.surfaces.map((e) => e.id)),
    journeys: new Set(found.journeys.map((e) => e.id)),
    flows: new Set(found.flows.map((e) => e.id)),
    screens: new Set(found.screens.map((e) => e.id)),
    patterns: new Set(found.patterns.map((e) => e.id)),
    uxRequirements: new Set(found.uxRequirements.map((e) => e.id)),
  };
  findings.push(...unresolvedReferences(found, ids, path));
  return {
    candidates: sink.items,
    extensions: extensionsOf(raw, KNOWN_UX_FIELDS.root),
    ids,
    findings,
  };
}

type Found = { entry: Loose; id: string; pointer: string }[];

/** One state per distinct name across screens, with the screens that declare it (not global). */
function mapStates(sink: CandidateSink, screens: Found): void {
  const states = new Map<string, { name: string; screens: string[]; pointer: string }>();
  for (const { entry, id, pointer } of screens) {
    if (!Array.isArray(entry.states)) continue;
    entry.states.forEach((state: unknown, at) => {
      if (typeof state !== "string" || state === "") return;
      const key = normalizeText(state);
      const known = states.get(key);
      if (known === undefined) {
        states.set(key, { name: state, screens: [id], pointer: `${pointer}/states/${at}` });
      } else if (!known.screens.includes(id)) {
        known.screens.push(id);
      }
    });
  }
  for (const [key, state] of states) {
    sink.add(
      "states",
      key,
      { name: state.name, global: false, screens: state.screens },
      state.pointer,
    );
  }
}

/** `constraints` of surfaces and actors become constraints of kind `surface` / `actor` about that id. */
function mapConstraints(sink: CandidateSink, surfaces: Found, actors: Found): void {
  const groups = [
    { kind: "surface", entries: surfaces },
    { kind: "actor", entries: actors },
  ] as const;
  for (const { kind, entries } of groups) {
    for (const { entry, id, pointer } of entries) {
      if (!Array.isArray(entry.constraints)) continue;
      entry.constraints.forEach((constraint: unknown, at) => {
        if (typeof constraint !== "string" || constraint === "") return;
        sink.add(
          "constraints",
          `${kind}/${id}/${normalizeText(constraint)}`,
          { kind, id: null, subject: id, text: constraint },
          `${pointer}/constraints/${at}`,
        );
      });
    }
  }
}

const REFERENCES: readonly {
  from: Collection;
  field: string;
  to: keyof UxIds;
  label: string;
}[] = [
  { from: "surfaces", field: "actors", to: "actors", label: "actor" },
  { from: "actors", field: "surfaces", to: "surfaces", label: "surface" },
  { from: "journeys", field: "actor", to: "actors", label: "actor" },
  { from: "journeys", field: "flows", to: "flows", label: "flow" },
  { from: "flows", field: "actor", to: "actors", label: "actor" },
  { from: "flows", field: "screens", to: "screens", label: "screen" },
  { from: "screens", field: "surface", to: "surfaces", label: "surface" },
  { from: "screens", field: "actors", to: "actors", label: "actor" },
  { from: "screens", field: "permissions", to: "actors", label: "actor" },
  { from: "screens", field: "journeys", to: "journeys", label: "journey" },
  { from: "screens", field: "flows", to: "flows", label: "flow" },
  { from: "functionalComponents", field: "screens", to: "screens", label: "screen" },
  { from: "patterns", field: "screens", to: "screens", label: "screen" },
  { from: "traceability", field: "journeys", to: "journeys", label: "journey" },
  { from: "traceability", field: "flows", to: "flows", label: "flow" },
  { from: "traceability", field: "screens", to: "screens", label: "screen" },
  { from: "traceability", field: "patterns", to: "patterns", label: "pattern" },
];

/** Internal references (ids of other ux.json entities) that nothing declares. Business-requirement
 * references (`RN-`, `RF-`, `P<n>`, `D<n>`) are checked against their own source elsewhere (DR4). */
function unresolvedReferences(
  found: Record<Collection, Found>,
  ids: UxIds,
  path: RelativeArtifactPath,
): Finding[] {
  const findings: Finding[] = [];
  const nav = (screen: Found[number], side: "from" | "to"): void => {
    const navigation = screen.entry.navigation;
    const targets = isRecord(navigation) ? navigation[side] : undefined;
    if (!Array.isArray(targets)) return;
    targets.forEach((target: unknown, at) => {
      if (typeof target === "string" && !ids.screens.has(target)) {
        findings.push(
          unresolved(path, `${screen.pointer}/navigation/${side}/${at}`, "screen", target),
        );
      }
    });
  };
  for (const { from, field, to, label } of REFERENCES) {
    for (const entity of found[from]) {
      const value = entity.entry[field];
      const targets = Array.isArray(value) ? value : [value];
      targets.forEach((target: unknown, at) => {
        if (typeof target === "string" && !ids[to].has(target)) {
          const pointer = Array.isArray(value)
            ? `${entity.pointer}/${field}/${at}`
            : `${entity.pointer}/${field}`;
          findings.push(unresolved(path, pointer, label, target));
        }
      });
    }
  }
  for (const screen of found.screens) {
    nav(screen, "from");
    nav(screen, "to");
  }
  return findings;
}

function unresolved(
  path: RelativeArtifactPath,
  pointer: string,
  label: string,
  id: string,
): Finding {
  return {
    code: "UX_REFERENCE_UNRESOLVED",
    severity: "warning",
    message: `${pointer}: ${label} "${id}" is not declared in ux.json.`,
    paths: [path],
    issues: [],
  };
}
