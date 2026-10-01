import { z } from "zod";
import {
  HeronModeSchema,
  IsoDateTimeSchema,
  RelativeArtifactPathSchema,
  Sha256HexSchema,
  type HeronMode,
  type IsoDateTime,
  type RelativeArtifactPath,
  type Sha256Hex,
} from "./common.ts";
import type { DocumentSpec } from "./version.ts";

export const RESEARCH_SOURCE_KINDS = [
  "manual",
  "url",
  "image",
  "design-md",
  "penpot", // P6
  "refero", // P10
] as const;
export type ResearchSourceKind = (typeof RESEARCH_SOURCE_KINDS)[number];
export const CAPTURE_METHODS = ["file", "screenshot"] as const;
export type CaptureMethod = (typeof CAPTURE_METHODS)[number];
export const IMAGE_MEDIA_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;
export type ImageMediaType = (typeof IMAGE_MEDIA_TYPES)[number];
export const METADATA_BLOCKS = ["exif", "gps", "xmp", "iptc", "icc"] as const;
export type MetadataBlock = (typeof METADATA_BLOCKS)[number];
/** Closed on purpose: exported to dist/ in P5. */
export const SECURITY_FINDING_CODES = [
  "SUSPICIOUS_INSTRUCTION",
  "HIDDEN_TEXT",
  "METADATA_REMOVED",
  "LOCAL_TARGET_ALLOWED",
] as const;
export type SecurityFindingCode = (typeof SECURITY_FINDING_CODES)[number];
/** The 11 brand input kinds of MASTER section 12. */
export const BRAND_KINDS = [
  "logo",
  "brand-color",
  "secondary-color",
  "font",
  "brand-guidelines",
  "screenshot",
  "url",
  "existing-product",
  "competitor",
  "liked-reference",
  "disliked-reference",
] as const;
export type BrandKind = (typeof BRAND_KINDS)[number];
export const BRAND_ORIGINS = ["provided", "derived", "inferred", "reference-derived"] as const; // RN-14
export type BrandOrigin = (typeof BRAND_ORIGINS)[number];

export type ReferenceId = string; // /^REF-[1-9][0-9]{0,5}$/
export type BrandInputId = string; // /^BRAND-[1-9][0-9]{0,5}$/
export const ReferenceIdSchema: z.ZodType<ReferenceId> = z.string().regex(/^REF-[1-9][0-9]{0,5}$/);
export const BrandInputIdSchema: z.ZodType<BrandInputId> = z
  .string()
  .regex(/^BRAND-[1-9][0-9]{0,5}$/);

/** Pixel rectangle of the sanitized (auto-oriented) image; integers, width/height >= 1. */
export type Crop = { x: number; y: number; width: number; height: number; note: string }; // note 1..500 chars
export type SecurityFinding = {
  code: SecurityFindingCode;
  severity: "info" | "warning"; // SUSPICIOUS_INSTRUCTION, HIDDEN_TEXT: warning; METADATA_REMOVED, LOCAL_TARGET_ALLOWED: info
  message: string; // English, deterministic
  path: RelativeArtifactPath | null; // stored file (relative to .heron/) the finding points into
  offset: number | null; // UTF-16 index into new TextDecoder("utf-8").decode(file)
  line: number | null; // 1-based
  phrase: string | null; // matched text (<= 200 chars), "U+202E", address, or "exif,gps"
  rule: string | null; // InstructionRuleId, or AddressRange for LOCAL_TARGET_ALLOWED
};
export type ImageAsset = {
  path: RelativeArtifactPath; // "research/assets/{sha256}.webp" | "brand/assets/{sha256}.webp"
  sha256: Sha256Hex; // of the stored WebP bytes
  mediaType: "image/webp";
  width: number;
  height: number; // after EXIF orientation
  bytes: number;
  trust: "untrusted";
  original: { sha256: Sha256Hex; mediaType: ImageMediaType; bytes: number };
  removedMetadata: MetadataBlock[]; // METADATA_BLOCKS order; blocks present in the original and not copied
};
export type ExternalContent = {
  path: RelativeArtifactPath; // "research/sources/{sha256}.md" | "research/sources/{sha256}.txt"
  sha256: Sha256Hex; // of the stored bytes (= received bytes)
  mediaType: string; // "type/subtype", lower case, without parameters
  bytes: number;
  trust: "untrusted";
};
export type FetchRecord = {
  requestedUrl: string; // redactUrl
  finalUrl: string; // redactUrl
  status: number;
  redirects: string[]; // redactUrl of each followed Location, in order (<= 3)
  address: string; // IP connected on the final hop
  local: boolean; // final address is local and --allow-local authorized it
};
export type InputFileRecord = { name: string; location: "repo" | "external" }; // basename only (D28), never a path
export type ReferenceCapture =
  | { kind: "manual" }
  | { kind: "url"; fetch: FetchRecord; content: ExternalContent }
  | { kind: "image"; method: CaptureMethod; file: InputFileRecord; image: ImageAsset }
  | {
      kind: "design-md";
      fetch: FetchRecord | null;
      file: InputFileRecord | null;
      content: ExternalContent;
    }; // exactly one of fetch/file
