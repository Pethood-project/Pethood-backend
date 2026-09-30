# DEUDA_TECNICA.md — PetHood

Registro de lo que sabemos que está a medias, mal resuelto o postergado, **en los dos repos**
(`pethood-backend` y `pethood-frontend`). Vive acá, junto al resto de los documentos rectores,
porque la mayor parte de la deuda es transversal y no tiene un módulo dueño.

> Última revisión: **2026-09-27**

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
| 15 | Nada llama a la sincronización del estado de la publicación: la mascota no cambia de estado | Baja | backend |
| 16 | No se puede eliminar una publicación (sí editarla y pausarla/finalizarla) | Baja | ambos |
| 17 | Cualquier miembro del refugio puede editar el perfil del refugio | Media | ambos |
| 18 | Cualquier miembro del refugio puede editar y cambiar de estado sus publicaciones | Media | backend |
| 19 | Pausar o finalizar una publicación no toca sus solicitudes abiertas | Media | backend |
| 20 | Las vacunas cargadas antes de la spec 019 no tienen tipo y no dan medalla | Baja | backend |
| 21 | La ubicación es texto libre: no hay catálogo de Provincia/Localidad | Media | ambos |
| 22 | Los `limite` de otros listados responden en inglés si vienen fuera de rango | Baja | backend |
| 23 | Inicio muestra Campañas y Mascotas perdidas como «Muy pronto», y arma los contadores del refugio con cuatro pedidos | Baja | frontend |
| 24 | Las vacunas son un enum: el admin no puede agregarlas desde el panel | Baja | backend |

> **Estado al 2026-09-25.** Los ítems 1 y 2 están resueltos en la rama
> `feature/archivos-acceso-controlado` del backend, que todavía **no se mergeó a `dev`**:
> hasta que entre el PR, el resto del equipo sigue con los archivos sin firmar. Borrar este
> párrafo cuando se mergee.

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

**Cuidado: el arreglo no entra solo.** `adquirirSocket(token)`
(`apps/mobile/lib/socketChat.ts`) abre con `if (!socket)`, así que **reusa la conexión
abierta e ignora los parámetros nuevos**. Mandar el ámbito en el `auth` no alcanza: el
segundo llamado, el de después del switch, devuelve el socket viejo con el handshake viejo y
no vuelve a conectarse.

Hoy eso no rompe nada —el único cambio de credencial es `cerrarSesion`, que llama a
`cerrarSocket()` a propósito, y la app no tiene refresh de token— pero el ámbito **sí**
cambia sin pasar por ahí. Por eso no se anota como ítem aparte: es la primera línea del
arreglo de éste. El handshake tiene que rehacerse cuando cambia el ámbito, comparándolo
contra el del socket ya conectado.

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

---

## 15. Nada llama a la sincronización del estado de la publicación — Baja

**Qué pasa.** La publicación tiene estado propio (`Estado_Publicacion` + `Publicacion_Estado`,
ver `MODELO_DATOS.md`), y sus transiciones son automáticas: siguen al estado de la mascota
(`Disponible` → Activa, `En_Transito`/`En_Tratamiento` → Pausada, `Adoptado`/`Fallecido` →
Finalizada). Esa regla corre al **crear** la publicación, pero después nada la vuelve a
aplicar: hoy ninguna pantalla ni endpoint cambia el estado de una mascota después del alta
(HU-6.2 lo deja afuera a propósito, y aprobar una solicitud tampoco lo toca).

`sincronizarConEstadoMascota` (en `publicaciones.service.ts`) ya está escrita y testeada, pero
no tiene quién la llame.

**Cómo se arregla.** Quien implemente el cambio de estado de una mascota (una HU nueva, o
marcarla `Adoptado` al cerrar una adopción) llama a `sincronizarConEstadoMascota` después de
persistir el estado nuevo. La convivencia con las transiciones manuales ya está resuelta
(spec 018): la sincronización solo pausa o finaliza, nunca reactiva, y no toca una
finalizada.

---

## 16. No se puede eliminar una publicación — Baja

**Qué pasa.** Editar, pausar, reactivar y finalizar ya existen (spec 018). Lo que falta de lo
decidido es **eliminar** (baja lógica de la publicación): hoy la única forma de dar de baja
un aviso es eliminar la mascota (HU-6.3), que da de baja sus publicaciones en la misma
transacción. Finalizar cubre casi todo el caso de uso (saca el aviso del feed para siempre),
pero la publicación sigue en «Mis publicaciones».

