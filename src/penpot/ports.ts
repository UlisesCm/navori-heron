import type { ReviewPage } from "./compiler/nodes.ts";
import type { InspectedFile, WrittenPage } from "./results.ts";

export type PenpotFailureKind =
  | "unreachable"
  | "rejected"
  | "incompatible"
  | "plugin-not-connected"
  | "timeout"
  | "script-failed";
export type PenpotFailure = { kind: PenpotFailureKind; detail: string };
export type PenpotExecution =
  | { ok: true; text: string; durationMs: number }
  | { ok: false; failure: PenpotFailure; durationMs: number };
/** One execute_code call; transport errors are redacted and returned, never thrown. */
export interface PenpotCodeRunner {
  execute(code: string, timeoutMs: number): Promise<PenpotExecution>;
  close(): Promise<void>;
}
export type PenpotConnectRequest = {
  baseUrl: string;
  key: string;
  timeoutMs: number;
  clientVersion: string;
  redact: (text: string) => string;
};
export type PenpotConnectOutcome =
  | { ok: true; runner: PenpotCodeRunner; server: { name: string; version: string } | null }
  | { ok: false; failure: PenpotFailure; durationMs: number };
/** Initialize and verify execute_code; no file mutation, never throws. */
export interface PenpotGateway {
  readonly id: "mcp";
  connect(request: PenpotConnectRequest): Promise<PenpotConnectOutcome>;
}
export type SessionResult<T> = { ok: true; value: T } | { ok: false; failure: PenpotFailure };
export interface PenpotSession {
  inspect(timeoutMs: number): Promise<SessionResult<InspectedFile>>;
  apply(
    page: ReviewPage,
    targetPageId: string | null,
    timeoutMs: number,
  ): Promise<SessionResult<WrittenPage>>;
  close(): Promise<void>;
}