export type ReferenceRemoval = { at: IsoDateTime; reason: string | null };
export type ResearchReference = {
  id: ReferenceId;
  source: ResearchSourceKind; // === capture.kind
  origin: string; // URL (redacted) or free text, 1..2048 chars
  capturedAt: IsoDateTime;
  mode: HeronMode; // effective mode when captured (RN-5)
  reason: string; // 1..2000
  studies: string[]; // 1..20 items, each 1..500, trimmed, unique (case-insensitive)
  doNotCopy: string[]; // idem
  influences: string[]; // idem
  capture: ReferenceCapture;
  crops: Crop[]; // 0..20; only when capture.kind === "image"
  securityFindings: SecurityFinding[];
  removed: ReferenceRemoval | null;
};
export type ResearchReferences = {
  kind: "ResearchReferences";
  schemaVersion: 1;
  mode: HeronMode;
  references: ResearchReference[]; // by id number
};
export type ProvenanceFile = {
  path: RelativeArtifactPath;
  sha256: Sha256Hex;
  mediaType: string;
  trust: "untrusted";
  originalSha256: Sha256Hex | null;
};
export type Provenance = {
  reference: ReferenceId;
  source: ResearchSourceKind;
  origin: string;
  capturedAt: IsoDateTime;
  mode: HeronMode;
  removed: boolean;
  fetch: FetchRecord | null;
  file: InputFileRecord | null; // local input file (basename + location), never its path
  files: ProvenanceFile[]; // by path
  securityFindings: SecurityFinding[];
};
export type ResearchProvenance = {
  kind: "ResearchProvenance";
  schemaVersion: 1;
  mode: HeronMode;
  references: { path: "research/references.json"; sha256: Sha256Hex }; // file this ledger was derived from
  entries: Provenance[]; // by reference id number
};
export type BrandInput = {
  id: BrandInputId;
  kind: BrandKind;
  origin: BrandOrigin;
  value: string; // 1..2000
  note: string | null; // 1..2000 when present
  derivedFrom: ReferenceId | null; // required iff origin === "reference-derived"
  image: ImageAsset | null; // --file, under brand/assets/
  file: InputFileRecord | null; // basename + location of --file (D28)
  capturedAt: IsoDateTime;
  mode: HeronMode;
};
/** `mode`: same rule as researchMode (DR2) over inputs[].mode. */
export type BrandInputs = {
  kind: "BrandInputs";
  schemaVersion: 1;
  mode: HeronMode;
  inputs: BrandInput[];
};

