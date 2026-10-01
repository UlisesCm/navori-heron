import { z } from "zod";
import {
  HeronModeSchema,
  IsoDateTimeSchema,
  RelativeArtifactPathSchema,
  RunIdSchema,
  Sha256HexSchema,
  StoredFindingSchema,
  type HeronMode,
  type IsoDateTime,
  type RelativeArtifactPath,
  type RunId,
  type Sha256Hex,
  type StoredFinding,
} from "./common.ts";
import {
  ADAPTER_IDS,
  STAGE_SELECTIONS,
  type AdapterId,
  type StageSelection,
} from "./heron-project.ts";
import { BRAND_KINDS, type BrandKind } from "./research.ts";
import type { DocumentSpec } from "./version.ts";

export const PRODUCT_CONTEXT_SECTIONS = [
  "product",
  "actors",
  "capabilities",
  "businessRules",
  "functionalRequirements",
  "nonFunctionalRequirements",
  "surfaces",
  "journeys",
  "flows",
  "screens",
  "states",
  "functionalComponents",
  "patterns",
  "entities",
  "constraints",
  "brand",
  "decisions",
  "traceability",
  "unresolvedQuestions",
] as const; // the 19 content sections of context/md/PLAN.md §5 (DR1)
export type ProductContextSection = (typeof PRODUCT_CONTEXT_SECTIONS)[number];

/** RN-7 order first; "manual" and "navori.config.json" never compete (DR3). */
export const SOURCE_KINDS = [
  "DECISIONS.md",
  "MASTER.md",
  "parts.json",
  "ux.json",
  "UX.md",
  "DIGEST.md",
  "CODEBASE.md",
  "context",
  "manual",
  "navori.config.json",
] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];

/** locator: "§<heading>" (inline formatting stripped) for Markdown; RFC 6901 JSON Pointer for JSON. Never a line number (DR2). */
export type SourceRef = {
  source: SourceKind;
  path: RelativeArtifactPath;
  locator: string;
};
export type Sourced = {
  sourceRef: SourceRef;
  alsoIn: SourceRef[];
  conflicts: string[];
}; // conflicts: CONFLICT ids, sorted
/** Unknown ux.json field, in source order (DR25). */
export type Extension = { key: string; value: unknown };

