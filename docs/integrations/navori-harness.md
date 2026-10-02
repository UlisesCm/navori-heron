# Integración con navori-harness

Heron lee los archivos que `navori-harness` (Navori Master) deja en el repo del producto. No importa su código y no redefine su contrato: `UX.md`, `ux.json` y sus IDs los define el harness (RN-6, D2) y Heron conserva los IDs tal como vienen. Este documento explica qué lee, de dónde sale cada dato del [`ProductContext`](../contracts.md), cómo se decide cuando dos fuentes discrepan y cómo comprobarlo.

## Qué detecta Heron

El adapter `navori-master` se activa si existen `navori.config.json` y `{specsDir}/_master/index.json` (`specsDir` es `sdd.specsDir` de la config, `specs` por defecto; una ruta absoluta, con `..` o que escape del repo se ignora con un aviso). La etapa se toma de `index.json`: la activa o, si no hay ninguna, la última cerrada (`init --stage <NN-slug>` fuerza una). Los archivos se leen de `{specsDir}/_master/<etapa>/`:

| Archivo                                   | Ruta                                                                                                             |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `MASTER.md`, `DECISIONS.md`, `parts.json` | `<etapa>/`                                                                                                       |
| `UX.md`, `ux.json`                        | `<etapa>/`                                                                                                       |
| `DIGEST.md`, `CODEBASE.md`                | `<etapa>/context/`                                                                                               |
| `*.md` adicionales                        | `<etapa>/context/md/` (no recursivo, solo `.md`, máximo 50 por nombre; el exceso se omite con `INPUT_TOO_LARGE`) |
| `navori.config.json`                      | raíz del repo                                                                                                    |

`<etapa>/state.json` no aporta elementos: de él sale la declaración `ux` del harness (`none`, `md` o `md-json`) y la fase. Cada fuente se limita a `maxInputBytes`. Sin `navori.config.json` y `index.json`, Heron usa el adapter `filesystem` (detección por archivos presentes); `markdown` y `manual` solo se usan si el usuario los pidió con `heron init --adapter markdown|manual --context <archivo>...` (la selección se guarda en `project.json` hasta `--adapter auto`).

## Qué aporta cada fuente

`sourceRef.source` usa estos nombres. "Sección" es la del `ProductContext`.

| Fuente                  | Qué se lee                                                                                                                                                                                          | Sección                                                                                                                                                                |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `navori.config.json`    | `name` (no vacío) y `language` (solo `es` o `en`; otro texto es `HARNESS_UNKNOWN_VALUE`)                                                                                                            | `product`                                                                                                                                                              |
| `DECISIONS.md`          | cada `## D<n>` con `Pregunta:`/`Question:`, `Elegida:`/`Chosen:`, `Descartadas:`/`Discarded:` (separadas por `;`) y `Fecha:`/`Date:`                                                                | `decisions`                                                                                                                                                            |
| `MASTER.md`             | resumen ejecutivo; alcance MoSCoW (`M`, `S`, `C`, `W`); tabla de actores con `Puede` y `No puede`; reglas de negocio `RN-`; requisitos `RF-` y `RNF-`; dominio y datos; preguntas abiertas; marca   | `product`, `capabilities`, `constraints`, `actors`, `businessRules`, `functionalRequirements`, `nonFunctionalRequirements`, `entities`, `unresolvedQuestions`, `brand` |
| `parts.json`            | `parts[].seedRequirements` y los ids de parte y de criterio (versión 1; tolera campos extra)                                                                                                        | `traceability`                                                                                                                                                         |
| `ux.json` (solo `full`) | `surfaces`, `actors`, `journeys`, `flows`, `screens`, `functionalComponents`, `patterns` por id; `uxRequirements` (como `functionalRequirements` con id `UX-n`); `traceability`; `screens[].states` | las secciones homónimas, más `states` y `constraints`                                                                                                                  |
| `UX.md` (solo `full`)   | solo las secciones marcadas con `<!-- ux-kind: … -->` de tipo `global-states`, `open-questions`, `out-of-scope` y `heron-handoff` (`### Heron MUST preserve`, `MAY improve`, `owns`)                | `states`, `unresolvedQuestions`, `constraints`                                                                                                                         |
| `DIGEST.md`             | solo `Actores`/`Actors` y `Entidades de datos`/`Data entities`; el resto de secciones no aporta                                                                                                     | `actors`, `entities` (solo emparejan con lo que ya trajo `MASTER.md`)                                                                                                  |
| `CODEBASE.md`           | no tiene reglas propias                                                                                                                                                                             | normalmente nada: queda `read` con `SOURCE_NO_ELEMENTS`                                                                                                                |
| `context/md/*.md`       | las mismas reglas de rol que `MASTER.md`                                                                                                                                                            | según las secciones presentes                                                                                                                                          |

