---
name: heron-architecture
description: Use when deciding where code goes in Heron, how to add a CLI command, contract, adapter, port, fixture or gate, what a module may import, or which naming, error, determinism, lock or testing convention applies. Architecture rules and recipes for navori-heron. Not for product requirements (use specs/) or boundary test internals.
metadata:
  type: reference
  maxWords: 1000 # reference cap is 500; single rulebook for every part P2-P12 (body ~946 words), detail lives in references/
---

# heron-architecture

Fuente: `.navori/state/handoffs/solution_architecture-conventions.md` (veredicto CONCERNS revisado; decisiones OD1=C′, OD2, OD3, OD4). Las reglas ejecutables viven **solo** en `tests/repo/boundaries.test.ts` (D4, DP20); esta skill las explica, no las reemplaza. Marca: **[E]** existe hoy · **[Pn]** planeado en la parte n · **[pre-P2]** cambio previo a P2.

## Estilo

Núcleo funcional, cáscara imperativa; puertos y adapters; casos de uso compartidos por CLI y web (DP1); lectores anticorrupción; documentos versionados con commit atómico; reglas como datos (tablas).

**Regla de una línea:** `bin → cli|web → app → (dominio puro | puertos→adapters) → core/contracts`; solo `core/store` toca el filesystem.

Por qué: lo determinista va en código y la IA solo interpreta (RN-35); el mismo `run*` y el mismo lock sirven a CLI y web (MASTER Arquitectura 9); export idéntico byte a byte (RNF-2).

## Reglas de dependencia

`STORE_READ` (alias de documentación, no un símbolo) = API de store de solo lectura: `src/core/store/{fs-port,paths,hash}.ts` [E]. Entre módulos de dominio solo `import type` del `ports.ts` ajeno; la composición vive en `app`. Nadie importa `navori*` (RN-1). Tabla completa por módulo: [references/layout.md](references/layout.md) §Dependencias.

| Módulo | Puede importar | Vendor/efecto permitido |
|---|---|---|
| `core/contracts` | hermanos | solo `zod` |
| `core/state` | `core/contracts` | ningún bare, sin `Bun` |
| `core/store` | `core/contracts` | `node:fs`, `node:path`, `node:crypto` |
| `security` [P2] | `core/contracts` | `fetch/**`, `images/**` (`sharp`); nunca fs |
| `intake`, `research`, `agents` | `core/contracts`, `STORE_READ` (= `core/store/{fs-port,paths,hash}.ts`), `security`, `type` de `*/ports.ts` | su vendor solo en su adapter |
| `tokens`, `design`, `validation`, `export` [P5] | `core/contracts` (+`tokens`) | `@terrazzo/parser`, `colorjs.io` solo en `tokens` |
| `penpot` [P12] | `core/contracts`, `STORE_READ`, `security`, `templates/penpot/` | MCP SDK solo en `adapters/mcp` |
| `app` | todo `src/` salvo `cli`/`web` | `process.env` solo en `context.ts`/`config.ts` |
| `cli` | `app`, `core/contracts` | `process.env` solo en `main.ts` |
| `web` [P8] | `app`, `core/contracts`, `security` | `hono`; `node:crypto` solo en `web/auth/**` |

Transversales: adapters aislados entre sí; sin `new RegExp(`; `Bun.write`/`Bun.file` solo en `core/store`; `crypto.subtle`/`CryptoHasher` solo en `core/store/hash.ts` y `web/auth/**`.

## Convenciones de código