export const PRODUCT_FACT_KEYS = ["name", "summary", "language"] as const;
export type ProductFact = Sourced & {
  key: (typeof PRODUCT_FACT_KEYS)[number];
  value: string;
};
export type ActorElement = Sourced & {
  id: string | null;
  name: string;
  goal: string | null;
  can: string[];
  cannot: string[]; // MASTER.md "Puede"/"No puede" (or ManualContext)
  capabilities: string[];
  forbiddenActions: string[];
  constraints: string[]; // ux.json
  surfaces: string[];
  relations: string[];
  extensions: Extension[];
};
export type CapabilityElement = Sourced & {
  id: string | null;
  priority: "must" | "should" | "could";
  text: string;
};
/** businessRules: RN-n · functionalRequirements: RF-n and UX-n · nonFunctionalRequirements: RNF-n. */
export type RequirementElement = Sourced & {
  id: string;
  text: string;
  derivedFrom: string[];
};
export type SurfaceElement = Sourced & {
  id: string;
  name: string | null;
  purpose: string | null;
  actors: string[];
  capabilities: string[];
  constraints: string[];
  requirements: string[];
  extensions: Extension[];
};
export type JourneyElement = Sourced & {
  id: string;
  name: string | null;
  actor: string | null;
  goal: string | null;
  trigger: string | null;
  initialState: string | null;
  expectedResult: string | null;
  flows: string[];
  requirements: string[];
  exceptions: string[];
  extensions: Extension[];
};
export type FlowElement = Sourced & {
  id: string;
  name: string | null;
  actor: string | null;
  purpose: string | null;
  trigger: string | null;
  preconditions: string[];
  steps: string[];
  decisions: string[];
  alternateStates: string[];
  errors: string[];
  result: string | null;
  screens: string[];
  requirements: string[];
  extensions: Extension[];
};
export type ScreenAction = {
  label: string;
  priority: "primary" | "secondary" | "destructive" | null;
};
export type ScreenElement = Sourced & {
  id: string;
  name: string | null;
  surface: string;
  actors: string[];
  purpose: string | null;
  requirements: string[];
  journeys: string[];
  flows: string[];
  information: string[];
  actions: ScreenAction[];
  states: string[];
  conditions: string[];
  navigation: { from: string[]; to: string[] };
  permissions: string[];
  events: string[];
  extensions: Extension[];
};
export type StateElement = Sourced & {
  name: string;
  global: boolean;
  screens: string[];
};
export type ComponentElement = Sourced & {
  id: string;
  name: string | null;
  responsibility: string | null;
  information: string[];
  actions: string[];
  states: string[];
  screens: string[];
  variations: string[];
  extensions: Extension[];
};
export type PatternElement = Sourced & {
  id: string;
  name: string | null;
  purpose: string | null;
  screens: string[];
  states: string[];
  rules: string[];
  requirements: string[];
  extensions: Extension[];
};
export type EntityElement = Sourced & { name: string; details: string[] };
export const CONSTRAINT_KINDS = [
  "out-of-scope",
  "surface",
  "actor",
  "heron-must-preserve",
  "heron-may-improve",
  "heron-owns",
  "declared",
] as const;
export type ConstraintElement = Sourced & {
  kind: (typeof CONSTRAINT_KINDS)[number];
  id: string | null;
  subject: string | null;
  text: string;
};
export type BrandElement = Sourced & { kind: BrandKind; value: string }; // BRAND_KINDS of research.ts
export type DecisionElement = Sourced & {
  id: string;
  question: string | null;
  chosen: string | null;
  discarded: string[];
  date: string | null;
};
export type TraceabilityElement = Sourced & {
  requirement: string;
  parts: string[];
  journeys: string[];
  flows: string[];
  screens: string[];
  patterns: string[];
};
export type QuestionElement = Sourced & { text: string };

/** used: contributed ≥ 1 element · read: parsed, no element (SOURCE_NO_ELEMENTS) · unused: present but excluded by mode (D6). No sha256 (DR2). */
export type ContextSourceRecord = {
  source: SourceKind;
  path: RelativeArtifactPath;
  status: "used" | "read" | "unused" | "absent" | "unreadable";
};
export type ProductContextMetadata = {
  adapter: AdapterId;
  mode: HeronMode; // effective mode at intake (RN-5)
  stage: { dir: string; selection: StageSelection } | null;
  uxReader: "provisional-1" | null; // null when ux.json was not used
  sources: ContextSourceRecord[]; // draft order (DR3)
  uxExtensions: Extension[]; // unknown top-level ux.json keys
  findings: StoredFinding[]; // extraction findings, FINDING_CODES order then path; no line numbers
};
export type ProductContext = {
  kind: "ProductContext";
  schemaVersion: 1;
  metadata: ProductContextMetadata;
  product: ProductFact[];
  actors: ActorElement[];
  capabilities: CapabilityElement[];
  businessRules: RequirementElement[];
  functionalRequirements: RequirementElement[];
  nonFunctionalRequirements: RequirementElement[];
  surfaces: SurfaceElement[];
  journeys: JourneyElement[];
  flows: FlowElement[];
  screens: ScreenElement[];
  states: StateElement[];
  functionalComponents: ComponentElement[];
  patterns: PatternElement[];
  entities: EntityElement[];
  constraints: ConstraintElement[];
  brand: BrandElement[];
  decisions: DecisionElement[];
  traceability: TraceabilityElement[];
  unresolvedQuestions: QuestionElement[];
};
export type ProductContextSectionMap = {
  [S in ProductContextSection]: ProductContext[S][number];
};

const str = z.string();
const strList = z.array(z.string());
const optStr = z.string().nullable();

