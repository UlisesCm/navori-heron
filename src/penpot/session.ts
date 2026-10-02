import { z } from "zod";
import { renderScript, reviewScriptData } from "./compiler/script.ts";
import { penpotTemplate, type PenpotTemplate } from "./compiler/templates.ts";
import { InspectedFileSchema, WrittenPageSchema } from "./results.ts";
import type {
  PenpotCodeRunner,
  PenpotConnectRequest,
  PenpotFailure,
  PenpotGateway,
  PenpotSession,
  SessionResult,
} from "./ports.ts";

const envelopeSchema = z.object({ result: z.unknown(), log: z.string() });
/** The plugin returns {result, log:string}; never expose raw logs or Zod errors (untrusted text). */
export function parseExecuteText<T>(text: string, schema: z.ZodType<T>): SessionResult<T> {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return {
      ok: false,
      failure: {
        kind: "incompatible",
        detail: "execute_code did not return a JSON result envelope.",
      },
    };
  }
  const envelope = envelopeSchema.safeParse(raw);
  if (!envelope.success || !Object.hasOwn(envelope.data, "result"))
    return {
      ok: false,
      failure: {
        kind: "incompatible",
        detail: "execute_code returned an invalid result envelope.",
      },
    };
  const parsed = schema.safeParse(envelope.data.result);
  return parsed.success
    ? { ok: true, value: parsed.data }
    : {
        ok: false,
        failure: {
          kind: "incompatible",
          detail: "execute_code result does not match the requested template.",
        },
      };
}
const CONFLICT_DETAIL =
  "another write to this page ran at the same time; run heron penpot sync again once Penpot is idle";
function session(runner: PenpotCodeRunner): PenpotSession {
  const execute = async <T>(
    template: PenpotTemplate,
    data: unknown,
    schema: z.ZodType<T>,
    timeoutMs: number,
  ): Promise<SessionResult<T>> => {
    const script = renderScript(template, data);
    if (!script.ok)
      return {
        ok: false,
        failure: {
          kind: "script-failed",
          detail: `Penpot script exceeds the 32768-byte budget (${script.bytes} bytes).`,
        },
      };
    const result = await runner.execute(script.code, timeoutMs);
    return result.ok
      ? parseExecuteText(result.text, schema)
      : { ok: false, failure: result.failure };
  };
  return {
    inspect: (timeoutMs) => execute(penpotTemplate("inspect"), {}, InspectedFileSchema, timeoutMs),
    async apply(page, targetPageId, timeoutMs) {
      const result = await execute(
        penpotTemplate("review-page", page.template.version),
        reviewScriptData(page, targetPageId),
        WrittenPageSchema.refine(
          (value) => value.heron === `review-page@v${page.template.version}`,
        ),
        timeoutMs,
      );
      return result.ok && result.value.outcome === "conflict"
        ? { ok: false, failure: { kind: "script-failed", detail: CONFLICT_DETAIL } }
        : result;
    },
    close: () => runner.close(),
  };
}
export async function openPenpotSession(
  gateway: PenpotGateway,
  request: PenpotConnectRequest,
): Promise<
  | { ok: true; session: PenpotSession; server: { name: string; version: string } | null }
  | { ok: false; failure: PenpotFailure }
> {
  const connected = await gateway.connect(request);
  return connected.ok
    ? { ok: true, session: session(connected.runner), server: connected.server }
    : { ok: false, failure: connected.failure };
}
