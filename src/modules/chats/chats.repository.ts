/**
 * Acceso a datos del chat: listado de conversaciones (HU-5.1) y sala (HU-5.2).
 *
 * El listado resuelve el último mensaje y el conteo de no leídos de TODOS los chats con dos
 * queries fijas, no una por chat: ver `ultimoMensajePorChat` y `contarNoLeidosPorChat`.
 *
 * Lo que se escribe es sólo lo de HU-5.2 —el alta de un mensaje y el marcado de leídos— y
 * nunca hay baja ni modificación de `Mensaje`: MODELO_DATOS.md lo declara excepción de
 * auditoría (solo alta). Crear salas sigue siendo de otra HU.
 */
import { Prisma } from '@prisma/client';
import { prisma } from '../../shared/prisma';
import { datosAlta } from '../../shared/auditoria';

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

/**
 * Mensajes no leídos por chat, en una sola query.
 *
 * No leído "para mí" = del chat, que no emití yo, con `leido = false`. `mensaje_leido` es un
 * booleano único por mensaje y no por participante: alcanza para una sala de dos porque el
 * único que puede leer un mensaje es el que no lo mandó. Excluir los propios es
 * imprescindible o el badge contaría los mensajes salientes del usuario.
 *
 * Los chats sin mensajes no leídos simplemente no aparecen en el resultado: el service
 * los completa con 0.
 */
export function contarNoLeidosPorChat(usuarioId: number, chatIds: number[]) {
  if (chatIds.length === 0) return Promise.resolve([]);

  return prisma.mensaje.groupBy({
    by: ['chatId'],
    where: {
      chatId: { in: chatIds },
      leido: false,
      usuarioId: { not: usuarioId },
    },
    _count: { _all: true },
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
 * Alta de mensaje. Nace `leido: false` (default del schema) y nunca se edita ni se borra.
 *
 * `usuarioAlta` es siempre el emisor: un mensaje no se da de alta en nombre de otro.
 */
export function crearMensaje(datos: {
  chatId: number;
  usuarioId: number;
  contenido: string;
  imagenUrl: string | null;
}) {
  return prisma.mensaje.create({
    data: {
      chatId: datos.chatId,
      usuarioId: datos.usuarioId,
      contenido: datos.contenido,
      imagenUrl: datos.imagenUrl,
      ...datosAlta(datos.usuarioId),
    },
  });
}

/**
 * Marca como leídos los mensajes AJENOS de la sala y devuelve cuántos cambiaron.
 *
 * `mensaje_leido` es un booleano único por mensaje, así que "leer" es una operación de sala
 * entera y no de mensaje: un solo UPDATE cubre lo que el modelo puede representar. Los
 * propios se excluyen siempre — marcar los que uno emitió pondría el doble check en el
 * dispositivo equivocado.
 *
 * Sin campos de modificación porque `Mensaje` no los tiene: MODELO_DATOS.md lo declara
 * excepción de auditoría (solo alta). Cae sobre `mensaje_chat_usuario_no_leido_idx`.
 */
export async function marcarMensajesLeidos(chatId: number, usuarioId: number): Promise<number> {
  const { count } = await prisma.mensaje.updateMany({
    where: { chatId, usuarioId: { not: usuarioId }, leido: false },
    data: { leido: true },
  });

  return count;
}
