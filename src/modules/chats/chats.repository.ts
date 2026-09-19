/**
 * Acceso a datos del chat: listado de conversaciones (HU-5.1) y sala (HU-5.2).
 *
 * El listado resuelve el último mensaje y el conteo de no leídos de TODOS los chats con dos
 * queries fijas, no una por chat: ver `ultimoMensajePorChat` y `contarNoLeidosPorChat`.
 *
 * Lo que se escribe es el alta de un mensaje, las marcas de lectura y entrega del
 * participante y el alta de una sala; nunca hay baja ni modificación de `Mensaje`:
 * MODELO_DATOS.md lo declara excepción de auditoría (solo alta).
 *
 * **Leído y entregado viven en `UsuarioChat`, no en `Mensaje`.** Cada participante guarda
 * hasta qué momento tiene la sala leída y recibida, así que el estado de un mensaje es una
 * comparación de fechas y no un booleano compartido. Es lo que permite distinguir entregado
 * de leído y lo que hace que el contador no se rompa con tres o más personas en la sala.
 */
import { Prisma, type TipoMensaje } from '@prisma/client';
import { prisma } from '../../shared/prisma';
import { datosAlta, datosModificacion } from '../../shared/auditoria';

/**
 * Salas donde el usuario es participante ACTIVO, con el refugio y el otro participante.
 *
 * Los dos filtros de baja son los que definen qué ve el usuario:
 * - `fechaBaja: null` sobre UsuarioChat — lo sacaron de la sala, no la ve más.
 * - `chat: { fechaBaja: null }` — la sala entera fue dada de baja.
 *
 * `participantes` viene filtrado a los activos distintos de quien pregunta: eso ES "el otro
 * lado", y así el service no tiene que volver a filtrarse a sí mismo. Se traen las fechas de
 * baja de Usuario y Refugio porque una cuenta dada de baja NO oculta el chat, sólo marca el
 * contacto como inactivo.
 */
export function listarChatsActivosDeUsuario(usuarioId: number) {
  return prisma.usuarioChat.findMany({
    where: {
      usuarioId,
      fechaBaja: null,
      chat: { fechaBaja: null },
    },
    // `ultimaLectura` de esta misma fila es lo que define el contador de no leídos del chat.
    include: {
      chat: {
        include: {
          refugio: { select: { id: true, nombre: true, imagenUrl: true, fechaBaja: true } },
          participantes: {
            where: { fechaBaja: null, usuarioId: { not: usuarioId } },
            include: {
              usuario: {
                select: {
                  id: true,
                  nombre: true,
                  apellido: true,
                  imagenUrl: true,
                  fechaBaja: true,
                },
              },
            },
            orderBy: { fechaAlta: 'asc' },
          },
        },
      },
    },
  });
}

/**
 * Refugio al que pertenece quien pregunta, o `null` si es un adoptante.
 *
 * Hace falta para saber de qué lado del mostrador está: en un chat con refugio, el adoptante
 * ve al refugio y el miembro del refugio ve al adoptante.
 */
export function buscarRefugioDeUsuario(usuarioId: number) {
  return prisma.usuario.findUnique({
    where: { id: usuarioId },
    select: { refugioId: true },
  });
}

/** Fila cruda del último mensaje de un chat. */
export interface UltimoMensajeFila {
  chatId: number;
  contenido: string;
  usuarioId: number;
  imagenUrl: string | null;
  fechaAlta: Date;
}

/**
 * El último mensaje de CADA chat, en una sola query.
 *
 * Es el único `$queryRaw` del proyecto y es deliberado: Prisma no sabe hacer
 * greatest-n-per-group, y las alternativas (un `groupBy` con `_max` más una segunda query
 * con un OR de pares chat/fecha) son más frágiles ante empates de timestamp. La forma
 * natural en Postgres es `DISTINCT ON`, que además cae directo sobre
 * `mensaje_chat_fecha_alta_idx`.
 *
 * El desempate por `mensaje_id DESC` es para que dos mensajes con la misma marca de tiempo
 * al milisegundo no devuelvan una fila distinta en cada corrida.
 *
 * Los ids van parametrizados con `Prisma.join`, nunca interpolados en el string.
 */
export function ultimoMensajePorChat(chatIds: number[]): Promise<UltimoMensajeFila[]> {
  // `IN ()` vacío no es SQL válido. El service ya corta antes, esto es el cinturón.
  if (chatIds.length === 0) return Promise.resolve([]);

  return prisma.$queryRaw<UltimoMensajeFila[]>`
    SELECT DISTINCT ON (m."chat_id")
           m."chat_id"            AS "chatId",
           m."mensaje_contenido"  AS "contenido",
           m."usuario_id"         AS "usuarioId",
           m."mensaje_imagen_url" AS "imagenUrl",
           m."mensaje_fecha_alta" AS "fechaAlta"
      FROM "mensaje" m
     WHERE m."chat_id" IN (${Prisma.join(chatIds)})
     ORDER BY m."chat_id", m."mensaje_fecha_alta" DESC, m."mensaje_id" DESC
  `;
}

