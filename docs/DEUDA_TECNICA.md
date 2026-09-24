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

| # | Deuda | Gravedad | Repo |
|---|---|---|---|
| 1 | Los archivos subidos se sirven sin autenticación | **Alta** | backend |
| 2 | `r2.ts` no conoce los formatos de video | **Alta** | backend |
| 3 | Disco efímero en Render: cada deploy borra los archivos | **Alta** | backend |
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

---

## 1. Los archivos subidos se sirven sin autenticación — **Alta**

**Qué pasa.** En [`src/app.ts`](../src/app.ts) los uploads se publican con
`express.static` y sin ningún middleware de autenticación:

```ts
app.use(RUTA_PUBLICA_ARCHIVOS, express.static(DIRECTORIO_UPLOADS));
```

Cualquiera con la URL abre el archivo, sin sesión y sin ser participante de nada. Vale para
todo el proyecto, pero **pesa distinto en el chat**: una conversación es privada, y desde que
se pueden mandar videos ahí puede haber material bastante más sensible que la foto de una
mascota.

**Por qué quedó así.** La ruta nació para las fotos de mascotas, que son públicas por
naturaleza — se muestran en el feed de adopción. El chat reusó el mismo `storage.ts` sin que
nadie revisara la decisión de acceso.

**Qué la mitiga hoy.** El nombre de archivo es un UUID v4, así que la URL no se adivina. Es
seguridad por oscuridad: el link no vence nunca y quien lo consigue entra para siempre.

**Cómo se arregla.** Dos caminos, y conviene decidirlo junto con el ítem 3:

- **URLs firmadas con vencimiento** (R2 soporta presigned GET). Es el arreglo serio. Cuesta
  perder el cacheo `immutable` y que el cliente tenga que pedir la URL cada vez.
- **Un endpoint autenticado** que valide la pertenencia al chat y devuelva el archivo. Más
  simple de razonar, pero pone al servidor en el camino de cada byte.

---

## 2. `r2.ts` no conoce los formatos de video — **Alta**

**Qué pasa.** [`src/shared/r2.ts`](../src/shared/r2.ts) tiene su propio mapa de extensiones y
**sólo contempla imágenes**:

```ts
const MIME_A_EXTENSION: Record<string, string> = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp',
};
// …
const extension = MIME_A_EXTENSION[archivo.mimetype] ?? 'jpg';
```

Un `video/mp4` cae en el `?? 'jpg'` y se sube al bucket **con extensión `.jpg`**.

**Por qué es grave.** Es un bug latente que no se ve hoy porque R2 sólo lo usa la foto de
perfil, pero **explota el día que se active R2 para el chat** (ítem 3). Y no rompe fuerte:
rompe callado. El archivo se sube, la URL se guarda, y recién falla al reproducir — además de
que `tipoDeUrl` en [`src/shared/adjuntos.ts`](../src/shared/adjuntos.ts) clasificaría ese
video como imagen, porque clasifica justamente por la extensión.

**Es el mismo bug** que tenía `storage.ts` y que se corrigió al implementar el video en el
chat. En `r2.ts` sigue vivo porque ese archivo no se tocó.

**Cómo se arregla.** Agregar `video/mp4`, `video/quicktime` y `video/webm` al mapa. Mejor
todavía: que `r2.ts` y `storage.ts` compartan un único mapa de mime → extensión, para que no
puedan volver a divergir.

---

## 3. Disco efímero en Render — **Alta**

**Qué pasa.** Todos los archivos subidos (mascotas, publicaciones, historia clínica,
seguimiento y chat) van a `uploads/` en disco local. **En Render el disco es efímero: cada
deploy borra todo.** El mensaje queda en la base apuntando a un archivo que ya no existe.

**Ya está documentado** en [`api-chat-sala.md`](./api-chat-sala.md), en «Deuda conocida de
almacenamiento» y en «Almacenamiento de imágenes en R2». Se repite acá porque es transversal y
porque el video lo agravó: una foto comprimida pesa ~200 KB, un video hasta 30 MB.

**Cómo se arregla.** El 80% ya está construido y **no hace falta un PR grande**:

1. `shared/r2.ts` ya tiene cliente S3, configuración por env y el flag `R2_ENABLED`.
2. [`shared/imagenPerfil.ts`](../src/shared/imagenPerfil.ts) ya resuelve el patrón de
   adopción en 12 líneas: si R2 está habilitado sube al bucket, si no cae a disco local.
3. Falta generalizar `subirImagenPerfil` a `subirArchivo(archivo, carpeta)` —hoy tiene
   `perfiles/` fijo—, **arreglar de paso el ítem 2**, y agregar un `borrarArchivo`
   (`DeleteObjectCommand`): sin él, cada alta de mensaje que falla después de subir deja un
   objeto huérfano en el bucket, porque la compensación de `chats.service.ts` sólo borra del
   disco local.
4. Un `adjuntoChat.ts` espejo de `imagenPerfil.ts`, y cambiar dos líneas en `chats.service.ts`.

**El frontend no cambia nada:** `urlAbsoluta` ya deja pasar sin tocar las URLs que vienen
absolutas, así que las filas viejas con ruta relativa y las nuevas con URL de R2 conviven sin
migrar datos.

> **Corrección a lo que dice el contrato.** `api-chat-sala.md` afirma que la migración «tiene
> que ser un PR propio que toque todos los módulos a la vez». Es más conservador de lo
> necesario: `imagenPerfil.ts` demuestra que el punto de decisión ya está abstraído **por
> módulo**, así que el chat puede migrar solo.

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
