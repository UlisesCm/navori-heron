# ADR 0006: Modelo canónico de datos del producto

- Estado: aceptada
- Fecha: 2026-10-01
- Referencias: `specs/0004-product-context/design.md` (§Approach, §Contracts 1, 7 y 8, DR2 a DR5, DR7, DR10, DR18, DR19, DR21); `specs/_master/01-heron/MASTER.md` (RN-6, RN-7, RN-8, RN-28); D2, D5, D6. Los números `0002` y `0005` los usa la spec 0003 (zonas de escritura y frontera de IA)

## Contexto

Heron recibe el modelo funcional del producto de fuentes distintas: los archivos de `navori-master` (`MASTER.md`, `DECISIONS.md`, `parts.json`, `ux.json`, `UX.md`, `context/DIGEST.md`, `context/CODEBASE.md`, `context/md/*.md`, `navori.config.json`), un conjunto de archivos Markdown elegido por el usuario (`markdown`) o un JSON escrito a mano (`manual`). Las partes siguientes (agentes, diseño, validación) necesitan un solo modelo del producto, con procedencia, y no pueden depender del formato de cada fuente ni del contrato interno de `ux.json`, que todavía es un lector provisional (D5).

Las fuentes pueden contradecirse, y la regla del proyecto es que Heron no inventa: cada dato debe poder rastrearse a un texto de origen y toda contradicción debe quedar visible como `CONFLICT`, sin elegir en silencio (RN-7), hasta que una persona la reconozca (RN-8).

## Decisión

1. **Un documento canónico, `ProductContext`** (`src/core/contracts/product-context.ts`, `schemaVersion: 1`, `schemas/product-context.v1.schema.json`). Tiene una cabecera `metadata` y las 19 secciones de contenido de `PRODUCT_CONTEXT_SECTIONS`. Cada elemento lleva `sourceRef` (`source`, `path`, `locator`), `alsoIn` y `conflicts`. Es un documento persistido (`z.looseObject`): conserva los campos desconocidos al reescribirlo.
2. **Procedencia estable.** `locator` es un ancla de sección (`§<encabezado>`) en Markdown y un JSON Pointer en JSON; nunca un número de línea. `metadata.sources` registra `{source, path, status}` sin hashes y el documento no lleva fechas ni la versión de Heron. Mover líneas no cambia los bytes.
3. **Frescura por regeneración.** El contexto "está al día" si `computeIntake` produce los mismos bytes que `.heron/intake/product-context.json`. No hay `generatedAt` ni sha256 de fuentes que comparar. `heron status` regenera y emite `PRODUCT_CONTEXT_STALE` cuando difiere; `heron intake` lo vuelve a escribir.
4. **Un puerto, `ProductContextAdapter`** (`src/intake/ports.ts`): `detect` y `load`, sin escritura y sin lanzar ante entrada hostil. `load` devuelve un borrador (`ContextDraft`) de candidatos; el merge es común (`src/intake/product-context.ts`). Los adapters `navori-master` y `filesystem` están en `DEFAULT_ADAPTERS`; `markdown` y `manual` solo corren si `heron init --adapter` los seleccionó (`OPT_IN_ADAPTERS`, `src/intake/detect.ts`).
5. **Precedencia como dato** (`SOURCE_PRECEDENCE`, `src/intake/precedence.ts`): el orden de RN-7 (`DECISIONS.md`, `MASTER.md`, `parts.json`, `ux.json`, `UX.md`, `DIGEST.md`, `CODEBASE.md`, `context`), más `manual` y `navori.config.json`, que no compiten. Solo se compara "el mismo dato": mismo (sección, clave). Gana la fuente de menor rango; el resto va a `alsoIn` si el texto normalizado coincide, o a un conflicto `value-mismatch` si no.
6. **Conflictos deterministas y de cobertura mínima** (`CONFLICT_KINDS`): `actor-unknown`, `permission-contradiction`, `value-mismatch` y `reference-unknown`. Se persisten en `.heron/intake/conflicts.json` (`IntakeConflicts`) con identidad estable por `fingerprint`; un conflicto reconocido con `heron conflicts ack` conserva su `id` y su `ack` entre corridas. Las contradicciones con redacción distinta no se detectan (falso negativo asumido); la detección semántica con IA queda fuera de P4.
7. **Gate `intake` en cualquier fase** (enmienda de DP9, ver [docs/architecture.md](../architecture.md)): `heron intake` escribe cuando cambian los bytes y el gate se re-aprueba en sitio desde cada fase de producción, sin cambiar de fase.
8. **El lector de `ux.json` es intercambiable.** `UxReader = { id, read }` y `ACTIVE_UX_READER` (`src/intake/ux-contract.ts`) apunta hoy al `PROVISIONAL_UX_READER` (`provisional-1`). Cuando exista el schema publicado del harness (P11), se cambia el lector activo sin tocar a los consumidores; `metadata.uxReader` cambia, lo que pide regenerar y re-aprobar. Pasos en [docs/integrations/navori-harness.md](../integrations/navori-harness.md#conmutación-del-lector-de-uxjson).
9. **Los consumidores leen `ProductContext`, nunca `UxContract`.** `design` y `validation` (P5 en adelante) importan el modelo canónico; el tipo interno del lector no sale de `src/intake/`.
10. **ajv como devDependency (DR19).** `ajv` 8.20.0 se usa solo en tests (`tests/contracts/json-schema.test.ts`): compila en modo estricto (`Ajv2020`) los JSON Schemas emitidos y valida con ellos los documentos que producen los fixtures. No entra al runtime, así que RNF-15 (dependencias de ejecución) no pide un ADR propio; la decisión queda registrada aquí.

## Alternativas consideradas

- **Que cada consumidor lea las fuentes.** Duplica el parseo de Markdown y `ux.json` por módulo y no permite conflictos entre fuentes. Descartada.
- **Frescura por hashes de las fuentes.** Marcaría como obsoleto un cambio que no altera el contexto (líneas movidas, `CODEBASE.md`) y obligaría a re-aprobar sin motivo. Regenerar y comparar bytes detecta solo lo que cambia el resultado, incluido un extractor nuevo. Descartada.
- **Resolver los conflictos eligiendo siempre al ganador.** Oculta una contradicción que la persona debe ver (RN-7). La precedencia solo decide el valor de un mismo dato; las contradicciones estructurales se marcan y bloquean el gate hasta ser reconocidas. Descartada.
- **Validar el contrato UX con un schema copiado del harness ya.** El schema publicado no existe todavía y el lector provisional solo exige los ids y relaciones mínimos. Se difiere a P11 detrás de `ACTIVE_UX_READER`.

## Consecuencias

- Un cambio en un valor extraído, en el modo, en el adapter, en la etapa, en el lector UX o en el extractor de una versión nueva de Heron cambia los bytes y pide re-aprobar `intake`. Cambios de formato fuera de las secciones de rol no lo hacen.
- Añadir una fuente de `ProductContext` es un adapter más y, si aporta datos nuevos, una entrada en `SOURCE_KINDS` y en la precedencia (receta en la skill `heron-architecture`).
- Un tipo de conflicto nuevo no sube la versión (el `kind` persistido es texto con patrón, como `StoredFinding`); un valor nuevo en un enum persistido sí.
- Heron no redefine el contrato del harness (RN-6, D2): lee los archivos que `navori-master` produce y tolera lo que no conoce (`extensions`).
- Las heurísticas de actores y permisos no se han medido sobre un repositorio real con `ux.json`: es un riesgo conocido y queda para P11.
