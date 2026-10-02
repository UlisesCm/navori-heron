# ADR 0007: Frontera de Penpot

- Estado: aceptada
- Fecha: 2026-10-02
- Referencias: `specs/0005-penpot-base/design.md` (DR6–DR18, DR33, DR43–DR47); D7, D8, D23–D26.

## Contexto

Penpot es un lienzo editable, no la fuente de verdad. Las propuestas provienen de contratos locales y contienen texto externo. El MCP oficial ejecuta código dentro del archivo abierto y autentica con una key en la URL; una URL tomada del repo podría enviar esa key a otro servidor. Además, una escritura remota no puede participar en la transacción de `.heron/`.

## Decisión

1. **Puerto y registro.** `PenpotGateway` abre un `PenpotCodeRunner`; `PenpotSession` valida los resultados de inspección y aplicación. `src/penpot/registry.ts` expone `defaultPenpotGateway` y es el único importador de `mcpGateway`. `@modelcontextprotocol/sdk` 1.31.0 queda aislado en `adapters/mcp/`; `mcpFetch` vive en `security/fetch/system.ts`. Los errores son uniones discriminadas, no errores crudos.
2. **Destino local explícito.** Solo `AppContext.env` aporta `PENPOT_URL` y exactamente una de `PENPOT_MCP_KEY` o `PENPOT_MCP_KEY_FILE`. El launcher ignora `.env` y `bunfig.toml` del cwd. `project.json` guarda `enabled` y `fileId`, con `url: null` y `version: null`. No se siguen redirects. Se admite HTTPS o HTTP loopback; no se aplica a este destino confiado la captura SSRF de research ni se resuelve DNS para validarlo.
3. **Compilador puro.** `src/penpot/compiler/` transforma contratos e inspecciones en nodos y planes deterministas. `renderScript` es el único productor del código enviado: un literal JSON doblemente serializado, compacto con orden canónico, seguido de la plantilla exacta. No se interpolan datos como código ni se acepta código de IA. `PENPOT_TEMPLATES` importa texto versionado y registra sha256; `inspect@v1` y `review-page@v1` quedaron congeladas tras T12. Un cambio requiere `@v2`.
4. **Presupuesto medido.** El script completo UTF-8 no excede 32 KiB, política local confirmada por el spike, no límite oficial de Penpot. Una propuesta grande falla antes de conectar. References conserva el mayor prefijo que cabe, hasta 48 tarjetas de texto, y avisa las omisiones. El transporte compacto no cambia `canonicalJson` ni las huellas persistidas.
5. **Propiedad y recuperación.** Las páginas y formas llevan marcas `heron`. La huella `content` se borra al empezar y se escribe al final solo tras verificar las identidades esperadas. Solo se reemplazan formas marcadas; una forma humana dentro de un tablero propio bloquea la reescritura. Los duplicados se informan y no se borran. No se detectan ediciones humanas dentro de formas marcadas (drift, P6).
6. **Red fuera del lock.** Link y sync inspeccionan fuera del lock sobre revisión R y persisten con `expectedRevision = R`. Sync detiene el plan ante el primer fallo, reinspecciona y registra solo páginas confirmadas en `penpot/review-sync.json`. No hay rollback remoto: exit 5 puede traer datos parciales y exit 6 deja las páginas remotas para reconciliar en la siguiente corrida. Las banderas seleccionan escrituras, no eliminan del registro otras páginas actuales confirmadas. La segunda corrida sin cambios no escribe local ni remotamente.
7. **Secretos y diagnóstico.** Key de archivo y entorno se redactan antes de truncar errores o emitir datos, findings y logs. La metadata exitosa tampoco es confiable. La terminal escapa C0, DEL y C1. `penpot.error` se abre de forma perezosa en el workspace cargado, una vez por invocación fallida; inspect, doctor y dry-run no escriben logs. `PENPOT_TESTED_VERSIONS` gobierna avisos, no bloqueos. El doctor general agrega los siete checks solo si el archivo está vinculado.

## Alternativas consideradas

- **SDK en app o comandos.** Acopla transporte y casos de uso; se descarta y las fronteras lo prohíben.
- **URL en project.json o `.env` del producto.** Permite exfiltrar la key desde un repo ajeno; se descarta.
- **Scripts generados por el agente o interpolación directa.** Ejecuta datos no confiables; se descarta.
- **Transacción distribuida o rollback de páginas.** Penpot no comparte el commit local; se elige convergencia por inspección y huellas.
- **Actualizar 2.17.2 por una sonda exitosa.** La sonda aislada 2.18.1 no demuestra la corrección general de #12003; A7 conserva la versión fijada.

## Consecuencias

- Las propuestas son páginas de revisión: no escriben `design/**`, `penpot/sync-state.json`, validación ni export. En `reference-only` llevan banda y marca de modo; References usa texto, no imágenes.
- Un timeout no garantiza que el script se haya detenido: espera a que Penpot quede libre antes de repetir. Las formas humanas se mueven fuera de los tableros propios para permitir actualizar.
- Los tests por default usan `refusingGateway` o dobles; las pruebas vivas son opt-in y mutan únicamente un archivo desechable autorizado. La aceptación A8 sobre el producto real sigue siendo manual.
- Guía operativa y evidencia: [Penpot](../penpot.md). Fronteras ejecutables: `tests/repo/boundaries.test.ts`, sin duplicar sus tablas en producción.
