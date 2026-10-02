# Decisiones — Etapa 01-heron

## D1

- Pregunta: Fase `mapped`, resultado de `navori master check --fit` (V2, V3, V5 y V6 fallan; J1 y J3 no se sostienen y J2 sí vale comparar arquitecturas). ¿Cambiar a spec o seguir con el plan maestro?
- Elegida: Seguir con el plan maestro
- Descartadas: Cambiar a spec
- Fecha: 2026-09-30

## D2

- Pregunta: plan2 y plan3 encontraron, cada uno por su lado, que navori-harness `origin/main` (44afd638) no produce `UX.md` ni `ux.json`. ¿Quién es dueño de ese contrato y en qué estado está?
- Elegida: El contrato lo define navori-harness y se está construyendo ahora, a partir de la spec de Heron (dicho por el usuario el 2026-09-30). Evidencia local: rama `feat/master-plan-ux-contract` de navori-harness (commit f16638bc más cambios sin commitear), `packages/cli/src/lib/master/ux.ts`. Ahí la fase `ux` registra `navori master ux <none|md|md-json>` y valida por ahora solo la presencia de los archivos; el esquema del contenido todavía no existe (`checkUxContent` vacío).
- Descartadas: Que Heron defina el contrato por su cuenta (lo prohíbe context/md/PLAN.md §2).
- Fecha: 2026-09-30

## D3

- Pregunta: Q-A · ¿Qué estructura y orden de entrega usamos?
- Elegida: plan1: 10 partes, valor primero (P1 init/modo · P2 research seguro sin IA · P3 agentes + direcciones · P4 contrato UX + ProductContext · P5 slice full · P6 Penpot · P7 todas las pantallas + revise + reviewer · P8 Web UI · P9 self-host + hardening · P10 Refero)
- Descartadas: plan2 (14 partes, cimientos primero); plan3 (7 partes, reuso)
- Fecha: 2026-09-30

## D4

- Pregunta: Q-B · ¿Cómo estructuramos el código?
- Elegida: Un solo paquete con módulos por frontera en `src/` y test de fronteras; se divide cuando exista un segundo entregable real
- Descartadas: 5 paquetes + 2 apps (plan2); 7 paquetes + 3 apps (plan3)
- Fecha: 2026-09-30

## D5

- Pregunta: Q-C · ¿Cómo consume Heron `ux.json` mientras el harness no publica su schema?
- Elegida: Lector provisional (subconjunto mínimo de IDs y relaciones, preserva campos desconocidos, marcado provisional) y, cuando el harness publique un JSON Schema versionado, copia fijada por sha256 que reemplaza al provisional
- Descartadas: Esperar al schema del harness
- Fecha: 2026-09-30

## D6

- Pregunta: Q-D · ¿Cómo se comporta Heron cuando el harness declara `state.json.ux = "md"` (solo UX.md)?
- Elegida: `reference-only` con mensaje que muestra la declaración del harness; sin uso parcial de UX.md
- Descartadas: Uso parcial de UX.md como contexto de research
- Fecha: 2026-09-30

## D7

