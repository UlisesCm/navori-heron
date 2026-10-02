import { z } from "zod";
import { AgentRunRefSchema, type AgentRunRef } from "./agents.ts";
import {
  HeronModeSchema,
  IsoDateTimeSchema,
  Sha256HexSchema,
  type HeronMode,
  type IsoDateTime,
  type Sha256Hex,
} from "./common.ts";
import { ReferenceIdSchema, type ReferenceId } from "./research.ts";
import type { DocumentSpec } from "./version.ts";

export const RESEARCH_FACETS = [
  "product-category",
  "flow",
  "screen-type",
  "ux-pattern",
  "ui-element",
  "visual-style",
  "density",
  "content-strategy",
  "navigation",
] as const;
export type ResearchFacet = (typeof RESEARCH_FACETS)[number];
export type QueryId = string; // /^Q-[0-9a-f]{8}$/ (DR28)
export const QueryIdSchema: z.ZodType<QueryId> = z.string().regex(/^Q-[0-9a-f]{8}$/);
export const DIRECTION_IDS = ["DIR-A", "DIR-B", "DIR-C"] as const;
export type DirectionId = (typeof DIRECTION_IDS)[number];
export const PALETTE_PAIR_USAGES = [
  "body-text",
  "large-text",
  "ui-component",
  "focus-indicator",
] as const;
export type PalettePairUsage = (typeof PALETTE_PAIR_USAGES)[number];
export const PALETTE_ROLES = [
  "background",
  "surface",
  "text",
  "text-muted",
  "primary",
  "on-primary",
  "accent",
  "border",
  "feedback",
] as const;
export type PaletteRole = (typeof PALETTE_ROLES)[number];
export const BASIC_COMPONENT_KINDS = [
  "button",
  "text-input",
  "card",
  "badge",
  "navigation",
  "list-item",
  "tabs",
  "dialog",
  "toggle",
  "avatar",
] as const;
export type BasicComponentKind = (typeof BASIC_COMPONENT_KINDS)[number];
export const COMPOSITION_NODE_TYPES = [
  "frame",
  "stack",
  "grid",
  "component",
  "text",
  "image",
  "slot",
] as const;
export type CompositionNodeType = (typeof COMPOSITION_NODE_TYPES)[number];
export type ContrastResult = { ratio: number; threshold: number; passes: boolean };

// ---- Agent outputs (transient; z.strictObject, every key required, nullable instead of optional; DR13) ----
export type BriefQueryOutput = {
  facet: ResearchFacet;
  job: string; // 1..200
  query: string; // 1..120
  question: string; // 1..300
  rationale: string; // 1..300
};
export type ResearchBriefOutput = { queries: BriefQueryOutput[] }; // 3..20
export type AnalysisObservationOutput = { aspect: string; note: string }; // 1..80, 1..500
export type ReferenceAnalysisOutput = {
  reference: ReferenceId;
  observations: AnalysisObservationOutput[]; // 1..8
  facets: ResearchFacet[]; // 1..9 unique
  suggestedDoNotCopy: string[]; // 0..8, each 1..200; never merged into human doNotCopy
  answersQueries: QueryId[]; // 0..20
};
export type ResearchAnalysisOutput = { analyses: ReferenceAnalysisOutput[] }; // 1..50
export type DirectionReferenceOutput = {
  reference: ReferenceId;
  takes: string[]; // 1..5
  doNotCopy: string[]; // 1..5
};
/** The 13 attributes of the design brief. Strings 1..400; lists 1..5 items of 1..300. */
export type DirectionAttributes = {
  personality: string;
  density: string;
  surfaceTreatment: string;
  typographyStrategy: string;
  colorStrategy: string;
  imageryStrategy: string;
  navigationCharacter: string;
  componentWeight: string;
  motionCharacter: string;
  references: DirectionReferenceOutput[]; // 2..6
  risks: string[];
  whenItFits: string[];
  whenItDoesnt: string[];
};
export type PaletteColorOutput = {
  id: string; // ^c[1-9][0-9]?$
  name: string; // 1..40
  hex: string; // ^#[0-9A-Fa-f]{6}$ (DR33)
  role: PaletteRole;
};
export type ContrastPairOutput = {
  foreground: string;
  background: string;
  usage: PalettePairUsage;
};
export type FontFamilyOutput = {
  role: "display" | "text" | "mono";
  family: string; // 1..60
  fallback: string[]; // 1..4
};
export type TypeStepOutput = {
  id: string; // ^t[1-9][0-9]?$
  name: string;
  sizePx: number; // 8..128
  lineHeight: number; // 1..2
  weight: number; // 100..900 step 100
  usage: string;
};
export type ComponentSpecOutput = {
  kind: BasicComponentKind;
  variant: string;
  fill: string;
  text: string;
  typeStep: string;
  radiusPx: number; // 0..32
  notes: string;
};
export type CompositionNodeOutput = {
  id: string; // ^n[0-9]{1,2}$
  parent: string | null;
  type: CompositionNodeType;
  direction: "row" | "column" | null;
  columns: number | null; // 1..6
  fill: string | null;
  typeStep: string | null;
  component: number | null; // index into componentSheet
  text: string | null; // <= 120, SYNTHETIC
  imageHint: string | null; // <= 120
};
export type VisualProposalOutput = {
  palette: { colors: PaletteColorOutput[]; pairs: ContrastPairOutput[] }; // 4..12, 2..12
  typeScale: { families: FontFamilyOutput[]; steps: TypeStepOutput[] }; // 1..3, 4..10
  componentSheet: ComponentSpecOutput[]; // 4..10
  composition: { title: string; description: string; nodes: CompositionNodeOutput[] }; // 1..60
};
export type VisualDirectionOutput = {
  id: DirectionId;
  name: string; // 1..60
  summary: string; // 1..400
  attributes: DirectionAttributes;
  proposal: VisualProposalOutput;
};
export type DirectionProposalOutput = { directions: VisualDirectionOutput[] }; // exactly 3
export type ProbeOutput = { status: "ok"; facets: ResearchFacet[] }; // 1..2

