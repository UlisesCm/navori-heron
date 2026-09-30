# 0001 Heron core — Requirements

## Context

Parte P1 del master-plan `01-heron` (`specs/_master/01-heron/MASTER.md`): el núcleo de Heron y el primer slice vertical de `context/md/PLAN.md` §80 — `heron init` detecta un master-plan de Navori, valida la presencia y validez de `UX.md` + `ux.json`, decide el modo (`full` / `reference-only`), persiste el estado en `.heron/` y `heron status` lo reporta. Es el invariante central del producto. Decisiones aplicables: D4 (un solo paquete), D5 (lector UX provisional), D6 (`ux = md`), D14 (salida en inglés), D16 (umbrales), D20 (`bun link`), D21 (CI), D22 (etapa por defecto).

## Requirements (EARS)

**Detección y modo**

- **R1** — CUANDO el usuario ejecute `heron init <ruta>` sobre un repo con `navori.config.json` y `<sdd.specsDir>/_master/index.json`, el sistema DEBERÁ imprimir, en este orden, `Project detected`, `Navori Master: yes`, `Stage: <NN-slug>`, la presencia (`✓` / `missing`) de `MASTER.md`, `DECISIONS.md`, `parts.json`, `UX.md`, `ux.json`, `DIGEST.md` y `CODEBASE.md`, el modo, las surfaces y los conteos `Screens:`/`Flows:`/`Patterns:` tomados de `ux.json`, y salir con código 0. Criterios: P1.A1.
- **R2** — CUANDO `UX.md` y `ux.json` existan y ambos sean válidos, el sistema DEBERÁ fijar `mode = "full"`, imprimir `FULL PRODUCT` y `Ready for research.`. Criterios: P1.A1.
- **R3** — CUANDO falten `UX.md` y `ux.json`, el sistema DEBERÁ fijar `mode = "reference-only"` e imprimir `REFERENCE ONLY`, `Full product generation disabled.` y `Visual research is available.`, con código 0. Criterios: P1.A2.
- **R4** — SI existe solo uno de `UX.md` o `ux.json` ENTONCES el sistema DEBERÁ nombrar el archivo faltante, fijar `mode = "reference-only"`, registrar el finding `UX_INCONSISTENT` y no crear ni inferir el archivo faltante. Criterios: P1.A3.
- **R5** — SI `ux.json` existe pero no cumple el lector provisional `UxContract` (D5) o `UX.md` no es UTF-8 con al menos 1 carácter no blanco ENTONCES el sistema DEBERÁ fijar `mode = "reference-only"` y registrar el finding `UX_CONTRACT_INVALID` con la ruta JSON de cada issue. Criterios: P1.A4.
- **R6** — CUANDO el usuario pase `--stage <NN-slug>`, el sistema DEBERÁ usar esa etapa aunque esté `cerrada`; SI la etapa no existe ENTONCES DEBERÁ salir con código 2 y listar las etapas disponibles; CUANDO no se pase `--stage` y no haya etapa `activa`, DEBERÁ usar la última `cerrada` e imprimir `No active stage; using last closed: <NN-slug>` (D22). Criterios: P1.A5.
- **R7** — CUANDO el `state.json` de la etapa declare `ux`, el sistema DEBERÁ mostrar la declaración; SI declara `md` ENTONCES el modo DEBERÁ ser `reference-only` con un mensaje que atribuya la decisión al harness (D6); SI la declaración no coincide con los archivos presentes ENTONCES DEBERÁ registrar `UX_DECLARATION_MISMATCH`; el lector DEBERÁ aceptar fases y modos del harness que no conoce sin fallar. Criterios: P1.A11.

**Estado y persistencia**

- **R8** — El sistema DEBERÁ modelar el workflow como una tabla de transiciones explícita donde cada transición declara una precondición verificable; SI el modo es `reference-only` ENTONCES toda transición hacia un estado de producción DEBERÁ devolver `MODE_BLOCKED`, y todo par (fase, evento) fuera de la tabla DEBERÁ rechazarse con una razón nombrada. Criterios: P1.A6.
- **R9** — CUANDO se apruebe un gate, el sistema DEBERÁ registrar identidad, fecha y el sha256 de cada artefacto atado; SI cambia el hash de un artefacto atado ENTONCES la aprobación DEBERÁ quedar invalidada. Criterios: P1.A7.
- **R10** — El sistema DEBERÁ escribir `.heron/` con escrituras atómicas (temporal + fsync + rename) y `state.json` como punto de commit; SI una escritura se interrumpe ENTONCES `state.json` DEBERÁ seguir siendo válido y ningún artefacto referenciado DEBERÁ faltar; SI un segundo proceso intenta escribir con el lock tomado ENTONCES DEBERÁ salir con código 6 en ≤ 1 s. Criterios: P1.A8.
- **R11** — SI un documento persistido tiene un `schemaVersion` mayor al soportado ENTONCES el sistema DEBERÁ fallar con un mensaje que nombre la versión soportada. Criterios: P1.A9.
- **R12** — El sistema NO DEBERÁ escribir fuera de `.heron/` del repo destino durante `init` y `status`. Criterios: P1.A10.
- **R13** — CUANDO se ejecuten `heron init` y `heron status` sobre el fixture `membership-product`, el p95 de 20 ejecuciones DEBERÁ ser ≤ 2 000 ms (D16). Criterios: P1.A12.

**Estructura y calidad**

- **R14** — El código DEBERÁ vivir en un solo paquete con módulos por frontera (D4); ningún módulo DEBERÁ importar `navori` ni `@navori/*`, los adapters NO DEBERÁN importarse entre sí y `core/contracts` NO DEBERÁ importar módulos internos. Criterios: P1.A13.
- **R15** — El sistema DEBERÁ generar los JSON Schemas de sus contratos desde Zod a `schemas/`, versionados en el repo y sin deriva frente a los schemas Zod. Criterios: P1.A14.
- **R16** — El repo DEBERÁ exponer `bun run check` (formato, lint, typecheck, tests con cobertura ≥ 90 % en contratos, estado y store, ≥ 80 % global, deriva de schemas y test de fronteras) y un workflow de GitHub Actions que lo ejecute con `bun install --frozen-lockfile` en PR y en `main` (D21). Criterios: P1.A15, P1.A16.
- **R17** — `README.md` DEBERÁ permitir instalar `heron` desde un clon con `bun link` (D20) y obtener la primera salida de `heron init` en ≤ 10 min. Criterios: P1.A17.