// Inputs (CLI, batch, web in P8). Raw values; validated by research/provenance.ts and research/brand.ts.
export type CropInput = { x: number; y: number; width: number; height: number; note: string };
export type ReferenceInput = {
  source: string | null;
  origin: string | null;
  reason: string | null;
  studies: string[];
  doNotCopy: string[];
  influences: string[];
  file: string | null;
  url: string | null;
  screenshot: boolean;
  allowLocal: boolean;
  crops: CropInput[];
};
/** No `allowLocal` (DR20). Optional keys carry `| undefined` because of exactOptionalPropertyTypes + Zod output. */
export type ReferenceBatchItem = {
  source?: string | undefined;
  origin?: string | undefined;
  reason?: string | undefined;
  studies?: string[] | undefined;
  doNotCopy?: string[] | undefined;
  influences?: string[] | undefined;
  file?: string | undefined;
  url?: string | undefined;
  screenshot?: boolean | undefined;
  crops?: CropInput[] | undefined;
};
export type ReferenceBatch = {
  kind: "ReferenceBatch";
  schemaVersion: 1;
  references: ReferenceBatchItem[];
};
export type BrandInputDraft = {
  kind: string | null;
  origin: string | null;
  value: string | null;
  file: string | null;
  reference: string | null;
  note: string | null;
};

/** Upper bound of ReferenceBatch.references (R8 batch import). */
export const MAX_BATCH_REFERENCES = 200;
const MAX_LIST_ITEMS = 20;

const text = (max: number): z.ZodString => z.string().min(1).max(max);
const sourceKind = z.enum(RESEARCH_SOURCE_KINDS);

/** 1..20 items, each 1..500 chars, trimmed, unique case-insensitively. */
const ListSchema: z.ZodType<string[]> = z
  .array(text(500))
  .min(1)
  .max(MAX_LIST_ITEMS)
  .refine((items) => items.every((item) => item === item.trim()), {
    message: "items must be trimmed",
  })
  .refine((items) => new Set(items.map((item) => item.toLowerCase())).size === items.length, {
    message: "items must be unique (case-insensitive)",
  });

export const CropSchema: z.ZodType<Crop> = z.looseObject({
  x: z.number().int().min(0),
  y: z.number().int().min(0),
  width: z.number().int().min(1),
  height: z.number().int().min(1),
  note: text(500),
});
export const SecurityFindingSchema: z.ZodType<SecurityFinding> = z.looseObject({
  code: z.enum(SECURITY_FINDING_CODES),
  severity: z.enum(["info", "warning"]),
  message: z.string(),
  path: RelativeArtifactPathSchema.nullable(),
  offset: z.number().int().min(0).nullable(),
  line: z.number().int().min(1).nullable(),
  phrase: z.string().max(200).nullable(),
  rule: z.string().nullable(),
});
const original = z.looseObject({
  sha256: Sha256HexSchema,
  mediaType: z.enum(IMAGE_MEDIA_TYPES),
  bytes: z.number().int().min(0),
});
export const ImageAssetSchema: z.ZodType<ImageAsset> = z.looseObject({
  path: RelativeArtifactPathSchema,
  sha256: Sha256HexSchema,
  mediaType: z.literal("image/webp"),
  width: z.number().int().min(1),
  height: z.number().int().min(1),
  bytes: z.number().int().min(0),
  trust: z.literal("untrusted"),
  original,
  removedMetadata: z.array(z.enum(METADATA_BLOCKS)),
});
export const ExternalContentSchema: z.ZodType<ExternalContent> = z.looseObject({
  path: RelativeArtifactPathSchema,
  sha256: Sha256HexSchema,
  mediaType: z.string().min(1),
  bytes: z.number().int().min(0),
  trust: z.literal("untrusted"),
});
export const FetchRecordSchema: z.ZodType<FetchRecord> = z.looseObject({
  requestedUrl: z.string(),
  finalUrl: z.string(),
  status: z.number().int(),
  redirects: z.array(z.string()).max(3),
  address: z.string(),
  local: z.boolean(),
});
/** name 1..255, no control characters, no "/" or "\\". */
export const InputFileRecordSchema: z.ZodType<InputFileRecord> = z.looseObject({
  name: z
    .string()
    .min(1)
    .max(255)
    .refine(
      (name) => ![...name].some((ch) => ch < " " || ch === "\x7f" || ch === "/" || ch === "\\"),
      {
        message: "must not contain control characters, '/' or '\\'",
      },
    ),
  location: z.enum(["repo", "external"]),
});

