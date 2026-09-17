import { Prisma } from '@prisma/client';
import { prisma } from '../../shared/prisma';
import { datosAlta, datosBaja, datosModificacion } from '../../shared/auditoria';

/**
 * Una solicitud entra en seguimiento cuando tiene un estado "Aprobada" vigente. El filtro de
 * acá es amplio a propósito (`some`): cuál es el estado ACTUAL lo decide el service mirando
 * el histórico ordenado, porque una solicitud podría tener estados posteriores.
 */
const APROBADA_VIGENTE = {
  historicoEstados: {
    some: { fechaBaja: null, estadoSolicitud: { nombre: 'Aprobada' } },
  },
};

/** Todo lo que el service necesita de una solicitud para resolver permisos y armar GUI-21. */
const INCLUDE_SOLICITUD = {
  tipoSolicitud: { select: { id: true, nombre: true } },
  usuario: { select: { id: true, nombre: true, apellido: true } },
  publicacion: {
    select: {
      id: true,
      usuarioId: true,
      mascota: { select: { id: true, nombre: true, imagenUrl: true, refugioId: true } },
    },
  },
  historicoEstados: {
    where: { fechaBaja: null },
    orderBy: [{ fechaAlta: 'desc' }, { id: 'desc' }],
    select: { id: true, fechaAlta: true, estadoSolicitud: { select: { nombre: true } } },
  },
  seguimientos: {
    where: { fechaBaja: null },
    orderBy: { fechaAlta: 'asc' },
    include: { preguntaSeguimiento: { select: { id: true, texto: true } } },
  },
  // `satisfies` y no `as const`: hace falta que el tipo quede estrecho para que Prisma
  // infiera el payload con las relaciones, pero `as const` lo vuelve readonly y Prisma
  // rechaza los `orderBy` inmutables.
} satisfies Prisma.SolicitudInclude;

export type SolicitudEnSeguimiento = NonNullable<Awaited<ReturnType<typeof buscarSolicitud>>>;
export type SeguimientoConPregunta = SolicitudEnSeguimiento['seguimientos'][number];

/**
 * Solicitudes aprobadas que el usuario puede ver: las que pidió él (es el adoptante), las de
 * publicaciones suyas, y —si es personal de refugio— las de mascotas de ese refugio.
 */
export function listarSolicitudesDeUsuario(usuarioId: number, refugioId: number | null) {
  const comoRefugio = refugioId === null ? [] : [{ publicacion: { mascota: { refugioId } } }];

  return prisma.solicitud.findMany({
    where: {
      fechaBaja: null,
      ...APROBADA_VIGENTE,
      OR: [{ usuarioId }, { publicacion: { usuarioId } }, ...comoRefugio],
    },
    include: INCLUDE_SOLICITUD,
    orderBy: { fechaAlta: 'desc' },
  });
}

export function buscarSolicitud(solicitudId: number) {
  return prisma.solicitud.findFirst({
    where: { id: solicitudId, fechaBaja: null },
    include: INCLUDE_SOLICITUD,
  });
}

export function buscarUsuario(usuarioId: number) {
  return prisma.usuario.findFirst({
    where: { id: usuarioId, fechaBaja: null },
    select: { id: true, refugioId: true },
  });
}

/** Catálogo vigente de preguntas del flujo pedido (adopción o tránsito). */
export function listarPreguntas(esAdopcion: boolean) {
  return prisma.preguntaSeguimiento.findMany({
    where: { esAdopcion, fechaBaja: null },
    orderBy: { posicion: 'asc' },
    select: { id: true, texto: true },
  });
}

export interface DatosNuevoPedido {
  solicitudId: number;
  preguntaSeguimientoId: number;
  /** Cuándo llegó el pedido: es su fecha de alta, no "ahora". */
  fechaPedido: Date;
  plazo: Date;
}

/**
 * Materializa los pedidos que ya vencieron su fecha. `fechaAlta` se fuerza a la fecha del
 * pedido y no a "ahora": el pedido existe conceptualmente desde ese día, aunque la fila se
 * escriba recién cuando alguien abre la pantalla.
 */
export function crearPedidos(pedidos: DatosNuevoPedido[], usuarioAlta: number) {
  return prisma.$transaction(
    pedidos.map((pedido) =>
      prisma.seguimiento.create({
        data: {
          solicitudId: pedido.solicitudId,
          preguntaSeguimientoId: pedido.preguntaSeguimientoId,
          plazo: pedido.plazo,
          ...datosAlta(usuarioAlta),
          fechaAlta: pedido.fechaPedido,
        },
        include: { preguntaSeguimiento: { select: { id: true, texto: true } } },
      }),
    ),
  );
}

export function buscarSeguimiento(seguimientoId: number) {
  return prisma.seguimiento.findFirst({
    where: { id: seguimientoId, fechaBaja: null },
    include: { preguntaSeguimiento: { select: { id: true, texto: true } } },
  });
}

/** HU-9.1: el adoptante completa el pedido con su descripción y la foto de evidencia. */
export function responderSeguimiento(
  seguimientoId: number,
  datos: { descripcion: string; fotoUrl: string },
  usuarioId: number,
) {
  return prisma.seguimiento.update({
    where: { id: seguimientoId },
    data: { ...datos, ...datosModificacion(usuarioId) },
    include: { preguntaSeguimiento: { select: { id: true, texto: true } } },
  });
}

/**
 * Marca los pedidos vencidos como ya procesados. Es lo que hace idempotente el aviso al
 * publicador: un pedido con `fechaModificacion` puesta ya notificó y no vuelve a hacerlo.
 */
export function marcarVencidosNotificados(seguimientoIds: number[], usuarioId: number) {
  return prisma.seguimiento.updateMany({
    where: { id: { in: seguimientoIds } },
    data: datosModificacion(usuarioId),
  });
}

export function crearNotificacion(datos: {
  tipo: string;
  mensaje: string;
  usuarioId: number;
  usuarioAlta: number;
}) {
  return prisma.notificacion.create({
    data: {
      tipo: datos.tipo,
      mensaje: datos.mensaje,
      usuarioId: datos.usuarioId,
      ...datosAlta(datos.usuarioAlta),
    },
  });
}

/** HU-9.1: terminado el tránsito, los pedidos se dan de baja (lógica, nunca DELETE). */
export function darDeBajaSeguimientosDeSolicitud(solicitudId: number, usuarioBaja: number) {
  return prisma.seguimiento.updateMany({
    where: { solicitudId, fechaBaja: null },
    data: datosBaja(usuarioBaja),
  });
}