export const SourceRefSchema: z.ZodType<SourceRef> = z.looseObject({
  source: z.enum(SOURCE_KINDS),
  path: RelativeArtifactPathSchema,
  locator: str,
});
export const ExtensionSchema: z.ZodType<Extension> = z.looseObject({
  key: str,
  value: z.unknown(),
});
const sourced = {
  sourceRef: SourceRefSchema,
  alsoIn: z.array(SourceRefSchema),
  conflicts: strList,
};
const extensions = z.array(ExtensionSchema);
const requirement = z.looseObject({
  ...sourced,
  id: str,
  text: str,
  derivedFrom: strList,
});

export const ProductContextSchema: z.ZodType<ProductContext> = z.looseObject({
  kind: z.literal("ProductContext"),
  schemaVersion: z.literal(1),
  metadata: z.looseObject({
    adapter: z.enum(ADAPTER_IDS),
    mode: HeronModeSchema,
    stage: z.looseObject({ dir: str, selection: z.enum(STAGE_SELECTIONS) }).nullable(),
    uxReader: z.literal("provisional-1").nullable(),
    sources: z.array(
      z.looseObject({
        source: z.enum(SOURCE_KINDS),
        path: RelativeArtifactPathSchema,
        status: z.enum(["used", "read", "unused", "absent", "unreadable"]),
      }),
    ),
    uxExtensions: extensions,
    findings: z.array(StoredFindingSchema),
  }),
  product: z.array(z.looseObject({ ...sourced, key: z.enum(PRODUCT_FACT_KEYS), value: str })),
  actors: z.array(
    z.looseObject({
      ...sourced,
      id: optStr,
      name: str,
      goal: optStr,
      can: strList,
      cannot: strList,
      capabilities: strList,
      forbiddenActions: strList,
      constraints: strList,
      surfaces: strList,
      relations: strList,
      extensions,
    }),
  ),
  capabilities: z.array(
    z.looseObject({
      ...sourced,
      id: optStr,
      priority: z.enum(["must", "should", "could"]),
      text: str,
    }),
  ),
  businessRules: z.array(requirement),
  functionalRequirements: z.array(requirement),
  nonFunctionalRequirements: z.array(requirement),
  surfaces: z.array(
    z.looseObject({
      ...sourced,
      id: str,
      name: optStr,
      purpose: optStr,
      actors: strList,
      capabilities: strList,
      constraints: strList,
      requirements: strList,
      extensions,
    }),
  ),
  journeys: z.array(
    z.looseObject({
      ...sourced,
      id: str,
      name: optStr,
      actor: optStr,
      goal: optStr,
      trigger: optStr,
      initialState: optStr,
      expectedResult: optStr,
      flows: strList,
      requirements: strList,
      exceptions: strList,
      extensions,
    }),
  ),
  flows: z.array(
    z.looseObject({
      ...sourced,
      id: str,
      name: optStr,
      actor: optStr,
      purpose: optStr,
      trigger: optStr,
      preconditions: strList,
      steps: strList,
      decisions: strList,
      alternateStates: strList,
      errors: strList,
      result: optStr,
      screens: strList,
      requirements: strList,
      extensions,
    }),
  ),
  screens: z.array(
    z.looseObject({
      ...sourced,
      id: str,
      name: optStr,
      surface: str,
      actors: strList,
      purpose: optStr,
      requirements: strList,
      journeys: strList,
      flows: strList,
      information: strList,
      actions: z.array(
        z.looseObject({
          label: str,
          priority: z.enum(["primary", "secondary", "destructive"]).nullable(),
        }),
      ),
      states: strList,
      conditions: strList,
      navigation: z.looseObject({ from: strList, to: strList }),
      permissions: strList,
      events: strList,
      extensions,
    }),
  ),
  states: z.array(
    z.looseObject({
      ...sourced,
      name: str,
      global: z.boolean(),
      screens: strList,
    }),
  ),
  functionalComponents: z.array(
    z.looseObject({
      ...sourced,
      id: str,
      name: optStr,
      responsibility: optStr,
      information: strList,
      actions: strList,
      states: strList,
      screens: strList,
      variations: strList,
      extensions,
    }),
  ),
  patterns: z.array(
    z.looseObject({
      ...sourced,
      id: str,
      name: optStr,
      purpose: optStr,
      screens: strList,
      states: strList,
      rules: strList,
      requirements: strList,
      extensions,
    }),
  ),
  entities: z.array(z.looseObject({ ...sourced, name: str, details: strList })),
  constraints: z.array(
    z.looseObject({
      ...sourced,
      kind: z.enum(CONSTRAINT_KINDS),
      id: optStr,
      subject: optStr,
      text: str,
    }),
  ),
  brand: z.array(z.looseObject({ ...sourced, kind: z.enum(BRAND_KINDS), value: str })),
  decisions: z.array(
    z.looseObject({
      ...sourced,
      id: str,
      question: optStr,
      chosen: optStr,
      discarded: strList,
      date: optStr,
    }),
  ),
  traceability: z.array(
    z.looseObject({
      ...sourced,
      requirement: str,
      parts: strList,
      journeys: strList,
      flows: strList,
      screens: strList,
      patterns: strList,
    }),
  ),
  unresolvedQuestions: z.array(z.looseObject({ ...sourced, text: str })),
});

