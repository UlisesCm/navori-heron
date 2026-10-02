# Seguridad de la ingesta de research (P2)

Research trata todo lo que viene de fuera (URLs, páginas, DESIGN.md, imágenes, rutas) como no confiable. Este documento describe las defensas que implementa P2; el diseño completo está en `specs/0002-research/design.md` (§Contracts 5) y la frontera de fuentes en el [ADR 0003](adr/0003-research-source-boundary.md).

Las primitivas viven en `src/security/` (nunca toca el filesystem). Los casos de uso las llaman a través de contextos inyectados; los tests no salen a Internet (`offlineFetcher`).

## SSRF

Toda URL (referencias `url`, `design-md --url`) pasa por `createSafeFetcher` (`src/security/fetch/safe-fetch.ts`). Solo `src/security/fetch/system.ts` contiene `fetch(` y `node:dns`; `tests/repo/boundaries.test.ts` lo verifica.

**Política de destino (D29)**

- Solo `https`, en cualquier puerto: el control es la validación de DNS e IP, no el puerto. Nunca `http` público; `http` solo con `--allow-local` y destino local. `file:`, `ftp:`, `gopher:` y `data:` se bloquean.
- Credenciales en la URL (`https://user:pass@host`): `INVALID_URL` (exit 2), sin eco de la URL.
- El DNS se resuelve una vez por salto y **todas** las direcciones se clasifican; una sola bloqueada bloquea el destino. Se conecta a la primera IPv4 validada, si no a la primera IPv6, con la IP fijada en la URL, `Host` original y SNI (`tls.serverName`) para que el certificado se valide contra el nombre.
- Cada redirección se revalida igual (máximo 3; más es `FETCH_FAILED`). Un redirect de público a local siempre se bloquea.
- Timeout de 10 s sobre toda la cadena (DNS, saltos y cuerpo). El cuerpo se limita a 2 MiB contados sobre bytes ya decodificados, lo que acota las bombas de compresión.
- Las formas no canónicas de IPv4 (decimal, octal, hexadecimal, abreviadas, con `%`) se bloquean aunque apunten a una IP pública.

