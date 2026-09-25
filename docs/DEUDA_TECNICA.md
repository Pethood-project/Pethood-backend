# DEUDA_TECNICA.md — PetHood

Registro de lo que sabemos que está a medias, mal resuelto o postergado, **en los dos repos**
(`pethood-backend` y `pethood-frontend`). Vive acá, junto al resto de los documentos rectores,
porque la mayor parte de la deuda es transversal y no tiene un módulo dueño.

> Última revisión: **2026-09-24**

## Cómo se usa

- **Deuda transversal** (toca varios módulos, o ninguno en particular): va acá, con su ficha
  completa.
- **Deuda de un módulo**: va en el contrato de API de ese módulo, que es donde está el
  contexto, y acá queda **sólo un renglón con el link**. No se duplica el texto: si se
  duplica, una de las dos copias envejece.
- Cuando algo se arregla, se saca de acá y se anota en el contrato o en el commit. Este
  archivo lista lo que **sigue pendiente**, no el historial.

Las **ambigüedades del documento fuente** (cosas que nadie decidió todavía) no son deuda
técnica: viven en `REQUISITOS.md` sección 10.

---

## Resumen

Los números no se reciclan: un ítem cerrado deja su hueco, para que un link o un comentario
viejo que diga «ítem 7» siga apuntando a lo mismo.

| # | Deuda | Gravedad | Repo |
|---|---|---|---|
| ~~1~~ | ~~Los archivos subidos se sirven sin autenticación~~ | ✅ cerrada | — |
| ~~2~~ | ~~`r2.ts` no conoce los formatos de video~~ | ✅ cerrada | — |
| 3 | Disco efímero en Render: **falta aprovisionar el bucket de R2** | Media | infra |
| 4 | `REQUISITOS.md` §4 contradice el límite real del video de chat | Media | docs |
| 5 | `apps/mobile` no tiene linter, formateador ni runner de tests | Media | frontend |
| 6 | El CI del frontend no corre los tests que sí existen | Media | frontend |
| 7 | `limits.ts` está duplicado a mano entre los dos repos | Media | ambos |
| 8 | Falta `.gitattributes`: en Windows el checkout queda con CRLF | Media | ambos |
| 9 | Multer bufferiza en RAM archivos de hasta 30 MB | Baja | backend |
| 10 | El tipo de adjunto se deduce de la extensión de la URL | Baja | backend |
| 11 | La duración máxima del video la valida sólo el cliente | Baja | ambos |
| 12 | En el frontend, `fotos` nombra algo que puede ser un video | Baja | frontend |
| 13 | El socket de chat no conoce el perfil activo (switch refugio/adoptante) | Baja | ambos |
| 14 | Al activar R2, los archivos privados vuelven a quedar públicos | **Alta** | backend |

---

## 1. Los archivos subidos se sirven sin autenticación — ✅ **CERRADA**

`/api/v1/archivos` se servía con `express.static` y sin ningún control: cualquiera con el link
abría un adjunto de chat, un comprobante de historia clínica o una prueba de vida, sin sesión.

Se cerró con **URLs firmadas** ([`shared/urlFirmada.ts`](../src/shared/urlFirmada.ts)): las
tres subcarpetas privadas (`chats`, `historias-clinicas`, `seguimientos`) exigen un `exp` y un
`sig` HMAC que emiten los DTOs; las públicas (`mascotas`, `publicaciones`, `perfiles`) siguen
abiertas porque se muestran en el feed de adopción.

**Por qué firmada y no un header.** En React Native, `<Image source={{ uri }} />` descarga por
su cuenta y no manda `Authorization`. Poner `autenticar` delante habría dejado la app sin una
sola foto, salvo pasarle `headers` a las 25 imágenes remotas y perder el cacheo. Es el mismo
motivo por el que S3 y R2 tienen URLs prefirmadas.

**Lo que NO resuelve, y hay que saberlo:** sigue siendo un *bearer*. Quien tenga el link
vigente entra, aunque no participe del chat. Lo que se gana es que **vence** (6 h) y que no se
puede fabricar uno para un archivo ajeno. La versión fuerte —verificar la pertenencia al chat
en cada request— es justamente lo que el `<Image>` de RN no deja hacer.

**El vencimiento se redondea a ventanas de 6 h** para que la URL no cambie en cada respuesta:
si cambiara, el cliente volvería a descargar la misma foto —o el mismo video de 30 MB— cada
vez, porque su caché indexa por URL.

---

## 2. `r2.ts` no conoce los formatos de video — ✅ **CERRADA**

Había dos mapas de mime → extensión, uno en `storage.ts` y otro en `r2.ts`, y habían
divergido: el de R2 nunca supo de video, así que un `.mp4` se habría subido al bucket como
`.jpg` apenas se activara R2 para el chat.