export const PRODUCT_CONTEXT_DOCUMENT: DocumentSpec<ProductContext> = {
  kind: "ProductContext",
  schemaVersion: 1,
  schema: ProductContextSchema,
  schemaFile: "product-context.v1.schema.json",
};

// --- Conflicts (DR3-DR5, DR26) ---

export const CONFLICT_KINDS = [
  "actor-unknown",
  "permission-contradiction",
  "value-mismatch",
  "reference-unknown",
] as const; // emitters + numbering order
export type ConflictKind = (typeof CONFLICT_KINDS)[number];
/** Persisted kind is formatted text so a new kind is not a version bump (DR26). */
export const CONFLICT_KIND_PATTERN = /^[a-z][a-z0-9-]*$/;
export type ConflictId = string; // /^CONFLICT-\d{3,}$/
export type ConflictValue = { sourceRef: SourceRef; value: string }; // "cannot: See member data", "(not declared)", …
export type ConflictAck = {
  by: string;
  at: IsoDateTime;
  note: string;
  runId: RunId;
}; // note 1..2000 chars
export type Conflict = {
  id: ConflictId;
  kind: string; // emitters use ConflictKind
  subject: string;
  status: "open" | "resolved";
  files: RelativeArtifactPath[]; // sorted, unique
  values: ConflictValue[]; // exactly 2: the contradicting pair, precedence order
  impact: string[]; // "<section>/<key>", sorted
  winner: SourceRef | null; // value-mismatch only (DR3)
  fingerprint: Sha256Hex; // DR5
  ack: ConflictAck | null;
};
export type IntakeConflicts = {
  kind: "IntakeConflicts";
  schemaVersion: 1;
  conflicts: Conflict[];
}; // sorted by id

export const ConflictIdSchema: z.ZodType<ConflictId> = z.string().regex(/^CONFLICT-\d{3,}$/);
const ConflictAckSchema: z.ZodType<ConflictAck> = z.looseObject({
  by: z.string().min(1),
  at: IsoDateTimeSchema,
  note: z.string().min(1).max(2000),
  runId: RunIdSchema,
});
export const ConflictSchema: z.ZodType<Conflict> = z.looseObject({
  id: ConflictIdSchema,
  kind: z.string().regex(CONFLICT_KIND_PATTERN),
  subject: str,
  status: z.enum(["open", "resolved"]),
  files: z.array(RelativeArtifactPathSchema),
  values: z.array(z.looseObject({ sourceRef: SourceRefSchema, value: str })).length(2),
  impact: strList,
  winner: SourceRefSchema.nullable(),
  fingerprint: Sha256HexSchema,
  ack: ConflictAckSchema.nullable(),
});
export const IntakeConflictsSchema: z.ZodType<IntakeConflicts> = z.looseObject({
  kind: z.literal("IntakeConflicts"),
  schemaVersion: z.literal(1),
  conflicts: z.array(ConflictSchema),
});
export const INTAKE_CONFLICTS_DOCUMENT: DocumentSpec<IntakeConflicts> = {
  kind: "IntakeConflicts",
  schemaVersion: 1,
  schema: IntakeConflictsSchema,
  schemaFile: "intake-conflicts.v1.schema.json",
};

