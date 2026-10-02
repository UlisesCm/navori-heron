# Contratos de datos de Heron

Los contratos viven en `src/core/contracts/` como esquemas Zod. `bun run gen:schemas` emite `schemas/<kind>.v<n>.schema.json` y `tests/repo/schemas.test.ts` falla si lo generado difiere de lo que hay en disco. Las reglas de versionado y de `looseObject` están en [docs/architecture.md](architecture.md#contratos-versionados-y-genschemas); este documento describe el modelo de datos del producto (P4) y cómo se relaciona con el contrato UX del harness.

## Tipos de contrato

| Tipo                | Esquema                           | Quién lo escribe             | Ejemplos                                                             |
| ------------------- | --------------------------------- | ---------------------------- | -------------------------------------------------------------------- |
| Persistido          | `z.looseObject` + `schemaVersion` | Heron, en `.heron/`          | `ProductContext`, `IntakeConflicts`, `HeronProject`                  |
| Entrada del usuario | `z.strictObject`                  | La persona, en un archivo    | `ManualContext`, `ReferenceBatch`                                    |
| Salida transitoria  | `z.object`                        | Heron, a stdout con `--json` | `CliEnvelope`, `IntakeData`, `ConflictsListData`, `ConflictsAckData` |

## Modelo canónico: `ProductContext`

`ProductContext` (`kind: "ProductContext"`, `schemaVersion: 1`) es el modelo del producto que consumen las partes posteriores. Se escribe en `.heron/intake/product-context.json` (en JSON canónico) con `heron intake`. La decisión está en el [ADR 0006](adr/0006-canonical-data-model.md).

- `metadata`: `adapter`, `mode` (modo efectivo al hacer intake), `stage` (`dir` y `selection`, o `null`), `uxReader` (`"provisional-1"` o `null` si `ux.json` no se usó), `sources`, `uxExtensions` y `findings`.
- 19 secciones, en el orden de `PRODUCT_CONTEXT_SECTIONS`: `product`, `actors`, `capabilities`, `businessRules`, `functionalRequirements`, `nonFunctionalRequirements`, `surfaces`, `journeys`, `flows`, `screens`, `states`, `functionalComponents`, `patterns`, `entities`, `constraints`, `brand`, `decisions`, `traceability`, `unresolvedQuestions`. `product` es una lista de hechos `{key, value}` con `key` en `name`, `summary` o `language`.
- Cada elemento lleva `sourceRef`, `alsoIn` y `conflicts`:
  - `sourceRef = { source, path, locator }`. `source` es uno de `SOURCE_KINDS`: `DECISIONS.md`, `MASTER.md`, `parts.json`, `ux.json`, `UX.md`, `DIGEST.md`, `CODEBASE.md`, `context`, `manual`, `navori.config.json`. `locator` es `§<encabezado>` en Markdown o un JSON Pointer en JSON; nunca un número de línea, así mover líneas no cambia el documento.
  - `alsoIn`: las otras fuentes que traen el mismo dato con el mismo texto normalizado.
  - `conflicts`: ids `CONFLICT-NNN` que afectan al elemento.
- `metadata.sources[]` registra `{source, path, status}` con `status` en `used`, `read`, `unused`, `absent` o `unreadable`. `read` es una fuente leída que no aportó elementos (`SOURCE_NO_ELEMENTS`); `unused` es una fuente presente que el modo excluye (p. ej. `UX.md` en `reference-only`). No hay hashes: los de los artefactos del harness ya están en `intake/mode.json`.
- Los campos de `ux.json` que Heron no conoce se conservan como `extensions: { key, value }[]` en el orden de la fuente (en los elementos) y en `metadata.uxExtensions` (nivel raíz). `ux.json` nunca se reescribe.
- No hay `generatedAt` ni versión de Heron en el documento.

**Frescura = regenerar y comparar.** El contexto está al día si volver a calcularlo da los mismos bytes. `heron status` lo recalcula y emite `PRODUCT_CONTEXT_STALE` si difiere; `heron intake` lo reescribe. Cambian los bytes (y la aprobación de `intake` deja de ser válida) con un valor extraído distinto, una sección renombrada, una fuente que aparece, desaparece o deja de leerse, un cambio de modo, adapter, etapa o lector UX, o una versión de Heron cuyo extractor produce otra salida. No cambian: líneas movidas, prosa fuera de las secciones de rol, ediciones de `CODEBASE.md` o de fuentes `unused`.

### Conflictos: `IntakeConflicts`

`.heron/intake/conflicts.json` (`kind: "IntakeConflicts"`, `schemaVersion: 1`) lista los conflictos, ordenados por id. Cada `Conflict` tiene `id` (`CONFLICT-NNN`), `kind`, `subject`, `status` (`open` o `resolved`), `files`, `values` (exactamente el par que se contradice, en orden de precedencia), `impact` (`<sección>/<clave>`), `winner` (solo en `value-mismatch`), `fingerprint` y `ack` (`{by, at, note, runId}` o `null`).

Tipos que Heron detecta (`CONFLICT_KINDS`):

| Tipo                       | Se dispara cuando                                                                                                                                                                                            |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `actor-unknown`            | un actor de `ux.json` no tiene par en la tabla de actores de `MASTER.md`                                                                                                                                     |
| `permission-contradiction` | una capacidad de `ux.json` coincide con un "No puede" de `MASTER.md`, o una acción prohibida coincide con un "Puede" (texto normalizado)                                                                     |
| `value-mismatch`           | el mismo dato (sección y clave) trae valores distintos en dos fuentes; gana la de mayor precedencia                                                                                                          |
| `reference-unknown`        | `ux.json` o `parts.json` citan un id (`RN-`, `RF-`, `RNF-`, `P<n>`, `P<n>.A<m>`, `D<n>`) que su fuente definidora no declara; solo se verifica si esa fuente está presente (si no, `REFERENCES_NOT_CHECKED`) |

El `fingerprint` identifica un par contradictorio por tipo, sujeto y valores normalizados, sin rutas ni localizadores. Un conflicto que vuelve a aparecer con los mismos valores conserva su id y su reconocimiento; uno que deja de aparecer pasa a `resolved` y su id no se reutiliza; un valor distinto es un conflicto nuevo. Un conflicto `open` sin `ack` bloquea `heron gate intake approve` (`intake-context-valid`) hasta que se reconoce con `heron conflicts ack`.

El `kind` persistido es texto con patrón `^[a-z][a-z0-9-]*$`, como el código de un finding: un tipo nuevo no sube `schemaVersion`.

### Entrada `manual`: `ManualContext`

Con `heron init --adapter manual --context <archivo>.json`, el archivo debe cumplir `ManualContext` (`kind: "ManualContext"`, `schemaVersion: 1`, `z.strictObject`; `schemas/manual-context.v1.schema.json`). Admite `product` (obligatorio, con `name` y `summary` opcional) y, opcionales, `actors`, `capabilities`, `businessRules`, `functionalRequirements`, `nonFunctionalRequirements`, `entities`, `constraints`, `brand`, `decisions` y `unresolvedQuestions`. No admite secciones de estructura UX (`surfaces`, `flows`, `screens`…): solo vienen de `ux.json`. Un campo desconocido es un error (`CONTEXT_INPUT_INVALID`).

## Contrato UX del harness (`ux.json`)

Heron no define el contrato de `UX.md` y `ux.json`: lo define `navori-harness`. Heron lo lee con un lector intercambiable, `UxReader = { id, read }`, y `ACTIVE_UX_READER` (`src/intake/ux-contract.ts`) designa el activo. Hoy es el lector provisional `provisional-1`, que exige solo un subconjunto mínimo y conserva lo demás:

- `schemaVersion` (igual a 1) y, si existe, `masterStage` (debe coincidir con la etapa).
- `surfaces[].id` (al menos una), `screens[].id` y `screens[].surface`, `flows[].id` y `flows[].screens` (al menos un flow), `patterns[].id` y `patterns[].screens`.
- Relaciones: ids únicos por lista, `screens[].surface` existe en `surfaces`, y los `screens` de flows y patterns existen.

El detalle de qué campo del harness llena qué sección, la tolerancia a campos desconocidos y los pasos para cambiar de lector están en [docs/integrations/navori-harness.md](integrations/navori-harness.md). Mientras el lector sea provisional, `metadata.uxReader` vale `"provisional-1"` y `ProductContext` es lo único que deben consumir `design` y `validation`.

## Datos de CLI

Transitorios, dentro de `CliEnvelope.data` con `--json`:

- `IntakeData` (`heron intake`): `mode`, `adapter`, `stage`, `dryRun`, `written` (falso en `--dry-run` y cuando los bytes no cambiaron), `stateRevision` (`null` en `--dry-run` sin `.heron/`), `counts` por sección y `conflicts` abiertos con `{id, kind, subject, acknowledged}`.
- `ConflictsListData` (`heron conflicts list`): `tracked` (falso si aún no hay `conflicts.json`) y `conflicts`.
- `ConflictsAckData` (`heron conflicts ack`): `conflict`, `stateRevision` y `unacknowledged`.

## Schemas generados

`schemas/` contiene un schema por contrato de `CONTRACT_DOCUMENTS`; los de P4 son `product-context.v1.schema.json`, `intake-conflicts.v1.schema.json` y `manual-context.v1.schema.json`. No se emite schema de `ux.json`: es un contrato del harness. Los tests validan los documentos que producen los fixtures contra estos schemas con `ajv` en modo estricto (devDependency, solo tests; ADR 0006).