/** Cuántos mensajes sin leer tiene un chat para quien pregunta. */
export interface NoLeidosFila {
  chatId: number;
  noLeidos: number;
}

/**
 * Mensajes no leídos por chat, en una sola query.
 *
 * No leído "para mí" = del chat, que no emití yo, y POSTERIOR a mi última lectura de esa
 * sala. Con `ultima_lectura` en NULL nunca leí nada y cuentan todos. Excluir los propios es
 * imprescindible o el badge contaría los mensajes salientes del usuario.
 *
 * Va en SQL porque el umbral es distinto en cada chat —sale de la fila de `usuario_chat` de
 * ese chat— y Prisma no sabe comparar una columna contra otra de una tabla relacionada. La
 * alternativa sería traer las marcas y hacer un `OR` de pares chat/fecha, que crece con la
 * cantidad de chats. Los ids van parametrizados con `Prisma.join`, nunca interpolados.
 *
 * Devuelve sólo los chats con pendientes: el service completa el resto con 0.
 */
export function contarNoLeidosPorChat(
  usuarioId: number,
  chatIds: number[],
): Promise<NoLeidosFila[]> {
  if (chatIds.length === 0) return Promise.resolve([]);

  return prisma.$queryRaw<NoLeidosFila[]>`
    SELECT m."chat_id"             AS "chatId",
           COUNT(*)::int           AS "noLeidos"
      FROM "mensaje" m
      JOIN "usuario_chat" uc
        ON uc."chat_id" = m."chat_id"
       AND uc."usuario_id" = ${usuarioId}
       AND uc."usuario_chat_fecha_baja" IS NULL
     WHERE m."chat_id" IN (${Prisma.join(chatIds)})
       AND m."usuario_id" <> ${usuarioId}
       AND (uc."usuario_chat_ultima_lectura" IS NULL
            OR m."mensaje_fecha_alta" > uc."usuario_chat_ultima_lectura")
     GROUP BY m."chat_id"
  `;
}

/**
 * Hasta dónde tiene leída y entregada la sala CADA participante activo.
 *
 * Es lo que define el acuse de un mensaje: está entregado cuando todos los que no lo
 * emitieron tienen una `ultima_entrega` posterior a su fecha, y leído cuando lo mismo vale
 * para `ultima_lectura`. Se traen todos y no sólo "los otros" porque quién queda excluido
 * depende del AUTOR de cada mensaje, no de quién está preguntando: eso lo resuelve el
 * service, que es el único que sabe de qué mensaje se trata.
 *
 * Una sola query por sala, no una por mensaje.
 */
export function marcasDeParticipantes(chatId: number) {
  return prisma.usuarioChat.findMany({
    where: { chatId, fechaBaja: null },
    select: { usuarioId: true, ultimaLectura: true, ultimaEntrega: true },
  });
}

// ─────────────── HU-5.2 · Sala de conversación ───────────────

/**
 * ¿El usuario es participante ACTIVO de esta sala?
 *
 * Es el guard de TODA la HU: historial, envío, marcado de leídos y `chat:unirse` del socket
 * pasan por acá antes de tocar nada. Los mismos dos filtros de baja que el listado, así que
 * lo que no se ve en GUI-08 tampoco se puede abrir por id.
 *
 * Devuelve el id de la membresía o `null`; el service traduce el null a 403.
 */
export function buscarMembresiaActiva(usuarioId: number, chatId: number) {
  return prisma.usuarioChat.findFirst({
    where: {
      usuarioId,
      chatId,
      fechaBaja: null,
      chat: { fechaBaja: null },
    },
    select: { id: true },
  });
}

/**
 * La sala con todo lo necesario para resolver el contacto de la cabecera (GUI-14).
 *
 * Mismo `include` que `listarChatsActivosDeUsuario` para que `resolverContacto` del service
 * sirva igual para una fila del listado y para la cabecera de la sala, sin una segunda
 * versión de la regla. Devuelve `null` si el usuario no participa: es el guard y el dato en
 * la misma query.
 */