const CaptureSchema: z.ZodType<ReferenceCapture> = z
  .discriminatedUnion("kind", [
    z.looseObject({ kind: z.literal("manual") }),
    z.looseObject({
      kind: z.literal("url"),
      fetch: FetchRecordSchema,
      content: ExternalContentSchema,
    }),
    z.looseObject({
      kind: z.literal("image"),
      method: z.enum(CAPTURE_METHODS),
      file: InputFileRecordSchema,
      image: ImageAssetSchema,
    }),
    z.looseObject({
      kind: z.literal("design-md"),
      fetch: FetchRecordSchema.nullable(),
      file: InputFileRecordSchema.nullable(),
      content: ExternalContentSchema,
    }),
  ])
  .refine(
    (capture) =>
      capture.kind !== "design-md" || (capture.fetch === null) !== (capture.file === null),
    {
      message: "design-md needs exactly one of fetch or file",
    },
  );

/** superRefine: source === capture.kind; crops only for image captures and inside width x height. */
export const ResearchReferenceSchema: z.ZodType<ResearchReference> = z
  .looseObject({
    id: ReferenceIdSchema,
    source: sourceKind,
    origin: text(2048),
    capturedAt: IsoDateTimeSchema,
    mode: HeronModeSchema,
    reason: text(2000),
    studies: ListSchema,
    doNotCopy: ListSchema,
    influences: ListSchema,
    capture: CaptureSchema,
    crops: z.array(CropSchema).max(MAX_LIST_ITEMS),
    securityFindings: z.array(SecurityFindingSchema),
    removed: z.looseObject({ at: IsoDateTimeSchema, reason: z.string().nullable() }).nullable(),
  })
  .superRefine((reference, ctx) => {
    if (reference.source !== reference.capture.kind) {
      ctx.addIssue({ code: "custom", path: ["source"], message: "must equal capture.kind" });
    }
    if (reference.capture.kind !== "image") {
      if (reference.crops.length > 0) {
        ctx.addIssue({ code: "custom", path: ["crops"], message: "crops need an image capture" });
      }
      return;
    }
    const { width, height } = reference.capture.image;
    reference.crops.forEach((crop, index) => {
      if (crop.x + crop.width > width || crop.y + crop.height > height) {
        ctx.addIssue({
          code: "custom",
          path: ["crops", index],
          message: "falls outside the image",
        });
      }
    });
  });