Se cerró unificando los dos en [`src/shared/extensiones.ts`](../src/shared/extensiones.ts),
que ahora es el único mapa del proyecto. Tiene un test que recorre **todos** los formatos
declarados en `LIMITES` y falla si alguien suma uno sin decidirle extensión, para que no
puedan volver a separarse.

---

## 3. Disco efímero en Render — Media · **el código ya está, falta el bucket**

**Qué pasa.** En Render el disco del contenedor se recrea en cada deploy y en cada reinicio.
Todo lo que hay en `uploads/` desaparece y las filas de la base quedan apuntando a archivos
que ya no existen: una conversación con las fotos rotas y sin forma de recuperarlas. Además
impide correr más de una instancia — dos instancias son dos discos, y el que sube no es el
que sirve.

**Qué ya se hizo.** [`shared/storage.ts`](../src/shared/storage.ts) pasó a ser la única
puerta de persistencia de archivos y ramifica por `R2_ENABLED`: con R2 habilitado sube a
Cloudflare, si no escribe en disco. Los **cinco** módulos que la usan —mascotas,
publicaciones, historia clínica, seguimiento y chat— quedaron migrados **sin cambiar una
línea**, porque la decisión vive adentro de las cuatro funciones que ya llamaban.

`borrarImagen` decide por la **forma de la URL** y no por el flag, así que lo guardado antes
de la migración se sigue borrando del disco y lo nuevo del bucket. Las dos épocas conviven sin
migrar datos, y el frontend no cambió nada: `urlAbsoluta` ya dejaba pasar las URLs absolutas.

**Qué falta, y es lo único que falta.** Aprovisionar R2:

1. Crear un bucket y un API token S3 en `https://dash.cloudflare.com` → R2.
2. Completar `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME` y
   `R2_PUBLIC_BASE_URL` en el entorno de Render.
3. Poner `R2_ENABLED=true`.

**Hasta que eso pase, la deuda sigue abierta**: con el flag en `false` todo va a disco y los
archivos se siguen perdiendo en cada deploy. El código está listo y es seguro de mergear
porque con R2 apagado el comportamiento es idéntico al de antes — pero mergearlo **no** cierra
el problema, sólo lo deja a un cambio de configuración de distancia.

> Ojo al activarlo: un bucket público expone los archivos a quien tenga el link. No es peor
> que hoy (`express.static` hace lo mismo), pero tampoco lo arregla — eso es el ítem 1, y
> conviene resolverlo antes o junto con la activación.

---

## 4. `REQUISITOS.md` §4 contradice el límite real del video — Media

**Qué pasa.** La tabla de validez de campos de [`REQUISITOS.md`](./REQUISITOS.md) §4 dice
`≤5MB` para todo archivo. Desde que el chat acepta video, **el límite real de un video es
30 MB**, y el código ya lo aplica.

**Por qué se cambió.** Un teléfono graba 1080p a unos 13 Mbps: en 5 MB entran **3 segundos**.
La duración útil acordada es 15 s, que a 1080p pesan ~25 MB. El razonamiento completo, con la
tabla de calidades, está en [`api-chat-sala.md`](./api-chat-sala.md), sección «Por qué 30 MB y
no 5».

**Ojo:** es una excepción **acotada al video de chat**. Imágenes y documentos siguen en 5 MB
en todos los módulos, incluidas las fotos del propio chat.

**Cómo se arregla.** Agregar la fila de video a la tabla §4 con su excepción. Es una decisión
de equipo sobre un documento rector, no un cambio de código — por eso no se hizo solo.

---

## 5. `apps/mobile` no tiene linter, formateador ni runner de tests — Media

**Qué pasa.** Las `devDependencies` de `apps/mobile` son `@types/*`, `babel-preset-expo`,
`tailwindcss` y `typescript`. **No hay ESLint, ni Prettier, ni Jest/Vitest.** ESLint 9 existe
sólo en `apps/web-admin`.

Lo que sí hay: TypeScript en modo `strict`, y el CI corre `tsc --noEmit`.

**Consecuencia.** El estilo del código mobile se sostiene por imitación del archivo de al
lado, y nada impide un `any` explícito ni una importación sin usar. Para una entrega académica
donde el backend sí tiene lint y formato, la asimetría se nota.

**Cómo se arregla.** Montar ESLint 9 + Prettier en `apps/mobile` con la configuración de Expo
(`eslint-config-expo`), y sumar los dos pasos al workflow. Es un PR de infraestructura, no de
producto: conviene hacerlo solo, porque el primer `--fix` va a tocar muchísimos archivos.

---