- **Nombres [E]:** kebab-case `.ts`; imports relativos con `.ts`; `import type`; único barrel `core/contracts/index.ts`. PascalCase sin `I`; `type` para datos, `interface` para puertos. `<Name>Schema: z.ZodType<Name>`, `<NAME>_DOCUMENT`, enums `UPPER_SNAKE as const` con unión derivada; `run<Cmd>(ctx, input)` → `<Cmd>Data`; `handle<Cmd>`, `render<Cmd>Text`, `read<Thing>`; adapters `const <camelId><Port>`; `DEFAULT_*`.
- **Errores:** (a) puro y adapters → uniones discriminadas; (b) infraestructura → clases tipadas mapeadas **una vez** en `storeErrorResult`; (c) el resto → `runCli` exit 1 `UNEXPECTED_ERROR`. Códigos solo vía `ExitCode.*` (2 uso · 3 bloqueado · 4 validación · 5 dependencia · 6 lock/revisión).
- **Determinismo:** `canonicalJson`; `toSorted()`/`compareStrings`, nunca `localeCompare`; fechas solo desde `ctx.clock` (en `history[]`, `GateDecision`, `AgentRun`); ids desde `ctx.ids`.
- **Seguridad:** rutas por `RelativeArtifactPathSchema` + `resolveInside`; entrada ajena con `probeFile`; contenido externo marcado `untrusted` (RN-36); `Logger` solo campos primitivos; secretos redactados antes de todo sink (RN-40).
- **Lock:** se toma lo más tarde posible y nunca durante IA, red, Penpot ni espera humana: el paso largo va fuera, sobre una instantánea `stateRevision = R`, y `withWriteRun` hace commit con `expectedRevision = R` (si cambió, exit 6).
- **Idioma (D14):** CLI y web en inglés; docs en español; código y JSDoc en inglés; artefactos generados en el idioma del producto.
- **Tests:** `// Covers: R<n>` en la primera línea; reutilizar `fixedContext`, `runCliCaptured`, `e2eSetup`, `copyFixture`, `hashTree`, `withFaultInjection`; helper nuevo a `tests/helpers/` al segundo uso (jscpd 0); sin snapshots de IA; timeout explícito con razón para I/O real.
- **Extraer código de producción:** regla de 3 (`loadWorkspace`, `app/facts.ts` [diferidos, no existen: se crean al 3.er sitio de uso]; al mover, sin re-export).

## Reglas duras

1. Solo `core/store` toca el filesystem (4 zonas, ver abajo). 2. `core/contracts` solo `zod`. 3. Nada de `navori*`. 4. Adapters sin imports cruzados; dominios solo por `import type` de `ports.ts`. 5. Códigos de finding persistidos como string con formato; ids de adapter/fuente/proveedor son enums completos al nacer; registros `Partial`, nunca `Record<Kind,…>` exhaustivo. 6. Nunca lock durante IA o red. 7. Nada de `any`, `console.log`, hardcode de secretos/URLs. 8. `// Covers: R<n>`. 9. Un `run*` nunca llama a otro `run*`; `app` no renderiza texto ni lee argv/env.

Zonas de escritura (enmienda de DP2): (1) `FileStore` solo `.heron/`, transaccional; (2) `append-log` solo `.heron/logs/` [P2]; (3) `TempDirPort` en `os.tmpdir()` [P3]; (4) `ExportWriter` en `--out` con `resolveInside`, reemplazo atómico de directorio [P5].

## Enmiendas declaradas

- **DP2 → ADR 0002** (`docs/adr/0002-store-write-zones.md`) aterriza en P3 y P5 la amplía.
- **DP7 por OD1-C′:** los documentos persistidos guardan el código de finding como `z.string().regex(/^[A-Z][A-Z0-9_]*$/)` (`StoredFinding`); la unión TS `FindingCode` sigue cerrada para los emisores. Sin bump por códigos nuevos; bump + migración solo por cambio de forma. Queda en `docs/architecture.md` §Contratos versionados.

## Refactors previos a P2 [pre-P2] (un PR `chore` desde `develop`)

1. `withWriteRun` en `app/write-run.ts` para `init` y `gate` (corrige que `runGate` no llama `recoverOrphanStaging`).
2. `emitResult` en `cli/output.ts` para los 4 handlers (`CommandSpec` entra con el primer subcomando de P2, OD2).
3. Fronteras como tablas `LAYERS`/`VENDORS`/`TOKENS` (hoy no existen), solo `.ts`, 0 violaciones.
4. OD1-C′: `StoredFindingSchema`, `ADAPTER_IDS` con 4 ids, regenerar `schemas/`.
5. `ExitCode.Blocked` en `readStatus` (hoy `failure(3, …)`).

Verifica con `git` o `ls` si ya aterrizaron antes de asumir el estado.

## Más detalle

- [references/patterns.md](references/patterns.md): catálogo con ejemplos canónicos de P1, esqueletos y anti-patrones.
- [references/layout.md](references/layout.md): árbol de carpetas [E]/[Pn], reglas de ubicación, tabla de dependencias.
- [references/recipes.md](references/recipes.md): cómo agregar orden de CLI, documento, adapter, módulo, fixture, gate.

## Checklist

- [ ] La ubicación sigue `references/layout.md`; lo [Pn] no se crea antes de su parte.
- [ ] Imports respetan la tabla; el módulo nuevo agrega su fila en `tests/repo/boundaries.test.ts`.
- [ ] Sin efecto fuera de `core/store`; sin `Date`/`randomUUID` directos.
- [ ] Errores por `UseCaseResult`/`ExitCode`, nunca throw con entrada hostil.
- [ ] `docs/architecture.md` actualizado en el mismo PR; `bun run check` verde.

Si algún punto falla, corrígelo y repite toda la lista.