export function buscarSalaConContacto(usuarioId: number, chatId: number) {
  return prisma.usuarioChat.findFirst({
    where: {
      usuarioId,
      chatId,
      fechaBaja: null,
      chat: { fechaBaja: null },
    },
    include: {
      chat: {
        include: {
          refugio: { select: { id: true, nombre: true, imagenUrl: true, fechaBaja: true } },
          participantes: {
            where: { fechaBaja: null, usuarioId: { not: usuarioId } },
            include: {
              usuario: {
                select: {
                  id: true,
                  nombre: true,
                  apellido: true,
                  imagenUrl: true,
                  fechaBaja: true,
                },
              },
            },
            orderBy: { fechaAlta: 'asc' },
          },
        },
      },
    },
  });
}

/**
 * Una página del historial, de la más reciente a la más vieja.
 *
 * Se piden `limite + 1` filas para saber si quedan más sin una segunda query de conteo: si
 * vuelve la de más, hay página siguiente. El service descarta la sobrante.
 *
 * El orden es el MISMO desempate que usa el último mensaje del listado
 * (`fechaAlta DESC, id DESC`), para que la última línea de GUI-08 sea siempre la primera
 * fila de la sala. Cae sobre `mensaje_chat_fecha_alta_idx`, que ya existe desde HU-5.1.
 *
 * `skip: 1` sobre el cursor porque `antesDe` es un mensaje que el cliente YA tiene.
 */
export function listarMensajes(chatId: number, limite: number, antesDe?: number) {
  return prisma.mensaje.findMany({
    where: { chatId },
    orderBy: [{ fechaAlta: 'desc' }, { id: 'desc' }],
    take: limite + 1,
    ...(antesDe === undefined ? {} : { cursor: { id: antesDe }, skip: 1 }),
  });
}

/** ¿El mensaje del cursor pertenece a esta sala? Evita paginar con un id de otro chat. */
export function buscarMensajeDeChat(chatId: number, mensajeId: number) {
  return prisma.mensaje.findFirst({
    where: { id: mensajeId, chatId },
    select: { id: true },
  });
}

/**
 * Alta de mensaje. Nunca se edita ni se borra.
 *
 * `imagenUrl` guarda la PRIMERA de `imagenes`, desnormalizada, para que el preview del
 * listado no tenga que mirar el array — mismo par que en `Publicacion`.
 *
 * `usuarioAlta` es siempre el emisor: un mensaje no se da de alta en nombre de otro. En un
 * mensaje de sistema el emisor es el usuario SISTEMA, que es un usuario real del seed.
 */
export function crearMensaje(datos: {
  chatId: number;
  usuarioId: number;
  contenido: string;
  imagenes: string[];
  tipo?: TipoMensaje;
  solicitudId?: number | null;
}) {
  return prisma.mensaje.create({
    data: {
      chatId: datos.chatId,
      usuarioId: datos.usuarioId,
      contenido: datos.contenido,
      imagenes: datos.imagenes,
      imagenUrl: datos.imagenes[0] ?? null,
      tipo: datos.tipo ?? 'TEXTO',
      solicitudId: datos.solicitudId ?? null,
      ...datosAlta(datos.usuarioId),
    },
  });
}

// ─────────────── Salas que nacen de una solicitud (CONSTITUTION §7) ───────────────

/** La sala viva de una solicitud, si ya se creó. */
export function buscarChatDeSolicitud(solicitudId: number) {
  return prisma.chat.findFirst({
    where: { solicitudId, fechaBaja: null },
    select: { id: true },
  });
}

/**
 * Crea la sala de una solicitud con TODOS sus participantes, en una transacción.
 *
 * La fila de `UsuarioChat` de cada miembro del refugio es imprescindible: la autorización de
 * todo el módulo es la membresía, así que una sala sin ellas no aparecería en GUI-31 ni
 * dejaría entrar por REST ni por socket.
 *
 * `chat_tipo` NO se escribe: sus valores siguen sin definirse en MODELO_DATOS.md.
 */
export function crearChatDeSolicitud(datos: {
  solicitudId: number;
  refugioId: number | null;
  participantesIds: number[];
  creadoPor: number;
}) {
  return prisma.chat.create({
    data: {
      solicitudId: datos.solicitudId,
      refugioId: datos.refugioId,
      ...datosAlta(datos.creadoPor),
      participantes: {
        create: datos.participantesIds.map((usuarioId) => ({
          usuarioId,
          ...datosAlta(datos.creadoPor),
        })),
      },
    },
    select: { id: true },
  });
}

/** Miembros activos del refugio: son los que atienden la sala desde GUI-31. */
export function listarMiembrosDeRefugio(refugioId: number) {
  return prisma.usuario.findMany({
    where: { refugioId, fechaBaja: null },
    select: { id: true },
  });
}

