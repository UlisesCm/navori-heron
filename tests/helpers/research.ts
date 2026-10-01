import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { ResearchReference } from "../../src/core/contracts/index.ts";
import { nodeFs, type ReadonlyFs } from "../../src/core/store/fs-port.ts";
import {
  DEFAULT_RESEARCH_SETTINGS,
  type CaptureLimits,
  type CaptureRequest,
  type CaptureServices,
  type InputFileRef,
} from "../../src/research/ports.ts";
import { createSafeFetcher } from "../../src/security/fetch/safe-fetch.ts";
import type { SanitizeResult, ImageSanitizer } from "../../src/security/images/sanitize.ts";
import type {
  Fetcher,
  ResolvedAddress,
  Resolver,
  Transport,
  TransportRequest,
  TransportResponse,
} from "../../src/security/fetch/types.ts";

/** A complete manual reference (all provenance fields present); `overrides` replaces any field. */
export function sampleReference(overrides: Partial<ResearchReference> = {}): ResearchReference {
  return {
    id: "REF-1",
    source: "manual",
    origin: "Linear pricing page",
    capturedAt: "2026-09-30T12:00:00.000Z",
    mode: "reference-only",
    reason: "Shows a calm pricing table",
    studies: ["table density"],
    doNotCopy: ["brand colors"],
    influences: ["plan comparison layout"],
    capture: { kind: "manual" },
    crops: [],
    securityFindings: [],
    removed: null,
    ...overrides,
  };
}

/** Resolved addresses from plain IP texts (family inferred). */
export const addrs = (...texts: string[]): ResolvedAddress[] =>
  texts.map((address) => ({ address, family: address.includes(":") ? 6 : 4 }));

/** Resolver double: `table[host]` lists the answer of each successive lookup (the last one repeats); a string answer
 * throws an error with that `code`. Unknown hosts throw ENOTFOUND. `calls` records every looked-up host. */
export function fakeResolver(
  table: Record<string, readonly ResolvedAddress[][] | string>,
): Resolver & { readonly calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    resolve: async (hostname) => {
      calls.push(hostname);
      const answers = table[hostname];
      if (answers === undefined || typeof answers === "string") {
        throw Object.assign(new Error("dns"), { code: answers ?? "ENOTFOUND" });
      }
      const seen = calls.filter((call) => call === hostname).length;
      return answers[Math.min(seen, answers.length) - 1] ?? [];
    },
  };
}

/** A transport reply: a partial response (defaults: 200 text/html "ok"), an Error to throw, or "hang" until aborted. */
export type TransportReply = Partial<TransportResponse> | Error | "hang";

/** Transport double that records every request and never touches the network. */
export function recordingTransport(
  reply: TransportReply | ((request: TransportRequest, index: number) => TransportReply) = {},
): Transport & { readonly calls: TransportRequest[] } {
  const calls: TransportRequest[] = [];
  return {
    calls,
    send: async (request, signal) => {
      const index = calls.length;
      calls.push(request);
      const next = typeof reply === "function" ? reply(request, index) : reply;
      if (next === "hang") {
        return new Promise<TransportResponse>((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
        });
      }
      if (next instanceof Error) throw next;
      return {
        status: 200,
        location: null,
        contentType: "text/html",
        body: new TextEncoder().encode("ok"),
        overflow: false,
        ...next,
      };
    },
  };
}

/** Filesystem double for adapters that must not touch the disk: any call throws. */
export const noIoFs: ReadonlyFs = {
  existsSync: () => {
    throw new Error("unexpected I/O");
  },
  lstatSync: () => {
    throw new Error("unexpected I/O");
  },
  realpathSync: () => {
    throw new Error("unexpected I/O");
  },
  readFileSync: () => {
    throw new Error("unexpected I/O");
  },
  readdirSync: () => {
    throw new Error("unexpected I/O");
  },
};

export const LIMITS: CaptureLimits = {
  maxTextBytes: DEFAULT_RESEARCH_SETTINGS.maxTextBytes,
  maxImageBytes: DEFAULT_RESEARCH_SETTINGS.maxImageBytes,
  maxImagePixels: DEFAULT_RESEARCH_SETTINGS.maxImagePixels,
};

/** A real SSRF-safe fetcher over doubles: `example.com` resolves to a public address; no network. */
export function fakeFetcher(
  reply: Parameters<typeof recordingTransport>[0] = {},
  table: Parameters<typeof fakeResolver>[0] = { "example.com": [addrs("93.184.216.34")] },
): Fetcher & { readonly transport: ReturnType<typeof recordingTransport> } {
  const transport = recordingTransport(reply);
  const fetcher = createSafeFetcher({
    resolver: fakeResolver(table),
    transport,
    userAgent: "Heron/test",
  });
  return { fetch: fetcher.fetch, transport };
}

/** Sanitizer double returning `result`; records the bytes it received. */
export function stubSanitizer(
  result: SanitizeResult,
): ImageSanitizer & { readonly seen: Uint8Array[] } {
  const seen: Uint8Array[] = [];
  return {
    seen,
    sanitize: async (bytes) => {
      seen.push(bytes);
      return result;
    },
  };
}

export const okImage = (
  overrides: Partial<Extract<SanitizeResult, { ok: true }>["image"]> = {},
): SanitizeResult => ({
  ok: true,
  image: {
    bytes: new Uint8Array([1, 2, 3, 4]),
    width: 1440,
    height: 900,
    original: { mediaType: "image/png", bytes: 8 },
    removedMetadata: [],
    ...overrides,
  },
});

/** Capture services over doubles; `root` is the realpath of the product repo (default: no repo, I/O forbidden). */
export function captureServices(overrides: Partial<CaptureServices> = {}): CaptureServices {
  return {
    fetcher: fakeFetcher(),
    images: stubSanitizer(okImage()),
    fs: noIoFs,
    root: "/repo",
    ...overrides,
  };
}

export const captureRequest = (
  input: CaptureRequest["input"],
  services: CaptureServices,
): CaptureRequest => ({ input, services, limits: LIMITS });

/** A temp product repo plus a sibling directory outside it; both are realpaths. Callers remove `dirs` after each test. */
export function tempRepo(dirs: string[]): {
  root: string;
  outside: string;
  write: (dir: "root" | "outside", name: string, data: string | Uint8Array) => string;
  services: (overrides?: Partial<CaptureServices>) => CaptureServices;
  ref: (path: string, allowExternal?: boolean) => InputFileRef;
} {
  const parent = mkdtempSync(join(tmpdir(), "heron-research-"));
  dirs.push(parent);
  const root = join(realpathSync(parent), "repo");
  const outside = join(realpathSync(parent), "outside");
  mkdirSync(root);
  mkdirSync(outside);
  return {
    root,
    outside,
    write: (dir, name, data) => {
      const path = join(dir === "root" ? root : outside, name);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, data);
      return path;
    },
    services: (overrides = {}) => captureServices({ fs: nodeFs, root, ...overrides }),
    ref: (path, allowExternal = true) => ({ path, base: root, allowExternal }),
  };
}
