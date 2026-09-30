# Heron

Heron es una herramienta de línea de comandos que toma el contexto de un producto ya definido con Navori Master (`UX.md`, `ux.json`, `MASTER.md`) y prepara, con gates humanos, el trabajo de diseño visual sobre ese producto. Su estado vive en archivos versionados dentro de `.heron/`, en el propio repo del producto.

Heron decide un **modo** por producto: `full` (hay `UX.md` y un `ux.json` válido, y puede producir) o `reference-only` (falta o es inválido algún insumo de UX, o el harness declara solo `UX.md`: solo research visual, sin generación de producto completo). Ver [docs/architecture.md](docs/architecture.md).

> **Alcance de P1.** Esta versión implementa únicamente la base: `heron init`, `heron status`, `heron doctor` y `heron gate`. No hay todavía research, direcciones visuales, agentes de IA, integración con Penpot, generación de tokens ni exportación; las fases posteriores de la máquina de estados existen como tabla y contratos, pero ningún comando las produce aún.

## Requisitos

- Bun 1.4.2 (`packageManager` de `package.json`). No se necesita Node.
- Git, para versionar `.heron/` en el repo del producto.

## Instalación (desde un clon, D20)

```bash
git clone <url-del-repo> navori-heron
cd navori-heron
bun install
bun link        # expone el comando `heron` desde bin/heron.ts
heron --version # 0.1.0
```

Sin `bun link` se puede correr igual: `bun bin/heron.ts <comando>` o `bun run heron <comando>`.

## Primer `heron init`

`heron init [path]` detecta el contexto, decide el modo y escribe `.heron/` (el path por defecto es `.`). Si hay varias etapas y ninguna activa usa la última `cerrada` y lo avisa; `--stage <NN-slug>` fuerza una.

### Producto sin UX: `reference-only`

`fixtures/no-ux` tiene plan maestro pero ni `UX.md` ni `ux.json`:

```bash
heron init fixtures/no-ux
```

```text
Project detected
Navori Master: yes
Stage: 01-mvp

MASTER.md: ✓
DECISIONS.md: ✓
parts.json: ✓
UX.md:  missing
ux.json: missing
DIGEST.md: ✓
CODEBASE.md: ✓

Mode:
REFERENCE ONLY

Full product generation disabled.
Visual research is available.
```

Termina con exit 0: `reference-only` no es un error.

### Producto completo: `full`

`fixtures/membership-product` tiene `UX.md` y un `ux.json` válido (todos los fixtures son sintéticos):

```bash
heron init fixtures/membership-product
```

```text
Project detected
Navori Master: yes
Stage: 01-mvp

MASTER.md: ✓
DECISIONS.md: ✓
parts.json: ✓
UX.md:  ✓
ux.json: ✓
DIGEST.md: ✓
CODEBASE.md: ✓

Harness UX declaration: md-json

Mode:
FULL PRODUCT

Surfaces:
- MOBILE
- DASHBOARD
- PARTNER

Screens: 6
Flows: 3
Patterns: 2

Ready for research.
```

Advertencia: sin `--dry-run`, `init` escribe `.heron/` dentro del path indicado. Los fixtures no deben modificarse (los tests trabajan sobre copias temporales); para probar con escritura real, copia el fixture a otro directorio o usa `--dry-run`.

### `--dry-run`

Calcula y muestra todo, pero no escribe nada; agrega al final `Dry run: nothing was written to .heron/`.

```bash
heron init --dry-run fixtures/no-ux   # exit 0, muestra REFERENCE ONLY
```

### `--json`

Con `--json` la salida es exactamente un `CliEnvelope` (una línea JSON) en stdout, también en errores; el contrato está en `schemas/cli-envelope.v1.schema.json`.

```bash
heron init --dry-run --json fixtures/no-ux
# {"kind":"CliEnvelope","schemaVersion":1,"command":"init","runId":"run-...","durationMs":4,"ok":true,"code":0,"data":{...}}
```

## Comandos de P1

```text
heron init [path] [--stage <NN-slug>] [--dry-run] [--json]
heron status [path] [--json]
heron doctor [path] [--json]
heron gate <gate> approve|reject [path] [--note <text>] [--reason <text>] [--yes] [--json]
```

- `status`: modo, etapa, fase, estado de cada gate y artefactos obsoletos. Solo lectura.
- `doctor`: revisa Bun, la ruta, los documentos de `.heron/`, el lock, el `.gitignore` y la detección. Solo lectura.
- `gate`: registra una decisión humana ligada a los hashes de los artefactos del gate. Gates: `intake`, `research`, `direction`, `foundations`, `representative-screens`, `visual-review`. Rechazar exige `--reason`; sin TTY hay que pasar `--yes`. En `reference-only` los gates de producción dan `MODE_BLOCKED`. En P1 ningún gate puede aprobarse de extremo a extremo: `approve` siempre termina en exit 3 (`PRECONDITION_UNMET` o `TRANSITION_NOT_ALLOWED`) porque ningún comando produce todavía los artefactos y hechos que exigen; `reject` sí funciona.

## Códigos de salida

| Código | Significado                                                                                         |
| ------ | --------------------------------------------------------------------------------------------------- |
| 0      | OK (también `reference-only`)                                                                       |
| 1      | Error inesperado (`UNEXPECTED_ERROR`; `HERON_DEBUG=1` agrega el stack)                              |
| 2      | Uso: opción, comando o gate desconocido, ruta o `--stage` inválidos, falta `--reason`/`--yes`       |
| 3      | Bloqueado: `.heron/` inseguro o inválido, no inicializado, `MODE_BLOCKED`, precondición no cumplida |
| 4      | `doctor`: falla un check que no es de dependencia                                                   |
| 5      | `doctor`: falla una dependencia (p. ej. versión de Bun)                                             |
| 6      | Lock tomado por otro escritor o revisión de `state.json` cambiada                                   |

## Quality gate

```bash
bun run check   # format:check + lint + typecheck + test:coverage
```

Otros scripts: `bun test`, `bun run gen:schemas` (regenera `schemas/`), `bun run heron <comando>`.

## Estructura del repo

```text
bin/heron.ts      punto de entrada del CLI
src/cli/          parseo de argumentos, render y envelope (inglés)
src/app/          casos de uso: init, status, doctor, gate
src/core/         contracts (Zod), state (dominio puro), store (único acceso a fs)
src/intake/       detección de contexto: puertos y adapters (navori-master, filesystem)
schemas/          JSON Schemas generados desde los contratos
scripts/          gen-schemas y check-coverage
fixtures/         productos sintéticos para tests y pruebas manuales
tests/            unit, e2e, repo (fronteras, schemas, CI) y perf
specs/            especificaciones SDD
docs/             arquitectura y ADR
```

## Documentación

- [docs/architecture.md](docs/architecture.md): módulos, fronteras, estados y layout de `.heron/`.
- [docs/adr/0001-state-persistence.md](docs/adr/0001-state-persistence.md): por qué filesystem + Git.
- [fixtures/README.md](fixtures/README.md): fixtures y resultado esperado.