## 6. El CI del frontend no corre los tests que sí existen — Media

**Qué pasa.** `apps/mobile/lib/listaChats.test.ts` tiene 13 tests de la lógica de filtrado de
HU-5.3 y corre con el runner nativo de Node, sin dependencias:

```bash
cd apps/mobile && node --test --experimental-strip-types lib/listaChats.test.ts
```

Pero el `.github/workflows/ci.yml` del repo `pethood-frontend` sólo verifica conflictos, `tsc --noEmit`, `expo-doctor`, `expo export` y que Metro
levante. **Nadie los corre salvo a mano**, y un test que no corre no protege de nada.

**Cómo se arregla.** Un paso más en el job `check-mobile`, después del de TypeScript:

```yaml
- name: Tests unitarios
  working-directory: apps/mobile
  run: node --test lib/*.test.ts
```

(En el Node 22 del CI el flag `--experimental-strip-types` ya no hace falta: el borrado de
tipos viene activado desde 22.18.)

---

## 7. `limits.ts` está duplicado a mano entre los dos repos — Media

**Qué pasa.** `src/shared/validation/limits.ts` (backend) y
`apps/mobile/shared/validation/limits.ts` (frontend) son **espejos mantenidos a mano**. Son
repos separados: no hay import posible.

Ya está advertido en la cabecera de los dos archivos. Se anota acá porque el riesgo es real y
silencioso: si divergen, el input corta a una longitud y el servidor valida otra, y el usuario
se come un error que el formulario decía que no iba a pasar.

**Cómo se arregla.** La solución de fondo es publicar `packages/shared` como paquete, que es
justo lo que `AGENTS.md` del frontend dice que no hay que armar sin una duplicación real que
lo justifique — y esta lo es. Mientras tanto: si cambiás un número, cambialo en los dos en el
mismo PR.

---

## 8. Falta `.gitattributes` — Media

**Qué pasa.** Ningún repo tiene `.gitattributes`. Con `core.autocrlf=true`, que es el default
de Git para Windows, el working copy queda con **CRLF** mientras que los blobs del repo tienen
LF. Como `.prettierrc` fija `"endOfLine": "lf"`:

- `npx prettier --check` **falla localmente en Windows para todos los archivos**, aunque el
  repo esté perfecto.
- `npm run format` los reescribe con CRLF y ensucia el `git status` con archivos que nadie
  tocó.
- En el CI (Linux, checkout con LF) todo pasa, así que el problema es invisible desde ahí.

**No es que el repo esté mal formateado.** Se comprobó corriendo Prettier sobre el árbol
normalizado a LF — que es lo que el CI descarga — y pasan los 156 archivos. Es la herramienta
local la que pelea con el checkout, no el repo.

**Cómo se arregla.** Un `.gitattributes` en la raíz de cada repo:

```
* text=auto eol=lf
```

y después `git add --renormalize .` una vez.

---

## 9. Multer bufferiza en RAM archivos de hasta 30 MB — Baja

**Qué pasa.** Todos los uploads usan `multer.memoryStorage()`: el archivo entero vive en RAM
hasta que se persiste. Con el nuevo tope de video son 30 MB por request.

**Por qué es baja.** En el free tier de Render (512 MB, de los que Node ya usa ~150) entran
unas 10 subidas simultáneas antes de que moleste. Está muy por encima de la escala real del
proyecto.

**Cómo se arregla, si algún día hace falta.** Un `StorageEngine` de multer que ramifique por
mimetype: las imágenes siguen en memoria —las necesita `sharp` y pesan ≤5 MB— y el video va a
un archivo temporal y de ahí se strimea al storage. Son unas 30 líneas. **No escribirlas hasta
tener un problema medido.**

---

## 10. El tipo de adjunto se deduce de la extensión de la URL — Baja

`mensaje_imagenes` es un `String[]` de URLs sin columna de tipo, así que
[`shared/adjuntos.ts`](../src/shared/adjuntos.ts) deduce si es imagen o video mirando la
extensión. Es confiable —la extensión la pone `storage.ts` desde el mimetype que validó
multer, no el cliente— y evitó una migración.

**Deja de alcanzar** el día que un adjunto necesite guardar algo más: duración, miniatura,
tamaño, orden explícito. Ahí corresponde una tabla `MensajeAdjunto` propia, con su entrada en
`MODELO_DATOS.md`. El razonamiento completo está en el docstring de `adjuntos.ts`.

Ver también el ítem 2: mientras `r2.ts` no conozca las extensiones de video, esta deducción
devuelve mal el tipo.

---

## 11. La duración máxima del video la valida sólo el cliente — Baja

