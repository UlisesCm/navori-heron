import { REDACTED, isSecretName } from "./redact.ts";
import type { Redactor } from "./redact.ts";

export const LOG_EVENT_NAMES = ["agent.invocation", "security.finding"] as const;
export type LogEventName = (typeof LOG_EVENT_NAMES)[number];
export type LogFields = Readonly<Record<string, string | number | boolean | null>>;

export interface Logger {
  event(name: LogEventName, fields: LogFields): void;
}

/** Compact, key-sorted single-line JSON; non-finite numbers become null; `__proto__` stays a plain key. */
function compactLine(fields: Readonly<Record<string, string | number | boolean | null>>): string {
  const out: Record<string, string | number | boolean | null> = {};
  for (const key of Object.keys(fields).toSorted()) {
    const value = fields[key] as string | number | boolean | null;
    Object.defineProperty(out, key, {
      value: typeof value === "number" && !Number.isFinite(value) ? null : value,
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  return JSON.stringify(out);
}

/**
 * line = redactor.redact(compact key-sorted JSON of { at, event, ...fields }).text, one line without "\n", written to
 * each sink; a throwing sink is ignored and event() never throws (a fixed line is logged if serialization fails).
 * String values under secret-looking keys are masked by key; everything is then masked by value.
 * Never touches the filesystem: sinks are injected.
 */
export function createLogger(
  sinks: readonly { write(line: string): void }[],
  redactor: Redactor,
  clock: { now(): Date },
): Logger {
  return {
    event(name, fields) {
      let line: string;
      try {
        const safe: Record<string, string | number | boolean | null> = {};
        for (const [key, value] of Object.entries(fields)) {
          Object.defineProperty(safe, key, {
            value: typeof value === "string" && isSecretName(key) ? REDACTED : value,
            enumerable: true,
            writable: true,
            configurable: true,
          });
        }
        // reserved keys last so a field can never forge the timestamp or the event name
        line = redactor.redact(
          compactLine({ ...safe, at: clock.now().toISOString(), event: name }),
        ).text;
      } catch {
        line = JSON.stringify({ event: "logger.serialization_failed" });
      }
      for (const sink of sinks) {
        try {
          sink.write(line);
        } catch {
          // a failing sink never breaks the command (best effort, DR16)
        }
      }
    },
  };
}

export const nullLogger: Logger = { event() {} };