**Cómo se arregla.** Definir con el equipo si hace falta además de finalizar y, si sí,
`DELETE /publicaciones/:id` con el mismo criterio de permiso (`puedeEditarPublicacion`) y el
mismo bloqueo por solicitudes abiertas que la baja de mascota.

---

## 17. Cualquier miembro del refugio puede editar el perfil del refugio — Media

**Qué pasa.** `PATCH /refugio/perfil` (spec 017) deja editar nombre, dirección, contacto,
descripción y foto del refugio a **cualquier** usuario con `refugio_id`. La idea del equipo
es que solo lo haga quien tenga un rol específico dentro del refugio (por ejemplo, un
responsable), pero ese rol todavía no existe: hoy la pertenencia es solo `usuario.refugio_id`
y el rol global `MIEMBRO_REFUGIO`.

**Qué ya está preparado.** La decisión vive en un único lugar, `puedeEditarPerfil` en
[`perfil-refugio.service.ts`](../src/modules/perfil-refugio/perfil-refugio.service.ts), que
hoy devuelve `true`. `GET /refugio/perfil` informa el resultado en `puedeEditar` y la app
(`app/perfil/refugio.tsx`) ya lo usa para mostrar o no los lápices, la cámara y los botones;
`PATCH` responde `403 SIN_PERMISO_REFUGIO` si da `false`.

**Cómo se arregla.** Definir con el equipo cómo se modela el rol dentro del refugio (es un
cambio de modelo: columna en `Usuario` o tabla de membresía, con su migración y
`MODELO_DATOS.md`), y reemplazar el cuerpo de `puedeEditarPerfil` para que lo consulte. Del
lado del front no hay nada que tocar.

---

## 18. Cualquier miembro del refugio puede editar y cambiar de estado sus publicaciones — Media

**Qué pasa.** Es el mismo hueco que el ítem 17, aplicado a las publicaciones (spec 018): desde
la vista de refugio, **cualquier** miembro edita, pausa, reactiva y finaliza cualquier
publicación del refugio. La idea es que haya miembros que no puedan hacerlo, pero los roles
dentro del refugio todavía no existen.

**Qué ya está preparado.** La decisión vive en un único lugar, `puedeEditarPublicacion` en
[`publicaciones.service.ts`](../src/modules/publicaciones/publicaciones.service.ts). La ficha
devuelve el resultado en `puedeEditar` y la app ya muestra u oculta las acciones con eso;
`PUT` y `PATCH /estado` responden 403 si da `false`.

**Cómo se arregla.** Junto con el ítem 17: una vez modelado el rol dentro del refugio, que
`puedeEditarPublicacion` lo consulte en la rama `REFUGIO`. Del lado del front no hay nada que
tocar.

---

## 19. Pausar o finalizar una publicación no toca sus solicitudes abiertas — Media

**Qué pasa.** Pausar o finalizar a mano (spec 018) saca el aviso del feed y bloquea
solicitudes **nuevas** (`409 PUBLICACION_NO_ACTIVA`), pero las que ya estaban `Pendiente` o
`En_Revision` siguen abiertas: el refugio las puede seguir resolviendo y el solicitante las
sigue viendo como en curso. Si finaliza, nada le avisa al solicitante.

**Cómo se arregla.** Definir con el equipo qué pasa con ellas (¿se cancelan al finalizar?
¿se bloquea finalizar con solicitudes abiertas, como la baja de mascota?) y aplicarlo en
`cambiarEstadoPublicacion`.

---

## 20. Las vacunas cargadas antes de la spec 019 no tienen tipo y no dan medalla — Baja

**Qué pasa.** Antes de la spec 019 una vacuna era un registro de historia clínica con el
tilde `vacunacion` y un título libre. Esos registros quedaron con `vacunacion = true` y
`tipoVacuna` nulo: siguen en la historia clínica con la etiqueta genérica «Vacuna», pero no
aparecen como medalla en la ficha de la mascota ni en la publicación. Además, la migración
`20260927120000_vacunas_historia_clinica` descartó el texto de `publicacion_vacunas`, que no
se puede traducir a un tipo con fecha.

**Cómo se arregla.** Si hace falta recuperarlas, volver a cargarlas desde la app (historia
clínica → «Vacuna») o escribir una migración de datos que asigne el tipo por título y
especie (ej. «antirrábica» → `ANTIRRABICA`). En una base de desarrollo alcanza con volver a
correr el seed sobre una base vacía.

---

## 21. La ubicación es texto libre: no hay catálogo de Provincia/Localidad — Media

