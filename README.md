# Buzón de ensayo — formulario original MIT

Ejemplo local de UI + backend HTTP, **sin envío de correo ni almacenamiento de contactos**.
Usa solo datos ficticios (demo@example.invalid). Ninguna API externa ni CAPTCHA se
invoca. La confirmación significa «validado en este proceso», nunca «correo enviado».

## Reproducir

Node **22.23.3** (`.nvmrc` / `.node-version`). Sin dependencias externas.

```sh
node --version
npm ci --ignore-scripts --offline
npm run check
npm test
PORT=8080 npm start
```

Abre **http://127.0.0.1:8080/**. No usar localhost indistintamente: el origen
exacto predeterminado es 127.0.0.1. El servidor se enlaza sólo a loopback. `PORT=0`
selecciona puerto libre para pruebas. `FORM_ORIGIN` admite un origen HTTP(S)
exacto sin ruta; es configuración pública, no contraseña. Cambiarlo no configura
DNS/HTTPS ni publica este servidor. No instalar daemon Docker para esta demo.

## Contrato

- GET/HEAD `/`, `/form.css`, `/form.js`, `/envelope.svg`, `/healthz`; otras rutas
  exactas dan404. POST sólo `/api/contact`; otros métodos405.
- POST requiere Origin exacto y Fetch Metadata same-origin si está presente.
  Falta/mismatch/null:403. Sin CORS ni cookies; no aceptar Origin generado del Host.
- Sólo JSON UTF8:415 para tipo/encoding no soportado; JSON o UTF8 inválidos400.
- Cuerpo máximo **4096 bytes** declarados o por stream:413; lectura incompleta
  tres segundos:408. Node configura también límites de headers/request.
- Campos exactos string: name2–80, email hasta254 con comprobación sintáctica,
  message10–1000, website vacío (honeypot). Desconocidos/tipos/controles inválidos422.
  La sintaxis email no prueba propietario, existencia ni capacidad de entrega.
- Cinco intentos POST por minuto por dirección de socket, incluidos inválidos:
  después429/Retry-After60. Hasta1024 buckets; agotamiento falla cerrado.
  No se confía X-Forwarded-For. Limpiado al expirar; memoria local por proceso.
- Éxito200 `{accepted:true,delivery:"not-sent",receipt:…}`: no se refleja ni guarda
  nombre, email ni texto. Sólo contador agregado/UUID de respuesta. No logs de cuerpos.
- Assets/CSP self/no-store/nosniff; UI usa textContent para mensajes de error.
- SIGTERM/SIGINT cierra el servidor, deadline5s. Reinicio borra contador/limitador.

Origin y honeypot **no verifican humanos**: un bot puede falsificar headers o dejar
el campo vacío. El límite básico no es protección distribuida, DDoS ni garantía de
seguridad. Tras proxy todos pueden compartir dirección; exige configurar una cadena
proxy de confianza y límites compartidos antes de publicar, no confiar headers libremente.

## Evidencia y límites

Tests HTTP reales con Node22.23.3 cubren aceptación sintética, rechazo de origen,
tipo/tamaño declarado+stream/UTF8/JSON/campos, honeypot,429, headers proxy ignorados,
404/métodos/activos, memoria reiniciada, configuración inválida y timeout.
Chrome390/1280 verifica UI real inicial/éxito/error429 sin overflow, assets propios y
POST exclusivamente loopback. No correo enviado. Sin imagen OCI, CI remoto, servicio,
dominio público, OAuth, push automático, DB, compras ni clientes probados/modificados.

## Arquitectura antes de una guía pública

Esta fase prueba **formulario → validación local → confirmación explícita sin envío**.
Un sitio estático necesita un backend para correo, o un proveedor que asuma esa función.
Para hosting Node haría falta plan con servicios/cuota y configuración de red/proxy;
esta demo local no promete servicios gratuitos ni compatibilidad de despliegue validada.

Antes de correo real: elegir proveedor, remitente/destinatario fijos del operador y
pruebas en sandbox autorizado; secreto sólo servidor, dominio verificado cuando proceda,
Reply-To validado (no permitir elegir To/From desde cliente), timeout/reintentos/idempotencia,
errores de proveedor y rebotes. Aceptación de API no prueba recepción en bandeja.
No se ha contratado ni contactado ningún proveedor. Resend se documenta como ejemplo,
no recomendación exclusiva ni integración presente.

Antes de Turnstile: widget/sitekey públicos y **secret sólo servidor**, Siteverify
obligatorio, comprobar success/hostname/action esperados, fallo cerrado y manejo de
expiración/replay. Widget visible solo no protege. No se instala widget falso, no se
valida un token ficticio como si fuera real. Falta probar integración autorizada,
DNS/HTTPS, privacidad/retención y entrega antes de una guía de «correo funcionando».

## Fase2: adaptadores inyectables, exclusivamente mocks locales

`pipeline.mjs` recibe funciones verify/deliver; `mock-adapters.mjs` proporciona
escenarios sintéticos sin sockets/correo/proveedor. Normalmente no se activa:
continúa `delivery:not-sent`, validación local sin challenge. Sólo para tests,
`NODE_ENV=test` junto a `FORM_TEST_MOCK_SCENARIO` explícito permite inyectarlos
al endpoint; fuera de test el proceso se niega a arrancar con esa variable.
La UI normal no pretende resolver challenges ni añadir un widget.

En mockmode, JSON incluye `challengeToken` sintético y header `Idempotency-Key`
con forma UUID. Verifier requiere success true, hostname local.test/action contact;
son valores de ensayo, no identidad humana. Respuesta success conserva not-sent y
etiquetas verification/providerAcceptance mock-only. No significa inbox ni entrega.

Cada clave se liga a hash de campos/token: contenido distinto409. Reintentos
concurrentes comparten promesa y llaman una vez a mocks; resultados/fallos se
conservan cinco minutos. Reutilizar token con otra clave409, incluso en paralelo.
Capacidad256, falla cerrado503; entradas pendientes no se expulsan por TTL.
Tras reinicio o expiración no existe garantía de idempotencia/replay distribuida.
Se guardan claves/hashes/resultados, no texto/email/nombre en el caché; los datos
son transitorios durante la petición/adaptador. Nunca se loguean tokens/cuerpos.

Rechazo/mismatch del verifier403; fallo upstream503; timeout504; aceptación de
correo mock inválida503. Todos sin accepted:true y sin entrega real. Timeout100ms
para ensayo con AbortSignal; abortar es mejor esfuerzo, no garantía de detener
un proveedor externo que ya aceptó un envío. En producción necesitaría idempotencia
propia del proveedor y estado duradero; no reintentar un efecto incierto ciegamente.
Los fallos se cachean aquí: no hay reenvío automático. No adaptación real ni secret.

La suite añade pruebas unitarias de adaptadores y HTTP loopback para escenarios
ok/deny/error/timeout, conflictos, replay, concurrencia, capacidad/TTL y activación
prohibida fuera de test. Sigue pendiente proveedor/sandbox/Turnstile real/público.