Las secciones Markdown se reconocen por vocabulario de rol, en español e inglés (`Reglas de negocio`/`Business rules`, `Requisitos funcionales`/`Functional requirements`, `Actores y permisos`/`Actors and permissions`, `Preguntas abiertas`/`Open questions`, `Marca`/`Brand`…); un id (`RN-`, `RF-`, `RNF-`, `M/S/C/W<n>`) se define solo dentro de la sección de su rol. El código y los comentarios HTML (salvo `ux-kind`) nunca se leen como datos. `UX.md` y `ux.json` cuentan solo en modo `full`; en `reference-only` la fuente queda `unused`. Un campo de `ux.json` con tipo inesperado se omite con `CONTEXT_SECTION_UNREADABLE`; un id duplicado en `ux.json` o `parts.json` conserva el primero (`CONTEXT_DUPLICATE_ID`); una referencia interna de `ux.json` no declarada es `UX_REFERENCE_UNRESOLVED` (warning).

## Precedencia (RN-7)

De mayor a menor: `DECISIONS.md` > `MASTER.md` > `parts.json` > `ux.json` > `UX.md` > `DIGEST.md` > `CODEBASE.md` > contexto convertido (`context/md` o `markdown`). `manual` y `navori.config.json` no compiten con las demás. Está en `SOURCE_PRECEDENCE` (`src/intake/precedence.ts`).

- La precedencia solo decide el valor de **el mismo dato**: mismo elemento (sección y clave) en dos fuentes. Gana la de menor rango; si los textos normalizados coinciden, la otra fuente queda en `alsoIn`; si difieren en un campo comparable, hay un conflicto `value-mismatch` con el ganador marcado.
- Un campo que solo trae una fuente se une al elemento.
- En `actors` y `entities`, los elementos se emparejan por nombre normalizado (sin acentos ni mayúsculas, sin paréntesis; alternativas separadas por `/`). Si una fuente de mayor rango aportó al menos un elemento de esa sección, los de menor rango sin par no entran y se listan con `LOWER_TIER_ITEMS_SKIPPED` (info): no se consideran una contradicción.
- Un actor de `ux.json` se empareja por el `ACT-…` fijado en la celda de `MASTER.md` o por nombre.

## Conflictos

Heron no elige en silencio ante una contradicción: la registra en `.heron/intake/conflicts.json` con los archivos, los dos valores, el impacto y, en `value-mismatch`, el ganador.

- `actor-unknown`: un actor de `ux.json` sin par en la tabla de actores de `MASTER.md`.
- `permission-contradiction`: una capacidad de `ux.json` igual (texto normalizado) a un "No puede" de `MASTER.md`, o una acción prohibida igual a un "Puede".
- `value-mismatch`: el mismo dato con valores distintos.
- `reference-unknown`: `ux.json` o `parts.json` citan un `RN-`/`RF-`/`RNF-`, un `P<n>` o `P<n>.A<m>`, o un `D<n>` que la fuente definidora (`MASTER.md`, `parts.json`, `DECISIONS.md` de la etapa) no define. Solo se comprueba si esa fuente está presente y se pudo leer; si no, `REFERENCES_NOT_CHECKED`. Un `D<n>` con prefijo de etapa (`01-x/D3`) no se verifica.

Un conflicto abierto sin reconocer emite `CONFLICT_OPEN` y bloquea `heron gate intake approve`. Se revisa con `heron conflicts list [--all]` y se reconoce con `heron conflicts ack <CONFLICT-NNN> --note <texto>` (la nota es obligatoria; pide confirmación en una terminal o `--yes`; registra quién y cuándo). Reconocer después de aprobar invalida esa aprobación (RN-28) y se re-aprueba con `heron gate intake approve`. La resolución de fondo vive en el master-plan: al corregir la fuente, el conflicto pasa a `resolved` en el siguiente `heron intake`.

### Límites de las heurísticas

La detección es determinista y de cobertura mínima:

- Compara texto normalizado. Una contradicción con distinta redacción ("Ver datos de miembros" frente a "See member data") no se detecta: son falsos negativos esperados. La detección semántica con IA queda fuera de P4.
- `permission-contradiction` y `actor-unknown` dependen de que `ux.json` exista y de que la tabla de actores de `MASTER.md` esté en el formato de la plantilla. Estas heurísticas se probaron con los fixtures sintéticos; ningún repositorio real tiene todavía `ux.json`, así que no se han medido sobre datos reales (se revisan en P11).
- El emparejamiento por nombre puede fallar con nombres muy distintos entre fuentes; el resultado es un elemento sin `alsoIn`, no un dato inventado.
- Los enteros de `ux.json` mayores que 2^53 conservan el valor que da `JSON.parse`.

## Frescura

El contexto "al día" es el que se obtiene al regenerarlo. `heron intake` relee las fuentes en cada corrida (`--refresh` se acepta y no cambia nada) y escribe `.heron/intake/product-context.json` y `.heron/intake/conflicts.json` solo si cambian los bytes; `--dry-run` calcula y muestra sin escribir y funciona sin `.heron/`. Una vez que existe un intake previo, `heron status` recalcula y emite `PRODUCT_CONTEXT_STALE` si el resultado difiere de lo escrito (por un cambio en las fuentes, el modo o una versión nueva de Heron con otro extractor).

El gate `intake` se aprueba con `heron gate intake approve`, atado a los sha256 de `intake/mode.json`, `intake/product-context.json` e `intake/conflicts.json`. Si cambia el contexto, la aprobación se invalida y se re-aprueba en la misma fase, también desde las de producción (los artefactos posteriores quedan obsoletos). Sin contexto al día: `the product context is missing or out of date`; con conflictos abiertos: `<n> conflict(s) are not acknowledged`.

## Subconjunto provisional de `ux.json`

Mientras el harness no publique un JSON Schema versionado (D5), el lector `provisional-1` valida solo:

- `schemaVersion` igual a 1, y `masterStage` (si viene) igual a la etapa seleccionada.
- `surfaces[].id` (al menos una), `screens[].id` y `screens[].surface`, `flows[].id` y `flows[].screens` (al menos un flow), `patterns[].id` y `patterns[].screens`.
- Relaciones: ids únicos en cada lista, la superficie de cada pantalla existe y las pantallas de flows y patterns existen.

Todo lo demás se tolera: los campos de contrato que Heron conoce se mapean a su sección y los desconocidos se conservan en `extensions` (en el elemento) o en `metadata.uxExtensions` (en la raíz), con clave, orden y valor en JSON canónico. Heron nunca reescribe `ux.json`. Un `ux.json` inválido deja el modo en `reference-only` (`UX_CONTRACT_INVALID`); si la declaración `ux` de `state.json` no coincide con los archivos, también (`UX_DECLARATION_MISMATCH`); si declara `md`, Heron no usa `UX.md` parcialmente (D6).

## Conmutación del lector de `ux.json`

Cuando el harness publique el schema de `ux.json` (P11):

1. Guardar una copia fijada del JSON Schema en `src/intake/vendor/` con su sha256.
2. Crear un `UxReader` nuevo (`{ id, read }`) que valide con esa copia (Zod trae `z.fromJSONSchema`; su fidelidad con ese schema no está verificada) y entregue el mismo `UxContract`.
3. Apuntar `ACTIVE_UX_READER` (`src/intake/ux-contract.ts`) al lector nuevo y ampliar `UxJsonCheck.reader` y `metadata.uxReader`, hoy el literal `provisional-1`, a un enum (cambio aditivo).

Los consumidores de `ProductContext` no cambian. `metadata.uxReader` cambia, así que `heron status` mostrará `PRODUCT_CONTEXT_STALE` hasta correr `heron intake` y volver a aprobar `intake`.

## Cómo verificarlo

```bash
# Vista previa sin escribir (funciona sin .heron/); el JSON incluye counts y conflicts abiertos
bun run heron intake --dry-run --json fixtures/membership-product

# Un conflicto real: el fixture `conflict` produce exactamente CONFLICT-001
bun run heron intake --dry-run --json fixtures/conflict
```

Para escribir de verdad, trabajar sobre una copia (nunca sobre `fixtures/`): `d="$(mktemp -d)" && cp -R fixtures/membership-product/. "$d" && bun run heron init "$d" && bun run heron intake "$d"`. Para comparar contra el master de este repo: `bun run heron intake --dry-run --json .` devuelve `mode: reference-only` y `adapter: navori-master`. Los fixtures y la sonda contra los esquemas reales del harness están en [fixtures/README.md](../../fixtures/README.md).