// --- ManualContext (input of the manual adapter) ---

/** Input authored by the user (z.strictObject). No UX-structure sections: they only come from ux.json (RN-3). Optional keys carry `| undefined` (exactOptionalPropertyTypes). */
export type ManualContext = {
  kind: "ManualContext";
  schemaVersion: 1;
  product: { name: string; summary?: string | undefined };
  actors?:
    | {
        name: string;
        can?: string[] | undefined;
        cannot?: string[] | undefined;
      }[]
    | undefined;
  capabilities?:
    | {
        id?: string | undefined;
        priority: "must" | "should" | "could";
        text: string;
      }[]
    | undefined;
  businessRules?: { id: string; text: string }[] | undefined; // /^RN-\d+$/
  functionalRequirements?: { id: string; text: string }[] | undefined; // /^RF-\d+$/
  nonFunctionalRequirements?: { id: string; text: string }[] | undefined; // /^RNF-\d+$/
  entities?: { name: string; details?: string[] | undefined }[] | undefined;
  constraints?: { text: string }[] | undefined;
  brand?: { kind: BrandKind; value: string }[] | undefined;
  decisions?:
    | {
        id: string; // /^D\d+$/
        question?: string | undefined;
        chosen?: string | undefined;
        discarded?: string[] | undefined;
        date?: string | undefined;
      }[]
    | undefined;
  unresolvedQuestions?: { text: string }[] | undefined;
};

const idOf = (pattern: RegExp) => z.strictObject({ id: z.string().regex(pattern), text: str });
export const ManualContextSchema: z.ZodType<ManualContext> = z.strictObject({
  kind: z.literal("ManualContext"),
  schemaVersion: z.literal(1),
  product: z.strictObject({
    name: z.string().min(1),
    summary: z.string().optional(),
  }),
  actors: z
    .array(
      z.strictObject({
        name: z.string().min(1),
        can: strList.optional(),
        cannot: strList.optional(),
      }),
    )
    .optional(),
  capabilities: z
    .array(
      z.strictObject({
        id: z
          .string()
          .regex(/^[MSC]\d+$/)
          .optional(),
        priority: z.enum(["must", "should", "could"]),
        text: str,
      }),
    )
    .optional(),
  businessRules: z.array(idOf(/^RN-\d+$/)).optional(),
  functionalRequirements: z.array(idOf(/^RF-\d+$/)).optional(),
  nonFunctionalRequirements: z.array(idOf(/^RNF-\d+$/)).optional(),
  entities: z
    .array(z.strictObject({ name: z.string().min(1), details: strList.optional() }))
    .optional(),
  constraints: z.array(z.strictObject({ text: str })).optional(),
  brand: z.array(z.strictObject({ kind: z.enum(BRAND_KINDS), value: str })).optional(),
  decisions: z
    .array(
      z.strictObject({
        id: z.string().regex(/^D\d+$/),
        question: z.string().optional(),
        chosen: z.string().optional(),
        discarded: strList.optional(),
        date: z.string().optional(),
      }),
    )
    .optional(),
  unresolvedQuestions: z.array(z.strictObject({ text: str })).optional(),
});
export const MANUAL_CONTEXT_DOCUMENT: DocumentSpec<ManualContext> = {
  kind: "ManualContext",
  schemaVersion: 1,
  schema: ManualContextSchema,
  schemaFile: "manual-context.v1.schema.json",
};