const FacetSchema = z.enum(RESEARCH_FACETS);
const text = (max: number): z.ZodString => z.string().min(1).max(max);
const list = (max: number, itemMax: number): z.ZodArray<z.ZodString> =>
  z.array(text(itemMax)).min(1).max(max);

export const BRIEF_QUERY_MAX_LENGTH = 120;

const BriefQueryOutputSchema: z.ZodType<BriefQueryOutput> = z.strictObject({
  facet: FacetSchema,
  job: text(200),
  query: text(BRIEF_QUERY_MAX_LENGTH),
  question: text(300),
  rationale: text(300),
});
export const ResearchBriefOutputSchema: z.ZodType<ResearchBriefOutput> = z.strictObject({
  queries: z.array(BriefQueryOutputSchema).min(3).max(20),
});

const ReferenceAnalysisOutputSchema: z.ZodType<ReferenceAnalysisOutput> = z.strictObject({
  reference: ReferenceIdSchema,
  observations: z
    .array(z.strictObject({ aspect: text(80), note: text(500) }))
    .min(1)
    .max(8),
  facets: z
    .array(FacetSchema)
    .min(1)
    .max(9)
    .refine((f) => new Set(f).size === f.length, { message: "facets must be unique" }),
  suggestedDoNotCopy: z.array(text(200)).max(8),
  answersQueries: z.array(QueryIdSchema).max(20),
});
export const ResearchAnalysisOutputSchema: z.ZodType<ResearchAnalysisOutput> = z.strictObject({
  analyses: z.array(ReferenceAnalysisOutputSchema).min(1).max(50),
});