export const ResearchReferencesSchema: z.ZodType<ResearchReferences> = z.looseObject({
  kind: z.literal("ResearchReferences"),
  schemaVersion: z.literal(1),
  mode: HeronModeSchema,
  references: z.array(ResearchReferenceSchema),
});
const ProvenanceFileSchema: z.ZodType<ProvenanceFile> = z.looseObject({
  path: RelativeArtifactPathSchema,
  sha256: Sha256HexSchema,
  mediaType: z.string().min(1),
  trust: z.literal("untrusted"),
  originalSha256: Sha256HexSchema.nullable(),
});
export const ProvenanceSchema: z.ZodType<Provenance> = z.looseObject({
  reference: ReferenceIdSchema,
  source: sourceKind,
  origin: text(2048),
  capturedAt: IsoDateTimeSchema,
  mode: HeronModeSchema,
  removed: z.boolean(),
  fetch: FetchRecordSchema.nullable(),
  file: InputFileRecordSchema.nullable(),
  files: z.array(ProvenanceFileSchema),
  securityFindings: z.array(SecurityFindingSchema),
});
export const ResearchProvenanceSchema: z.ZodType<ResearchProvenance> = z.looseObject({
  kind: z.literal("ResearchProvenance"),
  schemaVersion: z.literal(1),
  mode: HeronModeSchema,
  references: z.looseObject({
    path: z.literal("research/references.json"),
    sha256: Sha256HexSchema,
  }),
  entries: z.array(ProvenanceSchema),
});
/** superRefine: derivedFrom if and only if origin is reference-derived. */
export const BrandInputSchema: z.ZodType<BrandInput> = z
  .looseObject({
    id: BrandInputIdSchema,
    kind: z.enum(BRAND_KINDS),
    origin: z.enum(BRAND_ORIGINS),
    value: text(2000),
    note: text(2000).nullable(),
    derivedFrom: ReferenceIdSchema.nullable(),
    image: ImageAssetSchema.nullable(),
    file: InputFileRecordSchema.nullable(),
    capturedAt: IsoDateTimeSchema,
    mode: HeronModeSchema,
  })
  .superRefine((input, ctx) => {
    if ((input.origin === "reference-derived") !== (input.derivedFrom !== null)) {
      ctx.addIssue({
        code: "custom",
        path: ["derivedFrom"],
        message: "required if and only if origin is reference-derived",
      });
    }
  });
export const BrandInputsSchema: z.ZodType<BrandInputs> = z.looseObject({
  kind: z.literal("BrandInputs"),
  schemaVersion: z.literal(1),
  mode: HeronModeSchema,
  inputs: z.array(BrandInputSchema),
});

// Entry document (not owned by Heron): strict at every level so a typo such as "doNotcopy" fails (DR20).
const CropInputSchema: z.ZodType<CropInput> = z.strictObject({
  x: z.number().int(),
  y: z.number().int(),
  width: z.number().int(),
  height: z.number().int(),
  note: z.string(),
});
const ReferenceBatchItemSchema: z.ZodType<ReferenceBatchItem> = z.strictObject({
  source: z.string().optional(),
  origin: z.string().optional(),
  reason: z.string().optional(),
  studies: z.array(z.string()).optional(),
  doNotCopy: z.array(z.string()).optional(),
  influences: z.array(z.string()).optional(),
  file: z.string().optional(),
  url: z.string().optional(),
  screenshot: z.boolean().optional(),
  crops: z.array(CropInputSchema).optional(),
});
export const ReferenceBatchSchema: z.ZodType<ReferenceBatch> = z.strictObject({
  kind: z.literal("ReferenceBatch"),
  schemaVersion: z.literal(1),
  references: z.array(ReferenceBatchItemSchema).max(MAX_BATCH_REFERENCES),
});

export const RESEARCH_REFERENCES_DOCUMENT: DocumentSpec<ResearchReferences> = {
  kind: "ResearchReferences",
  schemaVersion: 1,
  schema: ResearchReferencesSchema,
  schemaFile: "research-references.v1.schema.json",
};
export const RESEARCH_PROVENANCE_DOCUMENT: DocumentSpec<ResearchProvenance> = {
  kind: "ResearchProvenance",
  schemaVersion: 1,
  schema: ResearchProvenanceSchema,
  schemaFile: "research-provenance.v1.schema.json",
};
export const BRAND_INPUTS_DOCUMENT: DocumentSpec<BrandInputs> = {
  kind: "BrandInputs",
  schemaVersion: 1,
  schema: BrandInputsSchema,
  schemaFile: "brand-inputs.v1.schema.json",
};
export const REFERENCE_BATCH_DOCUMENT: DocumentSpec<ReferenceBatch> = {
  kind: "ReferenceBatch",
  schemaVersion: 1,
  schema: ReferenceBatchSchema,
  schemaFile: "reference-batch.v1.schema.json",
};
