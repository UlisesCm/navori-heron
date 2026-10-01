import type {
  ActorElement,
  ManualContext,
  RelativeArtifactPath,
} from "../../../core/contracts/index.ts";
import { candidateSink } from "../../candidates.ts";
import { createDraftKit } from "../../draft-kit.ts";
import { detectSelected, parseManualContext } from "../../inputs.ts";
import type { AdapterLoadResult, LoadRequest, ProductContextAdapter } from "../../ports.ts";
import { probeFile } from "../../probe.ts";
import { actorKeys, normalizeText } from "../../text.ts";

const keyOfName = (name: string): string => actorKeys(name).keys[0] ?? normalizeText(name);
const PRIORITY_LETTER = { must: "M", should: "S", could: "C" } as const;

/** One candidate per element of a validated `ManualContext`; locators are JSON Pointers. */
function manualCandidates(context: ManualContext, path: RelativeArtifactPath) {
  const sink = candidateSink({ source: "manual", path });
  const { product } = context;
  sink.add("product", "name", { key: "name", value: product.name }, "/product/name");
  if (product.summary !== undefined && product.summary !== "") {
    sink.add("product", "summary", { key: "summary", value: product.summary }, "/product/summary");
  }
  context.actors?.forEach((actor, i) => {
    const value: Omit<ActorElement, "sourceRef" | "alsoIn" | "conflicts"> = {
      id: null,
      name: actor.name,
      goal: null,
      can: actor.can ?? [],
      cannot: actor.cannot ?? [],
      capabilities: [],
      forbiddenActions: [],
      constraints: [],
      surfaces: [],
      relations: [],
      extensions: [],
    };
    sink.add("actors", keyOfName(actor.name), value, `/actors/${i}`);
  });
  context.capabilities?.forEach((capability, i) => {
    const { id, priority, text } = capability;
    sink.add(
      "capabilities",
      id ?? `${PRIORITY_LETTER[priority]}/${normalizeText(text)}`,
      { id: id ?? null, priority, text },
      `/capabilities/${i}`,
    );
  });
  for (const section of [
    "businessRules",
    "functionalRequirements",
    "nonFunctionalRequirements",
  ] as const) {
    context[section]?.forEach(({ id, text }, i) => {
      sink.add(section, id, { id, text, derivedFrom: [] }, `/${section}/${i}`);
    });
  }
  context.entities?.forEach(({ name, details }, i) => {
    sink.add("entities", keyOfName(name), { name, details: details ?? [] }, `/entities/${i}`);
  });
  context.constraints?.forEach(({ text }, i) => {
    sink.add(
      "constraints",
      normalizeText(text),
      { kind: "declared", id: null, subject: null, text },
      `/constraints/${i}`,
    );
  });
  context.brand?.forEach(({ kind, value }, i) => {
    sink.add("brand", `${kind}/${normalizeText(value)}`, { kind, value }, `/brand/${i}`);
  });
  context.decisions?.forEach((decision, i) => {
    sink.add(
      "decisions",
      decision.id,
      {
        id: decision.id,
        question: decision.question ?? null,
        chosen: decision.chosen ?? null,
        discarded: decision.discarded ?? [],
        date: decision.date ?? null,
      },
      `/decisions/${i}`,
    );
  });
  context.unresolvedQuestions?.forEach(({ text }, i) => {
    sink.add("unresolvedQuestions", normalizeText(text), { text }, `/unresolvedQuestions/${i}`);
  });
  return sink.items;
}

/** Sources, in selection order: each `--context` JSON file as a `ManualContext`. A file that is gone or
 * unsafe is reported and skipped; one that no longer validates fails with CONTEXT_INPUT_INVALID (the
 * selection was validated at `init`). Always reference-only (DR22). */
function loadManual(request: LoadRequest): AdapterLoadResult {
  const kit = createDraftKit(request);
  for (const path of request.selection?.inputs ?? []) {
    const probe = probeFile(request.fs, request.root, path, request.limits);
    const record = (status: "absent" | "unreadable" | "read") =>
      ({ source: "manual", path, status }) as const;
    if (probe.finding !== null) {
      kit.findings.push(probe.finding);
      kit.take(record("unreadable"), null);
      continue;
    }
    if (probe.bytes === null) {
      kit.take(record("absent"), null);
      continue;
    }
    const parsed = parseManualContext(probe.bytes);
    if (!parsed.ok) {
      const n = parsed.issues.length;
      return {
        ok: false,
        code: "CONTEXT_INPUT_INVALID",
        message: `${path} is not a valid ManualContext (${n} ${n === 1 ? "issue" : "issues"}); nothing was written.`,
        findings: [
          {
            code: "CONTEXT_INPUT_INVALID",
            severity: "error",
            message: `${path} is not a valid ManualContext.`,
            paths: [path],
            issues: parsed.issues,
          },
        ],
      };
    }
    kit.take(record("read"), { candidates: manualCandidates(parsed.value, path), findings: [] });
  }
  return kit.finish();
}

/** Explicit selection only (`heron init --adapter manual --context <file>...`). */
export const manualAdapter: ProductContextAdapter = {
  id: "manual",
  detect: (request) => detectSelected("manual", request),
  load: loadManual,
};