- Pregunta: Q-E · ¿Qué versión de Penpot fijamos?
- Elegida: Penpot 2.17.2, con sonda de 2.18.x al abrir P6 (subir solo si el bug #12003 está resuelto)
- Descartadas: 2.18.0
- Fecha: 2026-09-30

## D8

- Pregunta: Q-F · ¿El export de producción exige haber sincronizado con Penpot?
- Elegida: Se permite exportar sin Penpot: `penpot.enabled = false` registrado en `project.json`, `penpot: "disabled"` en el manifest y WARNING en la categoría "Penpot sync"; con Penpot activo se exige el gate `visual-review`
- Descartadas: Exigir `penpot-synced` (orden literal de §41)
- Fecha: 2026-09-30

## D9

- Pregunta: Q-G · ¿Con qué construimos la Web UI propia de Heron?
- Elegida: Hono 4.13.12 con JSX renderizado en servidor sobre Bun.serve, islas mínimas de TS, sin pipeline de build
- Descartadas: Bun.serve sin framework (plan1); SPA React + Mantine (plan3)
- Fecha: 2026-09-30

## D10

- Pregunta: Q-H · ¿Dónde corren los pasos de IA en self-host V1?
- Elegida: Solo en el host, donde están los CLIs con sesión; la web en Docker es control plane (research, revisión, aprobación de gates). Sin cola de jobs ni SQLite en V1
- Descartadas: CLIs autenticados dentro del contenedor
- Fecha: 2026-09-30

## D11

- Pregunta: Q-I · ¿Cómo se autentica la Web UI en V1?
- Elegida: Tokens nombrados definidos por el operador (se guarda solo su sha256), cookie de sesión firmada, nombre del token en `approvedBy`; escucha en 127.0.0.1 por default y se niega a exponerse sin tokens
- Descartadas: Token único de operador
- Fecha: 2026-09-30

## D12

- Pregunta: Q-J · ¿Se puede marcar una dirección favorita en reference-only?
- Elegida: Sí, `direction select` en reference-only registra `preferred` (nunca `direction-selected`); al pasar a full se hereda como insumo y exige un gate `direction` nuevo
- Descartadas: Bloquear la selección en reference-only
- Fecha: 2026-09-30

## D13

- Pregunta: Q-K · ¿Mantenemos Refero en esta etapa?
- Elegida: Mantener P10 como parte opcional (Should) al final; solo se abre si el usuario tiene plan y tras verificar los términos de uso; nada depende de ella
- Descartadas: Diferir a otra etapa; adelantarlo como prioridad desde P3
- Fecha: 2026-09-30

## D14

- Pregunta: Q-L · ¿En qué idioma va el copy de Heron?
- Elegida: CLI y Web UI en inglés (como la salida de ejemplo del brief); artefactos generados (`DESIGN.md`, `REFERENCES.md`, notas de pantalla) en el idioma del producto consumido; docs del repo de Heron en español (`language: es`)
- Descartadas: Todo en español; todo en inglés
- Fecha: 2026-09-30

## D15

- Pregunta: Q-M · ¿Las imágenes de `.heron/` van a Git directo o a Git LFS?
- Elegida: Git directo con límites: imágenes saneadas y re-encodeadas a WebP, dedupe por sha256, aviso en `heron status` al pasar un umbral
- Descartadas: Git LFS
- Fecha: 2026-09-30

## D16

- Pregunta: Q-N · ¿Se acepta el paquete de umbrales?
- Elegida: Aceptado: ≥ 5 referencias con provenance para `research-ready`; variante de marca Δhue OKLCH ≤ 10°; imágenes ≤ 20 MB y ≤ 50 MP; p95 `init`/`status` ≤ 2 000 ms; target mobile ≥ 44×44 pt y web ≥ 24×24 CSS px; logs locales 30 días; `UX-PROPOSAL` = cualquier cambio en pantallas, flows, estados, acciones o navegación (no el naming solo visual). Todos configurables salvo los de WCAG
- Descartadas: Paquete más estricto (≥ 8 refs, Δhue ≤ 6°, ≤ 10 MB / 2 560 px, p95 ≤ 1 000 ms)
- Fecha: 2026-09-30

## D17

- Pregunta: Q-O · ¿Con qué se prueba por primera vez el modo full?
- Elegida: Generar en esta etapa un master-plan con UX para `monorepo-fullstack` y probar full con ese producto real (depende de que el harness emita UX.md/ux.json, D2); el fixture `membership-product` se mantiene para los tests automatizados
- Descartadas: Validar full solo sobre el fixture en V1
- Fecha: 2026-09-30

## D18

- Pregunta: Q-P · ¿Qué agentes CLI se usan?
- Elegida: Claude Code (Claude Max) y Codex CLI (ChatGPT) con sesión; configurable creator/reviewer; P3 verifica los términos de uso programático de las suscripciones y los registra antes de depender de ellos
- Descartadas: Solo Claude Code; solo Codex
- Fecha: 2026-09-30

## D19

- Pregunta: Seguimiento de D17 · ¿Cómo entra en la etapa la validación full sobre `monorepo-fullstack`?
- Elegida: Parte nueva P11 "Validación full con producto real" después de P7, con dependencia externa explícita (harness con UX en `main` y master-plan con UX del monorepo); cierra cuando Heron recorre full sobre `monorepo-fullstack` hasta el export con "Aprobado"; P1–P7 siguen sobre el fixture
- Descartadas: Criterio manual dentro de P5 y P7
- Fecha: 2026-09-30

## D20

- Pregunta: Q-Q · ¿Cómo se distribuye el CLI en V1?
- Elegida: `bun link` desde un clon; binario `bun build --compile` como Could; paquete npm fuera de esta etapa
- Descartadas: Paquete npm; binario compilado como forma principal
- Fecha: 2026-09-30

## D21

- Pregunta: Q-R · ¿Agregamos CI?
- Elegida: GitHub Actions con `bun install --frozen-lockfile && bun run check` en PR y en `main` desde P1, en cuanto exista el remoto
- Descartadas: Sin CI en V1
- Fecha: 2026-09-30

## D22

- Pregunta: Q-S · ¿Qué etapa usa `heron init` sin `--stage` cuando no hay etapa activa?
- Elegida: La última `cerrada`, avisándolo en la salida; `convertida` o `abandonada` solo con `--stage` explícito
- Descartadas: Exigir `--stage`
- Fecha: 2026-09-30

## D23

- Pregunta: ¿Qué debe mostrar cada una de las 3 propuestas de dirección visual antes de elegir?
- Elegida: Un specimen visual por dirección (paleta con contraste, escala tipográfica, hoja de componentes básicos y una composición genérica marcada SYNTHETIC); en `full`, además, 2 pantallas representativas reales de `ux.json` con los tokens provisionales de la dirección. Solo después de aprobar una se genera el sistema completo
- Descartadas: Solo specimen en ambos modos; flow representativo completo por dirección
- Fecha: 2026-09-30

## D24

- Pregunta: ¿Dónde se revisan y comparan las 3 propuestas?
- Elegida: Solo en Penpot: una página por dirección, escrita por el compilador determinista
- Descartadas: Preview HTML estático desde P3 con Web UI y Penpot después
- Fecha: 2026-09-30

## D25

- Pregunta: ¿Cómo se reacomoda el plan para revisar las propuestas en Penpot?
- Elegida: Dividir Penpot: nueva parte P12 "Penpot base" (instalación oficial, MCP, doctor, compilador base y páginas de propuestas por dirección) que depende de P3; P5 pasa a depender de P12; P6 se reduce a "Penpot: sistema completo" (tokens, componentes, pantallas, drift, visual-review). Los IDs existentes no se renumeran; el orden lo dan las dependencias
- Descartadas: Mover la parte de Penpot completa antes de P5
- Fecha: 2026-09-30

## D26

- Pregunta: Si Heron corre con Penpot desactivado, ¿cómo se elige la dirección?
- Elegida: Penpot es obligatorio para pasar el gate `direction` en `full` (revisión de las 3 páginas de propuestas). D8 queda limitado: se puede exportar sin sincronizar el sistema completo en Penpot, pero solo si la dirección se eligió en Penpot. En `reference-only`, registrar `preferred` (D12) no exige Penpot
- Descartadas: Opt-out explícito `--without-visual-review` con WARNING
- Fecha: 2026-09-30

## D27

- Pregunta: Si la declaración `ux` del harness no coincide con los archivos presentes, ¿qué modo aplica Heron?
- Elegida: Forzar `reference-only` y emitir `UX_DECLARATION_MISMATCH` hasta que declaración y archivos coincidan (design de P1, DP11)
- Descartadas: Calcular el modo solo desde los archivos y emitir el desajuste como WARNING
- Fecha: 2026-09-30

## D28

- Pregunta: ¿De dónde se pueden importar imágenes y DESIGN.md locales en `heron references add` (P2)?
- Elegida: También de rutas fuera del repo cuando el usuario las pasa explícitamente: se leen una vez, se sanean y se copian a `.heron/research/assets/<sha256>.webp`; la provenance guarda solo el nombre del archivo, nunca la ruta absoluta; symlinks que escapan y `..` siguen rechazados
- Descartadas: Solo rutas dentro del repo del producto
- Fecha: 2026-09-30

## D29

- Pregunta: ¿Qué URLs públicas acepta la fuente `url` (P2)?
- Elegida: `https` en cualquier puerto; sin `http` público; `http` solo para destinos locales con `--allow-local`; el control de SSRF es la validación de IP/DNS
- Descartadas: Solo `https` en el puerto 443
- Fecha: 2026-09-30

## D30

- Pregunta: El criterio P4.A7 (`bun run heron intake --json fixtures/membership-product`) falla tal cual con `NOT_INITIALIZED`, porque el fixture no tiene `.heron/` y los tests nunca escriben en `fixtures/`. ¿Cómo se enmienda?
- Elegida: Correr `init` + `intake` sobre una copia temporal del fixture: `d="$(mktemp -d)" && cp -R fixtures/membership-product/. "$d" && bun run heron init "$d" >/dev/null && bun run heron intake --json "$d"`, con el mismo resultado esperado más "`fixtures/` sin cambios" (spec 0004, DR29)
- Descartadas: `heron intake --dry-run --json fixtures/membership-product` (solo prueba el cálculo); `intake` sin `.heron/` como dry run implícito; `intake` que inicializa implícitamente (escribiría en `fixtures/`)
- Fecha: 2026-10-01

## D31

- Pregunta: P4.A5 pide que los campos desconocidos de `ux.json` se preserven "byte a byte", pero el `ProductContext` es JSON canónico y `JSON.parse` pierde precisión en enteros mayores que 2^53. ¿Se mantiene el texto literal?
- Elegida: Enmendar P4.A5: los campos desconocidos conservan su clave, su orden y su valor en JSON canónico, los IDs no cambian y `ux.json` nunca se reescribe (sha256 igual); los enteros mayores que 2^53 conservan el valor de `JSON.parse` (límite documentado) (spec 0004, DR32)
- Descartadas: Guardar el fragmento crudo de cada campo con un escáner JSON propio (literalmente byte a byte); valor canónico más sha256 del fragmento crudo
- Fecha: 2026-10-01

## D32

- Pregunta: RF-5 define `heron intake [--refresh]`, pero cada corrida de `intake` ya relee las fuentes y escribe solo si cambian los bytes. ¿Qué pasa con `--refresh`?
- Elegida: Se acepta como alias sin efecto y el texto de uso lo dice; RF-5 queda literal con esa nota (spec 0004, DR31)
- Descartadas: Quitarlo y enmendar RF-5; darle un significado propio (reescribir aunque nada cambie o renumerar conflictos)
- Fecha: 2026-10-01

## D33

- Pregunta: ¿Qué corre en cada punto del flujo (pre-commit, PR a `develop`, PR y push a `main`) para evitar ciclos de retrabajo? Reemplaza la política de D21 (`bun run check` en cada PR)
- Elegida: Pre-commit = `bun run check:fast` (formato, lint, typecheck y solo los tests `tests/**/*.test.ts` incluidos en el commit); PR a `develop` = solo jscpd y semgrep; PR y push a `main` = gate completo (`format:check`, `lint`, `typecheck`, `test:coverage`) más `test:perf` como paso obligatorio propio; `qualityGate.full` sigue siendo `bun run check` para los revisores
- Descartadas: Mantener `bun run check` completo en pre-commit y en cada PR (D21); jscpd y semgrep como hooks de pre-commit; correr todo el gate en PR a `develop`
- Fecha: 2026-10-01