**Bloques que se bloquean** (`src/security/ssrf.ts`, tabla IANA "no globalmente alcanzable"): loopback v4 y v6, `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `100.64.0.0/10`, link-local (`169.254.0.0/16`, `fe80::/10`), metadata (`169.254.169.254`, `100.100.100.200`, `fd00:ec2::254`), `fc00::/7`, IPv4 mapeada o incrustada en IPv6, multicast, `0.0.0.0/8`, documentación, benchmarking y reservados. En IPv6 solo `2000::/3` puede ser público. Una dirección que no parsea se trata como reservada (falla cerrado). `localhost` y `*.localhost` son loopback sin consultar DNS. Un rebinding (una resolución pública y otra privada) se bloquea porque la conexión usa la IP validada y un redirect al mismo host se resuelve de nuevo.

**`--allow-local`** (solo con `--url`; en `references import` aplica a todo el lote por línea de comandos, nunca por ítem). Permite únicamente loopback, privadas, `100.64.0.0/10` y `fc00::/7`, y solo si el primer destino ya era local. Nunca permite metadata, link-local, IPv4 mapeada o incrustada, multicast ni reservados. Lo permitido queda en la provenance como `LOCAL_TARGET_ALLOWED` y `fetch.local: true`.

**Resultado.** Un destino bloqueado sale con `SSRF_BLOCKED` (exit 3) y no se escribe nada; un fallo de red es `FETCH_FAILED` (exit 5). Las URLs en mensajes y en `.heron/` pasan por `redactUrl`.

## Rutas de entrada

Imagen y DESIGN.md (`--file`) y logo de marca (`brand add --file`) pueden venir de dentro del repo del producto o de una ruta explícita fuera de él (D28). Una ruta se rechaza con `UNSAFE_PATH` (exit 3, sin leer ni escribir) si:

- está vacía, contiene NUL o cualquier segmento `..`, aunque resuelva a un lugar válido;
- es un symlink que sale del repo, o una ruta externa cuyo último componente es un symlink;
- no es un archivo regular (FIFO, dispositivo, directorio);
- es un DESIGN.md externo sin extensión `.md` o `.markdown`;
- es una ruta externa listada dentro de un lote (`references import`): el archivo del lote y sus rutas solo pueden estar dentro del repo.

El archivo se lee una sola vez; los hashes y el saneado salen de esos mismos bytes. El original nunca se copia ni se modifica y en `.heron/` solo queda su nombre (basename) y si venía del repo o de fuera, nunca la ruta.

## Imágenes

Solo PNG, JPEG y WebP, verificados por magic bytes antes de decodificar (SVG y GIF se rechazan). Límites: 20 MiB y 50 megapíxeles. La imagen se re-codifica a WebP sin EXIF, GPS, XMP, IPTC ni perfil ICC, se guarda como `research/assets/{sha256}.webp` (dos imports del mismo contenido dan un asset) y la provenance anota los bloques quitados (`METADATA_REMOVED`). Detalle y justificación en el [ADR 0004](adr/0004-sharp-image-sanitizing.md). Sin sharp disponible las órdenes con imagen salen con `IMAGE_ENGINE_UNAVAILABLE` (exit 5).

## Contenido no confiable

DESIGN.md y páginas se guardan tal cual en `research/sources/{sha256}.md|.txt` con `trust: "untrusted"` (UTF-8 estricto, máximo 2 MiB; las páginas con extensión `.txt` aunque sean HTML). El escáner (`src/security/untrusted.ts`) registra en `securityFindings`, con frase, `offset` y `line`, cada texto con forma de instrucción (`SUSPICIOUS_INSTRUCTION`: ignorar instrucciones, reasignar rol, pedir el prompt o secretos, ejecutar comandos, tokens de control de chat, ocultar al usuario, saltar gates) y cada carácter oculto o bidireccional (`HIDDEN_TEXT`). Son avisos para el revisor: ningún comando lee esos hallazgos para decidir ni cambia de fase por ellos.

## Escape y CSP

Todo texto de usuario o externo se escapa al renderizar: `escapeHtml` para el moodboard y `escapeMarkdownText` para `REFERENCES.md`. Los orígenes se muestran como texto, nunca como enlace. El moodboard (`.heron/research/moodboards/index.html`) es HTML estático sin JavaScript ni recursos externos; los únicos recursos son los assets saneados por ruta relativa. Lleva un `<meta>` con esta CSP, fijada por el hash de su hoja de estilos:

```text
default-src 'none'; script-src 'none'; img-src 'self'; style-src 'sha256-rzwy3TcAlO0YYabGSUiakKOAEXNk+YnBxCXu4PfJK4E='; base-uri 'none'; form-action 'none'
```

La CSP es defensa en profundidad: el control primario es el escape total y no emitir URLs externas (Firefox no aplica `img-src` a imágenes `file:`). Un CSP por header HTTP llega con la Web UI (P8).

## Secretos en URLs

`redactUrl` quita userinfo y fragmento y sustituye por `REDACTED` el valor de los parámetros sensibles (`token`, `key`, `api_key`, `password`, `secret`, `signature`, `code`, `session`, firmas de AWS, entre otros). Se aplica a orígenes, a `fetch.requestedUrl`/`finalUrl`/`redirects` y a los mensajes. Los orígenes que parsean como URL http(s) también se redactan antes de escribirse.

## Agentes (P3)

Claude Code y Codex CLI reciben texto de terceros y devuelven texto que Heron trata como dato. Frontera y justificación en el [ADR 0005](adr/0005-ai-provider-boundary.md); banderas literales y economía de tokens en [docs/agent-providers.md](agent-providers.md).

- **Entorno por lista blanca.** `buildAgentEnv` copia solo `AGENT_ENV_ALLOWLIST` (`src/security/env.ts`), agrega `NO_COLOR=1` y nunca copia `HERON_*`, `PENPOT_*`, las API keys (`AGENT_API_KEY_VARS`) ni las rutas de nube o gateway (`AGENT_ROUTE_VARS`); lo ignorado se informa con `AGENT_ENV_IGNORED`. `CLAUDE_CODE_OAUTH_TOKEN` pasa y se trata como secreto.
- **Aislamiento del hijo.** Argv como arreglo, pack por stdin, cwd en un directorio temporal vacío y privado, grupo de procesos propio con timeout. Claude: sin herramientas, sin MCP y con `--safe-mode --restricted`. Codex: sandbox `read-only`, `--ignore-user-config`, `--ignore-rules` y sin web search (`CLAUDE_FIXED_ARGS`, `CODEX_FIXED_ARGS`).
- **Monitor de Codex por lista blanca.** Solo se admiten los eventos documentados y los ítems `agent_message` y `reasoning` (`CODEX_ALLOWED_ITEM_TYPES`). Cualquier otra cosa (un ítem de herramienta, un evento desconocido, una línea que no es JSON) detiene el proceso con `AGENT_POLICY_VIOLATION` (exit 3). Falla cerrado.
- **Redacción.** Un redactor por valor cargado (`src/security/redact.ts`) cubre el entorno permitido y los secretos conocidos: pasa por el log JSONL, por la salida del agente antes de escribirla (`SECRET_REDACTED`) y por los mensajes. stdout y stderr del hijo no se guardan.
- **Contenido del agente como no confiable.** La salida se valida con schemas estrictos y `scanUntrustedText` registra hallazgos (`AGENT_OUTPUT_SUSPICIOUS`) sin bloquear. Los ítems de un pack, salvo las instrucciones de Heron, van delimitados con `<<<data:{trust}:{sha8}>>>` y los caracteres ocultos o bidi se reescriben como `\u{XXXX}`.
- **Control characters.** En vistas y terminal se eliminan los caracteres de control C0 (salvo CR, LF y TAB, que pasan a espacio), DEL y C1 (`src/security/markdown.ts`; `src/cli/render-research.ts` para el texto libre de una referencia). Todo texto de agente en `REFERENCES.md` pasa por `escapeMarkdownText`, de modo que enlaces, imágenes y autolinks quedan inertes.
- **Lanzador.** `bin/heron.ts` arranca con `#!/usr/bin/env -S bun --no-env-file --config=/dev/null`, de modo que Bun ignora el `bunfig.toml` y el `.env` del cwd y un repo ajeno no cambia la configuración de Heron ni inyecta variables (ver §Launcher en repos no confiables; `tests/repo/launcher.test.ts`).
- **Logs.** `.heron/logs/<fecha>.jsonl`, append sin fsync, poda a 30 días y todo por el redactor. Eventos de P3: `agent.invocation` y `security.finding`.
- **Suscripción.** Sin API key; el uso es individual con el binario oficial. El riesgo aceptado frente a los términos está en [agent-providers.md](agent-providers.md#términos).

## Fuera de alcance de P2

Sink de logs JSONL y redacción por valor cargado (entran en P3, ver arriba), subida de archivos y CSP por header (P8), imágenes por URL y SVG, y `http` público (descartado por D29).

## Launcher en repos no confiables

`bin/heron.ts` arranca con `#!/usr/bin/env -S bun --no-env-file --config=/dev/null` (y `bun run heron` usa los mismos flags): Bun 1.4.2 ejecutaría el `preload` del `bunfig.toml` y cargaría el `.env` del directorio actual, que en un repo no confiable es input hostil (`tests/repo/launcher.test.ts`).
