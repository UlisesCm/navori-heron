import { hostname, userInfo } from "node:os";
import { AGENT_PROVIDERS } from "../agents/registry.ts";
import { bunProcessRunner } from "../agents/process/bun-runner.ts";
import type { AgentProvider, ProcessRunner } from "../agents/ports.ts";
import type { AgentProviderId, RunId } from "../core/contracts/index.ts";
import { nodeFs, type FsPort } from "../core/store/fs-port.ts";
import {
  DEFAULT_LOCK_OPTIONS,
  defaultIsProcessAlive,
  type LockOptions,
} from "../core/store/lock.ts";
import { nodeTempDirs, type TempDirPort } from "../core/store/temp-dir.ts";
import { DEFAULT_INPUT_LIMITS, type InputLimits } from "../intake/ports.ts";
import { DEFAULT_RESEARCH_SETTINGS, type ResearchSettings } from "../research/ports.ts";
import { createSafeFetcher } from "../security/fetch/safe-fetch.ts";
import { bunTransport, systemResolver } from "../security/fetch/system.ts";
import type { Fetcher } from "../security/fetch/types.ts";
import { sharpImageSanitizer, type ImageSanitizer } from "../security/images/sanitize.ts";
import { HERON_VERSION } from "./version.ts";

export interface Clock {
  now(): Date;
}
export interface IdGenerator {
  runId(now: Date): RunId;
}
export interface IdentityProvider {
  current(): string | null;
}
export type ProcessInfo = { pid: number; hostname: string; bunVersion: string | null };

/** Everything agent tasks need from the outside world; tests inject a refusing runner and scripted providers (DR30). */
export type AgentServices = {
  runner: ProcessRunner;
  temp: TempDirPort;
  providers: Readonly<Partial<Record<AgentProviderId, AgentProvider>>>;
  probeTimeoutMs: number;
  deepTimeoutMs: number;
  killGraceMs: number;
};

export type AppContext = {
  fs: FsPort;
  clock: Clock;
  ids: IdGenerator;
  identity: IdentityProvider;
  process: ProcessInfo;
  heronVersion: string;
  isTTY: boolean;
  confirm: (question: string) => Promise<boolean>;
  lock: Omit<LockOptions, "hostname" | "now">;
  limits: InputLimits;
  /** The only way research reaches the network (SSRF-safe, injected so tests never leave the machine). */
  fetcher: Fetcher;
  images: ImageSanitizer;
  research: ResearchSettings;
  /** Parent environment, only read: agent children get an allowlisted copy (DR14). */
  env: Readonly<Record<string, string | undefined>>;
  agents: AgentServices;
  /** Days of `.heron/logs/` kept, and the window of the agent usage totals. */
  logRetentionDays: number;
  /** Base of relative `--file` paths (the process working directory). */
  cwd: string;
};

/** SOURCE_DATE_EPOCH (integer seconds) fixes now(); an invalid value is ignored. */
export function systemClock(env: Readonly<Record<string, string | undefined>>): Clock {
  const raw = env["SOURCE_DATE_EPOCH"];
  if (raw !== undefined && /^\d{1,15}$/.test(raw)) {
    const fixed = new Date(Number(raw) * 1000);
    return { now: () => new Date(fixed) };
  }
  return { now: () => new Date() };
}

/** "20260930T120000Z" from a Date. */
function basicTimestamp(now: Date): string {
  return now
    .toISOString()
    .replace(/\.\d{3}Z$/, "Z")
    .replaceAll(/[-:]/g, "");
}

export function randomRunIds(): IdGenerator {
  return {
    runId(now: Date): RunId {
      const suffix = crypto.randomUUID().replaceAll("-", "").slice(0, 8);
      return `run-${basicTimestamp(now)}-${suffix}`;
    },
  };
}

export function createDefaultContext(io: {
  isTTY: boolean;
  readLine: () => Promise<string | null>;
}): AppContext {
  return {
    fs: nodeFs,
    clock: systemClock(process.env),
    ids: randomRunIds(),
    identity: {
      current: (): string | null => {
        const name = userInfo().username.trim();
        return name === "" ? null : name;
      },
    },
    process: { pid: process.pid, hostname: hostname(), bunVersion: process.versions.bun ?? null },
    heronVersion: HERON_VERSION,
    isTTY: io.isTTY,
    confirm: async (question: string): Promise<boolean> => {
      process.stdout.write(question);
      const answer = await io.readLine();
      return answer !== null && ["y", "yes"].includes(answer.trim().toLowerCase());
    },
    lock: { ...DEFAULT_LOCK_OPTIONS, isProcessAlive: defaultIsProcessAlive },
    limits: DEFAULT_INPUT_LIMITS,
    fetcher: createSafeFetcher({
      resolver: systemResolver,
      transport: bunTransport,
      userAgent: `Heron/${HERON_VERSION}`,
    }),
    images: sharpImageSanitizer,
    research: DEFAULT_RESEARCH_SETTINGS,
    env: { ...process.env },
    agents: {
      runner: bunProcessRunner,
      temp: nodeTempDirs,
      providers: AGENT_PROVIDERS,
      probeTimeoutMs: 4_000,
      deepTimeoutMs: 60_000,
      killGraceMs: 3_000,
    },
    logRetentionDays: 30,
    cwd: process.cwd(),
  };
}