**Qué pasa.** `REQUISITOS.md` y `MODELO_DATOS.md` piden filtrar por ubicación administrativa
(Provincia/Localidad), pero no existe ese catálogo. Hoy la ubicación es texto libre en tres
lugares: el perfil (`usuario_ubicacion`), la publicación (`publicacion_ubicacion`) y el aviso
de animal perdido (`animal_perdido_ubicacion`, spec 020). En el portal de perdidos el filtro
de selección múltiple se arma con las ubicaciones ya cargadas
(`GET /animales-perdidos/ubicaciones`) y compara sin distinguir mayúsculas, pero sí acentos:
"Maipu" y "Maipú" son dos opciones distintas, y un error de tipeo crea una opción nueva.

**Por qué quedó así.** Decisión de equipo del 2026-09-29: el catálogo se quiere definir una
sola vez para toda la app (también lo necesita HU-11.3) y aplicarlo después en cada lugar.

**Cómo se arregla.** Modelar `Provincia` y `Localidad` (con auditoría, gestionables desde
web-admin), sembrarlas, reemplazar las tres columnas de texto por una FK a `Localidad` con una
migración de datos, y sacar el endpoint de ubicaciones del portal de perdidos.

---

## 22. Los `limite` de otros listados responden en inglés si vienen fuera de rango — Baja

**Qué pasa.** Los listados paginados de solicitudes, historial del chat y administración de
usuarios validan `limite` con `z.coerce.number().max(...)`: un valor fuera de rango responde
con el mensaje de Zod en inglés ("Number must be less than or equal to 50"). Es un parámetro
que arma el cliente, no el usuario, así que en la práctica no se ve.

**Cómo se arregla.** Usar `limitePaginaSchema` de `shared/validation/schemas.ts` (creado en la
spec 020), que ya da el error en español. `idSchema` tenía el mismo problema cuando faltaba un
id y quedó corregido para todos los módulos en esa misma spec.

---

## 23. Inicio muestra Campañas y Mascotas perdidas como «Muy pronto» — Baja

**Qué pasa.** El rediseño de Inicio (adoptante y refugio) trae secciones de Campañas y de
Mascotas perdidas con datos reales (montos, donantes, reportes cerca). Esos módulos son las
fases 10 y 11 del roadmap y todavía no tienen backend, así que en
`apps/mobile/components/home/SeccionesProximamente.tsx` se muestran con el color y la forma
del diseño pero con un texto genérico y la pastilla «Muy pronto», sin números inventados.
Además, el panel de solicitudes del refugio saca sus contadores (pendientes, en revisión,
aprobadas del mes, llegadas hoy) del `total` de cuatro `GET /solicitudes/recibidas` con
distinto filtro, porque no hay un endpoint de resumen.

**Cómo se arregla.** Cuando se implemente cada módulo, reemplazar su tarjeta de
`SeccionesProximamente.tsx` por una con datos (el diseño de referencia está en el proyecto
«Pethood - Ideas de inicio» de Claude Design). El «Ver mapa» del prototipo no se implementa:
el proyecto excluye el mapa interactivo. Si los cuatro pedidos del refugio se notan lentos,
sumar un `GET /solicitudes/recibidas/resumen` que devuelva los contadores en una sola
consulta.

---

## 24. Las vacunas son un enum: el admin no puede agregarlas desde el panel — Baja

**Qué pasa.** `TipoVacuna` es un enum de `schema.prisma` y el plan de vacunación vive en
`src/shared/vacunas.ts` (spec 019). Es a propósito: el código ramifica por el valor (qué
especie la admite, color de la medalla en la app). Por eso `GET /admin/catalogos/vacunas` es
solo lectura y `POST`/`PUT`/baja responden `403 OPERACION_NO_PERMITIDA`. Es la única excepción
del ABM de catálogos (`docs/api-admin-catalogos.md`).

**Cuándo migrar a tabla.** Si aparecen otras especies (conejos, aves), vacunas por región, o
alguien que no sea del equipo tiene que gestionarlas. Mientras el plan de perros y gatos siga
igual, agregar una vacuna es una migración y un commit.

**Cómo se arregla.** Tabla `Vacuna` con nombre y descripción, más `VacunaEspecie` (N:M, porque
`ANTIRRABICA` sirve a perros y gatos). Migrar `historia_clinica.tipoVacuna` a `vacunaId`
conservando un código estable, para no romper `tipo` en los endpoints ni las medallas de
mobile (definir color por defecto o campo `color`). Toca historia clínica, alta de mascota,
publicaciones, catálogos y la app: hacerlo como cambio aparte.