const DirectionReferenceOutputSchema: z.ZodType<DirectionReferenceOutput> = z.strictObject({
  reference: ReferenceIdSchema,
  takes: list(5, 300),
  doNotCopy: list(5, 300),
});
const DirectionAttributesSchema: z.ZodType<DirectionAttributes> = z.strictObject({
  personality: text(400),
  density: text(400),
  surfaceTreatment: text(400),
  typographyStrategy: text(400),
  colorStrategy: text(400),
  imageryStrategy: text(400),
  navigationCharacter: text(400),
  componentWeight: text(400),
  motionCharacter: text(400),
  references: z.array(DirectionReferenceOutputSchema).min(2).max(6),
  risks: list(5, 300),
  whenItFits: list(5, 300),
  whenItDoesnt: list(5, 300),
});
const PaletteColorOutputSchema: z.ZodType<PaletteColorOutput> = z.strictObject({
  id: z.string().regex(/^c[1-9][0-9]?$/),
  name: text(40),
  hex: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
  role: z.enum(PALETTE_ROLES),
});
const ContrastPairOutputSchema: z.ZodType<ContrastPairOutput> = z.strictObject({
  foreground: z.string().min(1),
  background: z.string().min(1),
  usage: z.enum(PALETTE_PAIR_USAGES),
});
const FontFamilyOutputSchema: z.ZodType<FontFamilyOutput> = z.strictObject({
  role: z.enum(["display", "text", "mono"]),
  family: text(60),
  fallback: z.array(text(60)).min(1).max(4),
});
const TypeStepOutputSchema: z.ZodType<TypeStepOutput> = z.strictObject({
  id: z.string().regex(/^t[1-9][0-9]?$/),
  name: text(40),
  sizePx: z.number().min(8).max(128),
  lineHeight: z.number().min(1).max(2),
  weight: z
    .number()
    .int()
    .min(100)
    .max(900)
    .refine((w) => w % 100 === 0, { message: "weight must be a multiple of 100" }),
  usage: text(200),
});
const ComponentSpecOutputSchema: z.ZodType<ComponentSpecOutput> = z.strictObject({
  kind: z.enum(BASIC_COMPONENT_KINDS),
  variant: text(60),
  fill: z.string().min(1),
  text: z.string().min(1),
  typeStep: z.string().min(1),
  radiusPx: z.number().min(0).max(32),
  notes: z.string().max(300),
});
const CompositionNodeOutputSchema: z.ZodType<CompositionNodeOutput> = z.strictObject({
  id: z.string().regex(/^n[0-9]{1,2}$/),
  parent: z.string().nullable(),
  type: z.enum(COMPOSITION_NODE_TYPES),
  direction: z.enum(["row", "column"]).nullable(),
  columns: z.number().int().min(1).max(6).nullable(),
  fill: z.string().nullable(),
  typeStep: z.string().nullable(),
  component: z.number().int().min(0).nullable(),
  text: z.string().max(120).nullable(),
  imageHint: z.string().max(120).nullable(),
});
const TypeScaleOutputSchema = z.strictObject({
  families: z.array(FontFamilyOutputSchema).min(1).max(3),
  steps: z.array(TypeStepOutputSchema).min(4).max(10),
});
const CompositionOutputSchema = z.strictObject({
  title: text(120),
  description: text(400),
  nodes: z.array(CompositionNodeOutputSchema).min(1).max(60),
});
const VisualProposalOutputSchema: z.ZodType<VisualProposalOutput> = z.strictObject({
  palette: z.strictObject({
    colors: z.array(PaletteColorOutputSchema).min(4).max(12),
    pairs: z.array(ContrastPairOutputSchema).min(2).max(12),
  }),
  typeScale: TypeScaleOutputSchema,
  componentSheet: z.array(ComponentSpecOutputSchema).min(4).max(10),
  composition: CompositionOutputSchema,
});
const VisualDirectionOutputSchema: z.ZodType<VisualDirectionOutput> = z.strictObject({
  id: z.enum(DIRECTION_IDS),
  name: text(60),
  summary: text(400),
  attributes: DirectionAttributesSchema,
  proposal: VisualProposalOutputSchema,
});
export const DirectionProposalOutputSchema: z.ZodType<DirectionProposalOutput> = z.strictObject({
  directions: z.array(VisualDirectionOutputSchema).length(3),
});
export const ProbeOutputSchema: z.ZodType<ProbeOutput> = z.strictObject({
  status: z.literal("ok"),
  facets: z.array(FacetSchema).min(1).max(2),
});

// ---- Persisted documents (z.looseObject) ----
export type BriefQuery = {
  id: QueryId;
  facet: ResearchFacet;
  job: string;
  query: string;
  question: string | null;
  rationale: string | null;
  origin: "provided" | "inferred";
};
/** "provided" queries (accumulated, DR27) first, then "inferred"; each group by id. */
export type ResearchBrief = {
  kind: "ResearchBrief";
  schemaVersion: 1;
  mode: HeronMode;
  briefedAt: IsoDateTime;
  run: AgentRunRef;
  queries: BriefQuery[];
};
export type ReferenceAnalysis = ReferenceAnalysisOutput & {
  referenceSha256: Sha256Hex;
  inputKey: Sha256Hex; // analysisInputKey (DR39)
  analyzedAt: IsoDateTime;
  run: AgentRunRef;
  origin: "inferred";
};
export type ResearchAnalysis = {
  kind: "ResearchAnalysis";
  schemaVersion: 1;
  mode: HeronMode;
  analyses: ReferenceAnalysis[]; // by reference id number
};
export type ContrastPair = ContrastPairOutput & { contrast: ContrastResult };
export type VisualProposal = Omit<VisualProposalOutput, "palette"> & {
  marking: "SYNTHETIC";
  palette: { colors: PaletteColorOutput[]; pairs: ContrastPair[] }; // hex upper-cased
};
export type VisualDirection = Omit<VisualDirectionOutput, "proposal"> & {
  proposal: VisualProposal;
  origin: "inferred";
};
export type DirectionSelection = {
  direction: DirectionId;
  status: "preferred" | "selected";
  decidedBy: string;
  decidedAt: IsoDateTime;
  note: string | null;
  stateRevision: number;
};
export type VisualDirections = {
  kind: "VisualDirections";
  schemaVersion: 1;
  mode: HeronMode; // "reference-only" in P3 (DR3)
  proposedAt: IsoDateTime;
  run: AgentRunRef;
  basis: { references: ReferenceId[]; brief: Sha256Hex | null; analysis: Sha256Hex | null };
  directions: VisualDirection[]; // exactly 3
  selection: DirectionSelection | null;
};

