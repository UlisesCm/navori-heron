import type {
  FetchRecord,
  HeronMode,
  InputFileRecord,
  Provenance,
  ProvenanceFile,
  ResearchProvenance,
  ResearchReference,
  Sha256Hex,
} from "../../core/contracts/index.ts";
import { byIdNumber } from "../provenance.ts";

function provenanceOf(reference: ResearchReference): Provenance {
  const { capture } = reference;
  let fetch: FetchRecord | null = null;
  let file: InputFileRecord | null = null;
  let files: ProvenanceFile[] = [];
  if (capture.kind === "url" || capture.kind === "design-md") {
    const { content } = capture;
    files = [
      {
        path: content.path,
        sha256: content.sha256,
        mediaType: content.mediaType,
        trust: content.trust,
        originalSha256: null,
      },
    ];
    fetch = capture.fetch;
    file = capture.kind === "design-md" ? capture.file : null;
  } else if (capture.kind === "image") {
    const { image } = capture;
    files = [
      {
        path: image.path,
        sha256: image.sha256,
        mediaType: image.mediaType,
        trust: image.trust,
        originalSha256: image.original.sha256,
      },
    ];
    file = capture.file;
  }
  return {
    reference: reference.id,
    source: reference.source,
    origin: reference.origin,
    capturedAt: reference.capturedAt,
    mode: reference.mode,
    removed: reference.removed !== null,
    fetch,
    file,
    files,
    securityFindings: reference.securityFindings,
  };
}

/** The ledger projected from the references (removed ones flagged), by reference number. */
export function buildProvenance(
  references: readonly ResearchReference[],
  mode: HeronMode,
  referencesSha256: Sha256Hex,
): ResearchProvenance {
  return {
    kind: "ResearchProvenance",
    schemaVersion: 1,
    mode,
    references: { path: "research/references.json", sha256: referencesSha256 },
    entries: byIdNumber(references).map(provenanceOf),
  };
}
