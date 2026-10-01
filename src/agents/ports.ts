import type { z } from "zod";
import type {
  AgentProviderId,
  AgentTaskId,
  AgentUsage,
  PackItemKind,
  PackItemRef,
  PackTrim,
  PackTrust,
  Sha256Hex,
} from "../core/contracts/index.ts";
import type { TempDirPort } from "../core/store/temp-dir.ts";

export type JsonSchemaObject = Readonly<Record<string, unknown>>;

/** One piece of a context pack. `priority` 0 is never trimmed; `findings` is the count of stored security findings. */
export type ContextItem = {
  kind: PackItemKind;
  id: string;
  trust: PackTrust;
  priority: number;
  content: string;
  findings: number;
};
export type ContextPack = {
  task: AgentTaskId;
  budget: number;
  items: ContextItem[];
  text: string;
  sha256: Sha256Hex;
  chars: number;
  refs: PackItemRef[];
  trimmed: PackTrim[];
};

/** A `{ stop }` token is sanitized by the producer and never carries the offending line. */
export type LineVerdict = "continue" | { stop: string };
export type ProcessSpec = {
  command: string;
  args: readonly string[];
  cwd: string;
  env: Readonly<Record<string, string>>;
  stdin: string | null;
  timeoutMs: number;
  killGraceMs: number;
  maxOutputBytes: number;
  /** false: stdout only reaches onStdoutLine (or is discarded). */
  captureStdout: boolean;
  onStdoutLine?: ((line: string) => LineVerdict) | undefined;
};
export type ProcessOutcome =
  | {
      kind: "exited";
      exitCode: number | null;
      signal: string | null;
      stdout: string;
      stderrTail: string;
      durationMs: number;
    }
  | { kind: "timeout"; stderrTail: string; durationMs: number }
  | { kind: "stopped"; reason: string; durationMs: number }
  | { kind: "output-too-large"; durationMs: number }
  | { kind: "not-found"; command: string };
/** Never throws. */
export interface ProcessRunner {
  run(spec: ProcessSpec): Promise<ProcessOutcome>;
}

export type ProviderServices = {
  runner: ProcessRunner;
  temp: TempDirPort;
  env: Readonly<Record<string, string>>;
  probeTimeoutMs: number; // 4_000
  killGraceMs: number; // 3_000
};
/** basic: --version + session. full: also capabilities (--help lists every required flag). */
export type ProbeLevel = "basic" | "full";
export type ProviderProbe =
  | { status: "ready"; cliVersion: string | null; minimum: string | null }
  | {
      status: "missing" | "outdated" | "unsupported" | "logged-out" | "error";
      cliVersion: string | null;
      minimum: string | null;
      detail: string;
    };

export type AgentRequest = {
  task: AgentTaskId;
  attempt: number;
  templateId: string;
  system: string;
  pack: ContextPack;
  outputSchema: z.ZodType<unknown>;
  model: string | null;
  timeoutMs: number;
};
export type AgentAttempt =
  | {
      status: "succeeded";
      output: unknown;
      outputText: string;
      cliVersion: string | null;
      reportedModels: string[];
      usage: AgentUsage;
      exitCode: number | null;
      durationMs: number;
    }
  | {
      status: "invalid-output";
      detail: string;
      outputText: string | null;
      cliVersion: string | null;
      reportedModels: string[];
      usage: AgentUsage;
      exitCode: number | null;
      durationMs: number;
    }
  | {
      status: "timeout" | "failed" | "policy-violation" | "unavailable";
      /** Never a raw event line; redacted by the app. */
      detail: string;
      cliVersion: string | null;
      exitCode: number | null;
      signal: string | null;
      durationMs: number;
    };

export interface AgentProvider {
  readonly id: AgentProviderId;
  readonly label: string;
  /** "2.1.259" | "0.159.2" | null */
  readonly minimumVersion: string | null;
  /** Never reads credential files; never throws. */
  probe(services: ProviderServices, level: ProbeLevel): Promise<ProviderProbe>;
  /** Fresh empty cwd; never throws on hostile output. */
  invoke(request: AgentRequest, services: ProviderServices): Promise<AgentAttempt>;
}