El tope de 15 segundos lo hace cumplir la app: al grabar con `videoMaxDuration`, y al elegir
de la galería revisando `asset.duration`. **El backend no lo verifica**, porque medir la
duración necesita `ffmpeg`, una dependencia nativa pesada que complicaría el deploy.

El límite duro que sí se verifica en el servidor es el de **peso** (30 MB), que acota la
duración de forma indirecta. Un cliente modificado podría mandar un video de 30 MB y 2 minutos
a 480p.

Está documentado en el contrato y en los comentarios de los dos `limits.ts`. Se anota acá
porque es la única regla del proyecto que **no** tiene al backend como fuente de verdad, y eso
contradice el principio de `CONSTITUTION.md` de no confiar en el cliente.

---

## 12. En el frontend, `fotos` nombra algo que puede ser un video — Baja

`useSalaChat.enviar(contenido, fotos)`, `MensajePendiente.fotos` y la prop `fotos` de
`BarraEscritura` siguen llamándose así aunque ahora pueden llevar un video. Los componentes y
el view-model sí se renombraron (`GrillaAdjuntosMensaje`, `VisorAdjuntos`, `ItemChat.adjuntos`).

Es cosmético y no confunde al compilador, pero confunde a quien lee. No se hizo en el mismo PR
porque `LIMITES.mensaje.fotos.maximo` **sí** es el tope de fotos y tiene que seguir
llamándose así, y distinguir caso por caso en 21 apariciones agregaba ruido a un diff que ya
era grande.

En el backend el campo multipart se llama `foto` **a propósito** y eso no es deuda: es el
nombre del contrato, y renombrarlo obligaría a versionar el endpoint.

---

## 13. El socket de chat no conoce el perfil activo — Baja

**Qué pasa.** El switch refugio/adoptante (spec 016) separa los chats por perfil en REST:
`GET /chats` y las rutas de sala filtran con la cabecera `X-Ambito`. El socket no: el
handshake no lleva el ámbito, así que `chat:unirse` deja entrar a una sala del otro perfil y
`chat:mensaje-nuevo` llega por todas las conversaciones del usuario.

**Qué la mitiga hoy.** En la app no se ve: el listado solo pinta chats que conoce (los del
perfil activo) y, ante uno desconocido, vuelve a pedir `GET /chats`, que ya viene filtrado. A
una sala del otro perfil no se llega porque el historial (`GET /chats/:id/mensajes`) responde
`403 AMBITO_NO_PERMITIDO`.

**Cómo se arregla.** Mandar el ámbito en el `auth` del handshake y reconectar el socket al
cambiar de vista; `autenticarSocket` lo resuelve con el mismo `resolverAmbito` y
`chat:unirse` aplica `exigirChatDelAmbito`.

---

## Deuda ya registrada en el contrato de su módulo

No se repite acá; el link va al detalle.

| Deuda | Dónde |
|---|---|
| Presencia en memoria: no escala a varias instancias y puede quedar stale al salir de la sala | [`api-chat-sala.md`](./api-chat-sala.md) § «Presencia: dos limitaciones conocidas» |
| `mensaje_leido` quedó obsoleto pero se sigue poblando; ninguna query lo consulta | [`api-chat-sala.md`](./api-chat-sala.md) |
| Falta la sala de HU-13.2 (mascota perdida/encontrada), que no nace de una solicitud | [`api-chats.md`](./api-chats.md) § «Creación de salas» |
| Desnormalizar el último mensaje en `Chat`: evaluado y descartado, revisitable con cientos de chats por usuario | [`api-chats.md`](./api-chats.md) |
| `chat_tipo` sigue sin definirse y no se escribe | [`api-chats.md`](./api-chats.md) |

---

## 14. Al activar R2, los archivos privados vuelven a quedar públicos — **Alta**

**Qué pasa.** La firma del ítem 1 protege lo que sirve **este** servidor. Los archivos de R2
los sirve Cloudflare directo desde un bucket público, sin pasar por acá, así que
`firmarUrlArchivo` los deja pasar sin tocar — y un adjunto de chat en R2 vuelve a ser un link
permanente que abre cualquiera.

**Hoy no afecta a nadie:** `R2_ENABLED=false` y no hay bucket (ítem 3). Pero es una trampa con
gatillo — el día que alguien active R2 para resolver el ítem 3, reabre el ítem 1 sin enterarse.

**Cómo se arregla.** Firmar también del lado de R2, con `getSignedUrl` de
`@aws-sdk/s3-request-presigner` (dependencia nueva, el proyecto sólo tiene `client-s3`), y que
`firmarUrlArchivo` ramifique por destino igual que hace `storage.ts`. Conviene mantener la
misma ventana de 6 h para no perder el cacheo.

**Orden sugerido: este ítem ANTES que activar R2**, no después.
