import {
  BRAND_INPUTS_DOCUMENT,
  ExitCode,
  type BoundArtifact,
  type BrandAddData,
  type BrandInput,
  type BrandInputDraft,
  type BrandInputs,
  type HeronMode,
  type RelativeArtifactPath,
} from "../core/contracts/index.ts";
import { recordCommand, withArtifacts } from "../core/state/lifecycle.ts";
import { nextBrandInputId, validateBrandInput } from "../research/brand.ts";
import { captureImageFile, type ImageCapture } from "../research/image-file.ts";
import { RESEARCH_FILES } from "../research/layout.ts";
import { loadWorkspace, type Workspace } from "./workspace.ts";
import type { AppContext } from "./context.ts";
import { captureFailureResult } from "./references.ts";
import { readResearch, stageResearchOutputs } from "./research-store.ts";
import { failure, makeFinding, storeErrorResult, type UseCaseResult } from "./result.ts";
import { withWriteRun, type WriteBodyResult } from "./write-run.ts";

export type BrandAddInput = { path: string; input: BrandInputDraft };

const RESEARCH_REASON = "An upstream research artifact changed.";

/** DR2 over brand inputs: reference-only if any input was captured in reference-only; none -> the current mode. */
function brandMode(inputs: readonly BrandInput[], current: HeronMode): HeronMode {
  if (inputs.length === 0) return current;
  return inputs.some((input) => input.mode === "reference-only") ? "reference-only" : "full";
}

function invalidBrand<T>(detail: string): UseCaseResult<T> {
  return failure(
    ExitCode.Usage,
    makeFinding(
      "BRAND_INPUT_INVALID",
      "error",
      `Invalid brand input: ${detail}. Nothing was written.`,
    ),
  );
}

/** validate (exit 2) -> loadWorkspace (R) -> optional captureImageFile(brand/assets) outside the lock -> withWriteRun(R):
 * derivedFrom must be an active reference (BRAND_INPUT_INVALID) -> brand.json + views -> recordCommand + withArtifacts.
 * Any phase: brand.json is not bound to a gate. */
export async function runBrandAdd(
  ctx: AppContext,
  input: BrandAddInput,
): Promise<UseCaseResult<BrandAddData>> {
  const valid = validateBrandInput(input.input);
  if (!valid.ok) {
    return failure(ExitCode.Usage, {
      ...makeFinding("BRAND_INPUT_INVALID", "error", valid.message),
      issues: valid.issues,
    });
  }
  const brand = valid.value;
  let ws: Workspace;
  try {
    const loaded = loadWorkspace(ctx, input.path);
    if (!loaded.ok) return loaded.result;
    ws = loaded.workspace;
  } catch (error) {
    const mapped = storeErrorResult<BrandAddData>(error);
    if (mapped === null) throw error;
    return mapped;
  }
  let image: ImageCapture | null = null;
  if (brand.file !== null) {
    const captured = await captureImageFile({
      services: { fetcher: ctx.fetcher, images: ctx.images, fs: ctx.fs, root: ws.root },
      file: { path: brand.file, base: ctx.cwd, allowExternal: true },
      limits: ctx.research,
      assetsDir: RESEARCH_FILES.brandAssets,
    });
    if (!captured.ok) return captureFailureResult(captured.failure);
    image = captured.capture;
  }
  const { root } = ws;
  return withWriteRun(
    ctx,
    root,
    {
      path: input.path,
      command: "brand add",
      create: false,
      requireState: true,
      expectedRevision: ws.state.stateRevision,
    },
    ({ store, tx, previous, meta }): WriteBodyResult<BrandAddData> => {
      if (previous === null) throw new Error("withWriteRun requireState guarantees state.json");
      const research = readResearch(store);
      const references = research.references?.references ?? [];
      if (
        brand.derivedFrom !== null &&
        !references.some(
          (reference) => reference.id === brand.derivedFrom && reference.removed === null,
        )
      ) {
        return {
          kind: "skip",
          result: invalidBrand(`${brand.derivedFrom} is not an active reference`),
        };
      }
      const existing = research.brand?.inputs ?? [];
      const added: BrandInput = {
        id: nextBrandInputId(existing),
        kind: brand.kind,
        origin: brand.origin,
        value: brand.value,
        note: brand.note,
        derivedFrom: brand.derivedFrom,
        image: image?.image ?? null,
        file: image?.record ?? null,
        capturedAt: meta.at,
        mode: ws.mode,
      };
      const inputs = [...existing, added];
      const document: BrandInputs = {
        kind: "BrandInputs",
        schemaVersion: 1,
        mode: brandMode(inputs, ws.mode),
        inputs,
      };
      const written: RelativeArtifactPath[] = [];
      const bound: BoundArtifact[] = [];
      if (image !== null) {
        const { file } = image;
        bound.push({ path: file.path, sha256: file.sha256 });
        if (store.sha256(file.path) !== file.sha256) {
          tx.put(file.path, file.bytes);
          written.push(file.path);
        }
      }
      bound.push({
        path: RESEARCH_FILES.brand,
        sha256: tx.putDocument(RESEARCH_FILES.brand, BRAND_INPUTS_DOCUMENT, document),
      });
      written.push(RESEARCH_FILES.brand);
      const staged = stageResearchOutputs(tx, store, {
        references,
        brand: inputs,
        currentMode: ws.mode,
        locale: ws.project.product?.locale ?? null,
        minimum: ctx.research.minReferences,
      });
      for (const output of staged.outputs) if (output.written) written.push(output.path);
      const state = withArtifacts(
        recordCommand(previous, meta),
        [...bound, ...staged.artifacts],
        RESEARCH_REASON,
      );
      return {
        kind: "commit",
        state,
        data: { input: added, stateRevision: state.stateRevision, written: written.toSorted() },
        findings: [],
        next: [`heron status ${input.path}`],
      };
    },
  );
}
