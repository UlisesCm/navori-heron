import { join } from "node:path";
import type { FsPort, ReadonlyFs } from "./fs-port.ts";

/** Append-only line sink (ADR 0002, zone 2). `line` has no trailing newline; `write` never throws. */
export interface LogSink {
  write(line: string): void;
}

const LOG_NAME_RE = /^(\d{4}-\d{2}-\d{2})\.jsonl$/;
const DAY_MS = 86_400_000;

const dayOf = (date: Date): string => date.toISOString().slice(0, 10);
/** Epoch ms of the UTC midnight that starts the day containing `ms` (no `new Date`: dates come from ctx.clock). */
const startOfUtcDay = (ms: number): number => Math.floor(ms / DAY_MS) * DAY_MS;
const logsDir = (heronDir: string): string => join(heronDir, "logs");

function listLogs(fs: ReadonlyFs, heronDir: string): { name: string; day: string }[] {
  let names: string[];
  try {
    names = fs.readdirSync(logsDir(heronDir));
  } catch {
    return [];
  }
  const out: { name: string; day: string }[] = [];
  for (const name of names) {
    const match = LOG_NAME_RE.exec(name);
    if (match?.[1] !== undefined) out.push({ name, day: match[1] });
  }
  return out.toSorted((a, b) => a.day.localeCompare(b.day));
}

/** Deletes logs/YYYY-MM-DD.jsonl older than now - retentionDays (UTC, by name); other names untouched. */
export function pruneLogs(fs: FsPort, heronDir: string, now: Date, retentionDays: number): void {
  const cutoff = startOfUtcDay(now.getTime() - retentionDays * DAY_MS);
  for (const { name, day } of listLogs(fs, heronDir)) {
    if (Date.parse(day) >= cutoff) continue;
    try {
      fs.unlinkSync(join(logsDir(heronDir), name));
    } catch {
      // best effort
    }
  }
}

/** mkdir .heron/logs/, pruneLogs, then a sink appending `${line}\n` to logs/{UTC date}.jsonl; fs errors swallowed. */
export function openAppendLog(
  fs: FsPort,
  heronDir: string,
  now: Date,
  options: { retentionDays: number },
): LogSink {
  const dir = logsDir(heronDir);
  const file = join(dir, `${dayOf(now)}.jsonl`);
  try {
    fs.mkdirSync(dir, { recursive: true });
    pruneLogs(fs, heronDir, now, options.retentionDays);
  } catch {
    // logging must never stop a command
  }
  return {
    write(line) {
      try {
        const fd = fs.openSync(file, "a");
        try {
          const bytes = new TextEncoder().encode(`${line}\n`);
          let offset = 0;
          while (offset < bytes.length) offset += fs.writeSync(fd, bytes.subarray(offset));
        } finally {
          fs.closeSync(fd);
        }
      } catch {
        // disk full / permission: the command goes on (design §Failure modes)
      }
    },
  };
}

/** Parsed JSON objects of logs/*.jsonl whose file date is >= since (UTC day), in file then line order; unparsable lines skipped. */
export function readLogEvents(
  fs: ReadonlyFs,
  heronDir: string,
  since: Date,
): Record<string, unknown>[] {
  const from = startOfUtcDay(since.getTime());
  const events: Record<string, unknown>[] = [];
  for (const { name, day } of listLogs(fs, heronDir)) {
    if (Date.parse(day) < from) continue;
    let text: string;
    try {
      text = new TextDecoder().decode(fs.readFileSync(join(logsDir(heronDir), name)));
    } catch {
      continue;
    }
    for (const line of text.split("\n")) {
      if (line.trim() === "") continue;
      try {
        const parsed: unknown = JSON.parse(line);
        if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
          events.push(parsed as Record<string, unknown>);
        }
      } catch {
        // skip corrupt line
      }
    }
  }
  return events;
}
