import { prisma } from '../../shared/prisma';
import { datosAlta, datosBaja, USUARIO_SISTEMA_ID } from '../../shared/auditoria';

/** Notificaciones visibles del usuario: propias y no dadas de baja. */
function visiblesDe(usuarioId: number) {
  return { usuarioId, fechaBaja: null };
}

/**
 * Bandeja paginada por cursor (mismo esquema que `animales-perdidos`/chat): `cursor` es el id
 * de la última notificación que el cliente ya tiene, se pide `limite + 1` para saber si hay
 * más y se ordena con el id como desempate.
 */
export function listarDeUsuario(usuarioId: number, limite: number, cursor?: number) {
  return prisma.notificacion.findMany({
    where: visiblesDe(usuarioId),
    orderBy: [{ fechaAlta: 'desc' }, { id: 'desc' }],
    take: limite + 1,
    ...(cursor === undefined ? {} : { cursor: { id: cursor }, skip: 1 }),
  });
}

/** Un cursor que no exista paginaría desde ningún lado — se distingue de "no hay más". */
export function existeVisible(usuarioId: number, notificacionId: number) {
  return prisma.notificacion
    .findFirst({ where: { id: notificacionId, ...visiblesDe(usuarioId) }, select: { id: true } })
    .then(Boolean);
}

export function contarNoLeidas(usuarioId: number) {
  return prisma.notificacion.count({ where: { ...visiblesDe(usuarioId), leido: false } });
}

/** Solo del propio usuario: quien llama ya resolvió `usuarioId` del JWT, nunca del cliente. */
export function buscarPropia(usuarioId: number, notificacionId: number) {
  return prisma.notificacion.findFirst({ where: { id: notificacionId, ...visiblesDe(usuarioId) } });
}

/**
 * ¿Ya se mandó ESTA notificación puntual antes? Se usa desde los jobs programados para no
 * repetir un aviso en cada corrida (ej. el recordatorio de 24h de un mismo seguimiento).
 * Deliberadamente ignora `fechaBaja`: si el usuario la borró de la bandeja, igual no
 * corresponde volver a mandarla — es un evento de una sola vez, no un recordatorio repetido.
 */
export function existioAlguna(
  usuarioId: number,
  tipo: string,
  entidadTipo: string,
  entidadId: number,
) {
  return prisma.notificacion
    .findFirst({ where: { usuarioId, tipo, entidadTipo, entidadId }, select: { id: true } })
    .then(Boolean);
}

/** Para el canal mail: a qué dirección mandarle. */
export function buscarEmailUsuario(usuarioId: number) {
  return prisma.usuario.findFirst({ where: { id: usuarioId }, select: { email: true } });
}

export interface DatosNotificacion {
  usuarioId: number;
  tipo: string;
  mensaje: string;
  entidadTipo?: string;
  entidadId?: number;
  usuarioAlta: number;
}

export function crear(datos: DatosNotificacion) {
  return prisma.notificacion.create({
    data: {
      usuarioId: datos.usuarioId,
      tipo: datos.tipo,
      mensaje: datos.mensaje,
      entidadTipo: datos.entidadTipo ?? null,
      entidadId: datos.entidadId ?? null,
      ...datosAlta(datos.usuarioAlta),
    },
  });
}

/**
 * Notificación agrupada de chat sin leer para esa sala y ese destinatario, si existe (regla
 * 4: "Tenés N mensajes nuevos de X" en vez de una fila por mensaje).
 */
export function buscarChatAgrupadaSinLeer(usuarioId: number, chatId: number) {
  return prisma.notificacion.findFirst({
    where: { usuarioId, entidadTipo: 'CHAT', entidadId: chatId, leido: false, fechaBaja: null },
  });
}

export function actualizarMensaje(notificacionId: number, mensaje: string, usuarioModificacion: number) {
  return prisma.notificacion.update({
    where: { id: notificacionId },
    data: {
      mensaje,
      usuarioModificacion,
      fechaModificacion: new Date(),
      // Un mensaje nuevo en una sala que ya se había leído tiene que reabrir el aviso.
      leido: false,
    },
  });
}

export function marcarLeida(notificacionId: number, usuarioModificacion: number) {
  return prisma.notificacion.update({
    where: { id: notificacionId },
    data: { leido: true, usuarioModificacion, fechaModificacion: new Date() },
  });
}

export function marcarTodasLeidas(usuarioId: number) {
  return prisma.notificacion.updateMany({
    where: { ...visiblesDe(usuarioId), leido: false },
    data: { leido: true, usuarioModificacion: usuarioId, fechaModificacion: new Date() },
  });
}

export function darDeBaja(notificacionId: number, usuarioBaja: number) {
  return prisma.notificacion.update({ where: { id: notificacionId }, data: datosBaja(usuarioBaja) });
}

// ─────────────── Dispositivos push ───────────────

/** Todos los tokens activos del usuario, para mandarles un push de una sola tanda. */
export function listarDispositivosActivos(usuarioId: number) {
  return prisma.dispositivoPush.findMany({
    where: { usuarioId, fechaBaja: null },
    select: { expoPushToken: true },
  });
}

/** Upsert por `(usuarioId, expoPushToken)`: reloguearse en el mismo dispositivo no duplica. */
export function registrarDispositivo(usuarioId: number, expoPushToken: string, plataforma: string) {
  return prisma.dispositivoPush.upsert({
    where: { usuarioId_expoPushToken: { usuarioId, expoPushToken } },
    create: { usuarioId, expoPushToken, plataforma, ...datosAlta(usuarioId) },
    // Reactiva un dispositivo que se había dado de baja (logout previo) al volver a loguearse.
    update: {
      plataforma,
      fechaBaja: null,
      usuarioBaja: null,
      usuarioModificacion: usuarioId,
      fechaModificacion: new Date(),
    },
  });
}

export function darDeBajaDispositivo(usuarioId: number, expoPushToken: string) {
  return prisma.dispositivoPush.updateMany({
    where: { usuarioId, expoPushToken, fechaBaja: null },
    data: datosBaja(usuarioId),
  });
}

/** Usado por el worker cuando Expo marca un token como `DeviceNotRegistered`. */
export function darDeBajaDispositivoPorToken(expoPushToken: string) {
  return prisma.dispositivoPush.updateMany({
    where: { expoPushToken, fechaBaja: null },
    data: datosBaja(USUARIO_SISTEMA_ID),
  });
}
