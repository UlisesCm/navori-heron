# 0002 Research reference-only — Requirements

## Context

Parte P2 del master-plan `01-heron` (`specs/_master/01-heron/MASTER.md`, `parts.json` › P2): el diseñador registra y revisa referencias visuales y datos de marca con provenance completa, **sin IA**, en el workspace `.heron/` versionable, con defensas frente a contenido externo (SSRF, rutas, metadata de imágenes, texto con forma de instrucción). Al cerrar, el research de un producto real queda en `.heron/research/` con un moodboard HTML estático revisable en el navegador, todo marcado `reference-only` cuando aplica.

Incluye primero los refactors previos a P2 acordados en las convenciones de arquitectura (skill `heron-architecture`, decisiones OD1 = C′, OD2, OD3, OD4). Decisiones aplicables: D12, D14, D15, D16, D24 (las propuestas visuales en Penpot no son parte de P2), RN-5, RN-11, RN-12, RN-14, RN-36, RN-37, RN-38, RN-40.

## Requirements (EARS)

**Refactors previos (base de P2)**

- **R1** — CUANDO un caso de uso escriba en `.heron/`, el sistema DEBERÁ hacerlo dentro de un único envoltorio de escritura que tome el lock, recupere el staging huérfano (finding `STAGING_RECOVERED`), ejecute el cuerpo, haga commit y libere el lock aunque el cuerpo falle; `heron gate` DEBERÁ usarlo, de modo que también recupere staging huérfano (hoy solo `init` lo hace).
- **R2** — El sistema DEBERÁ emitir la salida de todos los comandos (texto o `--json` `CliEnvelope`) mediante una sola función de emisión, sin repetir esa lógica en cada handler.
- **R3** — Las reglas de fronteras entre módulos DEBERÁN expresarse como tablas de datos (capas, vendors y tokens prohibidos) con autoverificación por fila, cubriendo los módulos nuevos de P2 (`src/security/`, `src/research/`); un import o efecto fuera de lo permitido DEBERÁ hacer fallar `tests/repo/boundaries.test.ts`.
- **R4** — Los documentos persistidos DEBERÁN guardar los códigos de finding como cadenas con patrón `^[A-Z][A-Z0-9_]*$` mientras el tipo TypeScript `FindingCode` sigue siendo una unión cerrada (OD1 = C′); los ids de adapter DEBERÁN declararse completos (`navori-master`, `filesystem`, `markdown`, `manual`); un `.heron/` creado por P1 DEBERÁ seguir leyéndose sin `DOCUMENT_INVALID`.
- **R5** — Todo código de salida DEBERÁ provenir de `ExitCode` (sin literales numéricos en `src/app/**`).

**Referencias y provenance**

- **R6** — CUANDO el usuario ejecute `heron references add --source manual …` con todos los campos, el sistema DEBERÁ persistir en `.heron/research/references.json` una referencia con `source`, `origin`, `capturedAt` (ISO-8601), `reason`, `studies[]`, `doNotCopy[]`, `influences[]` y `mode`. Criterios: P2.A1.
- **R7** — SI una referencia carece de alguno de los campos de provenance ENTONCES el sistema DEBERÁ salir con código 2, nombrar los campos faltantes y no escribir nada. Criterios: P2.A2.
- **R8** — El sistema DEBERÁ ofrecer `heron references list|show|compare|remove`, importación por lote desde un archivo JSON y crops `--crop x,y,w,h` con nota por zona, y DEBERÁ aceptar las fuentes `manual`, `url`, `image` (archivo local o screenshot) y `design-md` (archivo o URL) a través del puerto `ResearchSource`. Criterios: P2.A1, P2.A9.

**Seguridad de ingesta**

- **R9** — CUANDO una fuente obtenga una URL, el sistema DEBERÁ permitir solo `https` (y `http` solo con autorización local explícita), resolver el DNS y validar cada IP, conectar a la IP validada con SNI, revalidar cada redirección (máximo 3), aplicar timeout de 10 s y límites de cuerpo; SI el destino es loopback v4/v6, 10/8, 172.16/12, 192.168/16, 100.64/10, 169.254.169.254, fc00::/7, fe80::/10, IPv4 mapeada en IPv6, una forma decimal/octal/hexadecimal de IP, `file:`, `ftp:`, `gopher:`, `data:`, una redirección a IP privada o un rebinding ENTONCES DEBERÁ bloquearlo con `SSRF_BLOCKED`; CUANDO el usuario pase `--allow-local`, DEBERÁ permitir el destino local y registrarlo en la provenance. Criterios: P2.A3.
- **R10** — SI una ruta de imagen contiene `..`, es absoluta fuera de las raíces permitidas o es un symlink que escapa ENTONCES el sistema DEBERÁ rechazarla con `UNSAFE_PATH`. Criterios: P2.A4.
- **R11** — CUANDO se importe una imagen, el sistema DEBERÁ verificar magic bytes PNG/JPEG/WebP, rechazar archivos > 20 MB o > 50 MP (D16), re-codificarla a WebP sin bloques EXIF/GPS/XMP y guardarla nombrada por sha256 de modo que dos imports del mismo contenido produzcan un solo asset (D15). Criterios: P2.A5.
- **R12** — CUANDO se ingiera contenido externo (DESIGN.md, página, texto de referencia), el sistema DEBERÁ guardarlo como dato `trust: "untrusted"`, registrar en `securityFindings` cada frase con forma de instrucción (frase y offset) y no cambiar su comportamiento por ese contenido. Criterios: P2.A6.

**Salidas y marca**

- **R13** — CUANDO el usuario ejecute `heron research render`, el sistema DEBERÁ generar `.heron/research/REFERENCES.md` (derivado de JSON), `references.json`, `provenance.json` y `moodboards/index.html` (HTML estático, sin recursos externos, con CSP restrictiva y todo texto escapado), y cada salida DEBERÁ declarar el modo (`reference-only` cuando aplique). Criterios: P2.A7.
- **R14** — CUANDO el usuario ejecute `heron brand add --kind <tipo> --origin <origen>`, el sistema DEBERÁ exigir un origen válido (`provided`, `derived`, `inferred`, `reference-derived`) y uno de los 11 tipos de §12; SI falta el origen ENTONCES DEBERÁ salir con código 2 sin escribir. Criterios: P2.A8.
- **R15** — CUANDO haya ≥ 5 referencias con provenance completa (D16), el sistema DEBERÁ permitir la transición a `research-ready` y el gate `research`; con menos, la precondición DEBERÁ fallar nombrando el conteo. Criterios: P2.A9.
- **R16** — El sistema DEBERÁ funcionar en un producto real: con ≥ 5 referencias reales (≥ 1 screenshot con crop, ≥ 1 URL, ≥ 1 DESIGN.md externo), cada tarjeta del moodboard DEBERÁ mostrar fuente, razón, qué se estudia, qué no copiar y el crop resaltado. Criterios: P2.A9.

**Documentación**

- **R17** — El repo DEBERÁ incluir el ADR de la frontera de fuentes de research, `docs/research.md` y la sección SSRF de `docs/security.md`.
