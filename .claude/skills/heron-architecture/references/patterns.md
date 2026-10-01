# Catálogo de patrones

Cada patrón: cuándo, canónico en P1 [E] (archivo + símbolo), esqueleto [Pn] y anti-patrones. Las rutas son anclas estables; ubica el símbolo con `locate-code`, no por línea.

## 1. Port + Adapter

Cuándo: toda fuente o efecto externo con ≥ 2 implementaciones o un doble. Canónico [E]: `src/intake/ports.ts` `ProductContextAdapter`; `src/intake/adapters/filesystem/index.ts` `filesystemAdapter`.

```ts
export interface ResearchSource {                         // [P2] src/research/ports.ts
  readonly kind: ResearchSourceKind;                      // enum completo en core/contracts
  capture(request: CaptureRequest): Promise<CaptureResult>; // nunca lanza con entrada hostil
}
export type CaptureRequest = { input: CaptureInput; services: CaptureServices; limits: InputLimits };
export const urlSource: ResearchSource;                   // src/research/adapters/url/index.ts
```

Anti-patrones: adapter que importa otro adapter; adapter que escribe archivos o lee `process.env`; el puerto dentro de `adapters/`; lanzar ante entrada hostil.

## 2. Registry de adapters (solo los disponibles)

Canónico [E]: `src/intake/detect.ts` `DEFAULT_ADAPTERS`, `detectProject` (lista ordenada, gana el primero). El enum persistido nace completo, pero el registro **nunca es exhaustivo**: lista ordenada si importa el orden, `Partial<Record>` si se elige por id.

```ts
export const RESEARCH_SOURCES: Readonly<Partial<Record<ResearchSourceKind, ResearchSource>>>; // [P2]
export function sourceFor(kind: ResearchSourceKind): ResearchSource | null; // null → ADAPTER_NOT_AVAILABLE, exit 5
```

Anti-patrones: `Record<Kind, Port>` exhaustivo (obliga a stubs antes de P6/P10); `switch` por id en `app`; `import()` por string. Solo `registry.ts` (y `detect.ts` en intake) importa `adapters/**`.

## 3. Caso de uso `run*` → `UseCaseResult`

Canónico [E]: `src/app/result.ts` `UseCaseResult`, `failure`, `makeFinding`, `storeErrorResult`; `src/app/init.ts` `runInit`.

```ts
export async function runReferencesAdd(ctx: AppContext, input: ReferencesAddInput): Promise<UseCaseResult<ReferencesAddData>>;
export async function withWriteRun<T>(ctx: AppContext, root: string, command: string,
  body: (run: WriteRun) => UseCaseResult<T>): Promise<UseCaseResult<T>>; // [pre-P2] src/app/write-run.ts
// abre store → toma lock → recoverOrphanStaging → body (síncrono: store + puro) → libera; agrega LOCK_RECLAIMED/STAGING_RECOVERED
```

Pasos largos (IA, red, Penpot): fuera del lock sobre una instantánea con `stateRevision = R`; luego `withWriteRun` relee, recalcula hechos baratos y hace commit con `expectedRevision = R`. Anti-patrones: renderizar texto en `app`; leer argv o env; un `run*` que llama a otro; `await` de red dentro de `body`; códigos numéricos.

## 4. Tabla de transiciones pura

Canónico [E]: `src/core/state/transitions.ts` `FORWARD_ROWS`, `TRANSITIONS`, `canTransition`, `applyTransition`, `TransitionFacts` (un hecho ausente cuenta como no cumplido); `gates.ts` `GATE_BINDINGS`; `stale.ts` `PHASE_ARTIFACTS`.

```ts
type Row = readonly [HeronPhase, TransitionEventKey, HeronPhase, PreconditionId];
export function canTransition(state: HeronState, event: HeronEvent, facts: TransitionFacts): TransitionCheck;
```

Anti-patrones: `switch` por fase; precondiciones que leen disco (los hechos los calcula `app`); mutar el estado.

## 5. Result/Finding en vez de throw

Tres niveles (ver SKILL.md §Convenciones). Canónico [E]: `TransitionCheck`, `HarnessReadResult<T>`, `AdapterDetection`; clases `UnsafePathError`, `LockBusyError`, `InvalidDocumentError`, `UnsupportedSchemaVersionError`, `StateRevisionConflictError` mapeadas en `storeErrorResult`.

```ts
type ReadResult<T> = { status: "ok"; value: T } | { status: "absent" } | { status: "unreadable"; finding: Finding };
```

Los emisores tipan con la unión cerrada `FindingCode`; los documentos persistidos guardan el código como string con formato (OD1-C′).

## 6. Servicios inyectados (OD4)

Canónico [E]: `src/core/store/fs-port.ts` `FsPort`, `ReadonlyFs`, `nodeFs`; `src/app/context.ts` `AppContext`, `Clock`, `IdGenerator`, `systemClock`, `createDefaultContext`; dobles `tests/helpers/cli.ts` `fixedContext`.

```ts
export interface Fetcher { fetch(request: SafeFetchRequest): Promise<SafeFetchResult> }   // [P2] src/security/fetch
export interface ProcessRunner { run(spec: ProcessSpec): Promise<ProcessOutcome> }        // [P3] src/agents/ports.ts
export interface TempDirPort { createEmpty(prefix: string): { path: string; dispose(): void } } // [P3] core/store/temp-dir.ts
export interface Logger { event(name: LogEventName, fields: LogFields): void }            // [P2] security/logger.ts
```