const BriefQuerySchema: z.ZodType<BriefQuery> = z.looseObject({
  id: QueryIdSchema,
  facet: FacetSchema,
  job: text(200),
  query: text(BRIEF_QUERY_MAX_LENGTH),
  question: z.string().nullable(),
  rationale: z.string().nullable(),
  origin: z.enum(["provided", "inferred"]),
});
export const ResearchBriefSchema: z.ZodType<ResearchBrief> = z.looseObject({
  kind: z.literal("ResearchBrief"),
  schemaVersion: z.literal(1),
  mode: HeronModeSchema,
  briefedAt: IsoDateTimeSchema,
  run: AgentRunRefSchema,
  queries: z.array(BriefQuerySchema),
});
export const RESEARCH_BRIEF_DOCUMENT: DocumentSpec<ResearchBrief> = {
  kind: "ResearchBrief",
  schemaVersion: 1,
  schema: ResearchBriefSchema,
  schemaFile: "research-brief.v1.schema.json",
};

const ReferenceAnalysisSchema: z.ZodType<ReferenceAnalysis> = z.looseObject({
  reference: ReferenceIdSchema,
  observations: z.array(z.looseObject({ aspect: text(80), note: text(500) })).min(1),
  facets: z.array(FacetSchema).min(1),
  suggestedDoNotCopy: z.array(z.string()),
  answersQueries: z.array(QueryIdSchema),
  referenceSha256: Sha256HexSchema,
  inputKey: Sha256HexSchema,
  analyzedAt: IsoDateTimeSchema,
  run: AgentRunRefSchema,
  origin: z.literal("inferred"),
});
export const ResearchAnalysisSchema: z.ZodType<ResearchAnalysis> = z.looseObject({
  kind: z.literal("ResearchAnalysis"),
  schemaVersion: z.literal(1),
  mode: HeronModeSchema,
  analyses: z.array(ReferenceAnalysisSchema),
});
export const RESEARCH_ANALYSIS_DOCUMENT: DocumentSpec<ResearchAnalysis> = {
  kind: "ResearchAnalysis",
  schemaVersion: 1,
  schema: ResearchAnalysisSchema,
  schemaFile: "research-analysis.v1.schema.json",
};

const ContrastPairSchema: z.ZodType<ContrastPair> = z.looseObject({
  foreground: z.string().min(1),
  background: z.string().min(1),
  usage: z.enum(PALETTE_PAIR_USAGES),
  contrast: z.looseObject({
    ratio: z.number().min(1),
    threshold: z.number().min(1),
    passes: z.boolean(),
  }),
});
const VisualProposalSchema: z.ZodType<VisualProposal> = z.looseObject({
  marking: z.literal("SYNTHETIC"),
  palette: z.looseObject({
    colors: z.array(PaletteColorOutputSchema),
    pairs: z.array(ContrastPairSchema),
  }),
  typeScale: TypeScaleOutputSchema,
  componentSheet: z.array(ComponentSpecOutputSchema),
  composition: CompositionOutputSchema,
});
const VisualDirectionSchema: z.ZodType<VisualDirection> = z.looseObject({
  id: z.enum(DIRECTION_IDS),
  name: text(60),
  summary: text(400),
  attributes: DirectionAttributesSchema,
  proposal: VisualProposalSchema,
  origin: z.literal("inferred"),
});
export const DirectionSelectionSchema: z.ZodType<DirectionSelection> = z.looseObject({
  direction: z.enum(DIRECTION_IDS),
  status: z.enum(["preferred", "selected"]),
  decidedBy: z.string().min(1),
  decidedAt: IsoDateTimeSchema,
  note: z.string().nullable(),
  stateRevision: z.number().int().min(1),
});
export const VisualDirectionsSchema: z.ZodType<VisualDirections> = z.looseObject({
  kind: z.literal("VisualDirections"),
  schemaVersion: z.literal(1),
  mode: HeronModeSchema,
  proposedAt: IsoDateTimeSchema,
  run: AgentRunRefSchema,
  basis: z.looseObject({
    references: z.array(ReferenceIdSchema),
    brief: Sha256HexSchema.nullable(),
    analysis: Sha256HexSchema.nullable(),
  }),
  directions: z.array(VisualDirectionSchema).length(3),
  selection: DirectionSelectionSchema.nullable(),
});
export const VISUAL_DIRECTIONS_DOCUMENT: DocumentSpec<VisualDirections> = {
  kind: "VisualDirections",
  schemaVersion: 1,
  schema: VisualDirectionsSchema,
  schemaFile: "visual-directions.v1.schema.json",
};