/** Datos de la solicitud que pinta la tarjeta embebida y la cabecera de la sala. */
export function buscarSolicitudParaChat(solicitudId: number) {
  return prisma.solicitud.findUnique({
    where: { id: solicitudId },
    select: {
      id: true,
      fechaAlta: true,
      usuarioId: true,
      tipoSolicitud: { select: { nombre: true } },
      historicoEstados: {
        where: { fechaBaja: null },
        orderBy: { fechaAlta: 'desc' },
        take: 1,
        select: { estadoSolicitud: { select: { nombre: true } } },
      },
      publicacion: {
        select: {
          id: true,
          imagenUrl: true,
          mascota: {
            select: {
              id: true,
              nombre: true,
              fechaNacimiento: true,
              imagenUrl: true,
              refugioId: true,
              usuarioId: true,
              // La especie cuelga de la raza: `Mascota` no la tiene directa.
              raza: { select: { especie: { select: { nombre: true } } } },
            },
          },
        },
      },
    },
  });
}

/** Qué se está acusando: haber recibido los mensajes o haberlos leído. */
export type Acuse = 'entrega' | 'lectura';

/**
 * Adelanta la marca de entrega o de lectura del participante hasta `hasta`, y devuelve
 * cuántos mensajes ajenos quedaron cubiertos por ese avance.
 *
 * Es UNA escritura por sala en lugar del UPDATE masivo sobre `mensaje` que hacía el modelo
 * viejo, y no puede retroceder: si la marca guardada ya es posterior (llegó antes un acuse
 * de otro dispositivo) se deja como está y el conteo da 0.
 *
 * El conteo se hace ANTES de escribir, contra la marca vieja: es exactamente "cuántos
 * pasaron de pendientes a acusados en esta llamada", que es lo que el cliente necesita para
 * decidir si vale la pena avisarle a los demás dispositivos.
 *
 * `leido` de `Mensaje` se sigue poblando en el acuse de lectura por compatibilidad con
 * lecturas viejas de la columna; ninguna query del módulo la consulta.
 */
export async function acusarHasta(
  chatId: number,
  usuarioId: number,
  acuse: Acuse,
  hasta: Date,
): Promise<number> {
  const membresia = await prisma.usuarioChat.findFirst({
    where: { chatId, usuarioId, fechaBaja: null },
    select: { id: true, ultimaLectura: true, ultimaEntrega: true },
  });

  if (!membresia) return 0;

  const marcaActual = acuse === 'lectura' ? membresia.ultimaLectura : membresia.ultimaEntrega;

  if (marcaActual !== null && marcaActual >= hasta) return 0;

  const alcanzados = await prisma.mensaje.count({
    where: {
      chatId,
      usuarioId: { not: usuarioId },
      fechaAlta: { lte: hasta, ...(marcaActual === null ? {} : { gt: marcaActual }) },
    },
  });

  await prisma.usuarioChat.update({
    where: { id: membresia.id },
    data: {
      ...(acuse === 'lectura' ? { ultimaLectura: hasta } : { ultimaEntrega: hasta }),
      // La entrega es condición de la lectura: no se puede haber leído algo que no llegó.
      ...(acuse === 'lectura' &&
      (membresia.ultimaEntrega === null || membresia.ultimaEntrega < hasta)
        ? { ultimaEntrega: hasta }
        : {}),
      ...datosModificacion(usuarioId),
    },
  });

  if (acuse === 'lectura' && alcanzados > 0) {
    // Compatibilidad: la columna vieja sigue reflejando lo leído, aunque nada la lea.
    await prisma.mensaje.updateMany({
      where: {
        chatId,
        usuarioId: { not: usuarioId },
        leido: false,
        fechaAlta: { lte: hasta },
      },
      data: { leido: true },
    });
  }

  return alcanzados;
}

/** Fecha del último mensaje ajeno de la sala: el techo hasta el que se puede acusar. */
export async function ultimoMensajeAjeno(chatId: number, usuarioId: number) {
  return prisma.mensaje.findFirst({
    where: { chatId, usuarioId: { not: usuarioId } },
    orderBy: [{ fechaAlta: 'desc' }, { id: 'desc' }],
    select: { fechaAlta: true },
  });
}

/**
 * Los últimos mensajes de la sala, para calcular en cuánto suele responder el contacto.
 *
 * Sólo se traen emisor y fecha: el cálculo no mira el contenido. El tope lo pone el service
 * — una sala sin cota podría tener miles de filas y el dato sólo necesita los últimos.
 */
export function ultimosMensajesParaRespuesta(chatId: number, limite: number) {
  return prisma.mensaje.findMany({
    where: { chatId },
    orderBy: [{ fechaAlta: 'desc' }, { id: 'desc' }],
    take: limite,
    select: { usuarioId: true, fechaAlta: true },
  });
}