Adapters sin estado: los servicios llegan **en el request** (precedente `DetectRequest.fs`); las conexiones son `connect*(config, services): Promise<Session>` con `close()` en `finally`. Dirección del logger: `security` no toca fs y `core/store` no importa `security`; `app/context.ts` compone `createLogger([openAppendLog(…)], createRedactor(…), …)`. Anti-patrones: `new Date()`/`Date.now()` en dominio (solo lock vencido y duraciones); `crypto.randomUUID()` fuera de `IdGenerator`; `Logger.event` con `unknown`.

## 7. Documento Zod versionado + `gen:schemas`

Canónico [E]: `src/core/contracts/version.ts` `DocumentSpec`, `parseVersionedDocument`; `index.ts` `CONTRACT_DOCUMENTS`; `HeronState` + `HeronStateSchema` + `HERON_STATE_DOCUMENT`; `scripts/gen-schemas.ts` `generateSchemas`; `tests/repo/schemas.test.ts`.

```ts
export type ResearchReferences = { kind: "ResearchReferences"; schemaVersion: 1; references: ResearchReference[] }; // [P2]
export const ResearchReferencesSchema: z.ZodType<ResearchReferences> = z.looseObject({ /* … */ });
```

Tipo explícito + `z.ZodType<T>`. Persistido usa `z.looseObject` y `StoredFinding`; transitorio usa `z.object` y `Finding`. Sube `schemaVersion` solo por cambio de forma, con `DocumentSpec.migrations` puras (leer N-1, escribir N) desde el primer bump. Anti-patrones: `z.infer` como único tipo; `z.strictObject` en documentos propios; editar `schemas/*.json` a mano.

`CliEnvelope` crece de forma aditiva (salida transitoria, nunca se persiste): nuevos `command`, ramas de `data` y códigos entran sin bump; un cambio de forma sí pasa a v2.

## 8. Handler de CLI delgado (OD2)

Canónico [E]: `src/cli/commands/init.ts` `handleInit` → `runInit` → `buildEnvelope` | `renderInitText`; `src/cli/main.ts` `runCli`. [pre-P2] `emitResult` en `cli/output.ts`; [P2] `CommandSpec` con el primer subcomando (`references`).

```ts
export function emitResult<D>(io: CliIo, opts: { command: CliCommand; json: boolean; started: number; runId: RunId;
  render: (data: D, findings: Finding[]) => string }, result: UseCaseResult<D>): ExitCode;
export type CommandSpec = { name: string; usage: string;
  parse(argv: readonly string[], json: boolean): ParsedCommand | UsageError;
  handle(parsed: ParsedCommand, ctx: AppContext, io: CliIo): Promise<ExitCode> };
```

Anti-patrones: validar negocio en el handler; leer disco; un código distinto de `result.code`; copy que no esté en inglés. HTTP [P8]: 0→200, 1→500 genérico, 2→400, 3→409, 4→422, 5→503, 6→409.

## 9. Compilador determinista (Penpot) [P12/P6]

Contratos → `PenpotPlan` (operaciones ordenadas, ids `heron:<kind>:<id>`) → script = plantilla `@vN` + **un** literal `JSON.stringify(data)` → `PenpotSession.apply`.

```ts
export function compilePlan(input: CompileInput, synced: PenpotSyncState | null): PenpotPlan; // puro
export function renderScript(op: PenpotOp, template: TemplateRef): string;                    // puro
```

Anti-patrones: concatenar datos en el código; un script escrito por el LLM (RN-35); fechas o aleatoriedad en el plan; que el compilador consulte Penpot (el drift llega como dato).

## 10. Plantillas versionadas [P3/P12]

`prompts/<rol>/<tarea>@v<n>.md` y `templates/penpot/<op>@v<n>.penpot.js`, cargadas por import de texto (`with { type: "text" }`) desde un registro único, con el sha256 en `AgentRun`/plan. Doc: https://bun.com/docs/runtime/loaders (sección `text`, consultada 2026-09-30). `tsc` acepta `declare module "*.md"` y `"*.penpot.js"`, pero no `"*@v*.js"`. No leer plantillas con `ReadonlyFs` en runtime (rompe `bun build --compile`). Anti-patrones: prompts dentro de TS; editar una `@vN` publicada; interpolar contenido externo fuera de bloques delimitados (RN-36).

## 11. Lector anticorrupción

Canónico [E]: `src/intake/adapters/navori-master/harness.ts` `readVersioned`, `HarnessReadResult`; `src/intake/ux-contract.ts` `UX_CONTRACT_READER`. Para formatos ajenos (DESIGN.md externo, Refero, MCP): declarar solo lo que se usa (`z.looseObject`), tolerar lo desconocido, verificar versión y devolver `ReadResult`.

## 12. Fronteras como tablas (autoverificación)

[E] `tests/repo/boundaries.test.ts` `violationsFor`, `extractImports` (`loader: "ts"`), `FS_SCRIPTS`, `NON_CODE_RE`. [pre-P2] se vuelve `LAYERS`/`VENDORS`/`TOKENS` (aún no existen), cada fila con `violates`/`passes`; la autoverificación se genera desde las filas. Cross-ports: si el destino es `src/<otro>/ports.ts`, el especificador no debe aparecer en `scanImports` (omite `import type`, DP20). Prerrequisito de P8 (`.tsx`): `scripts/transpiler.ts` `transpilerFor(path)`; `loader: "ts"` lanza ante JSX, y solo cuenta un especificador que aparezca entre comillas en el fuente.
