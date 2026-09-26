import { Prisma } from '@prisma/client';
import type { Ambito } from '../../shared/ambito';
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
  // La pregunta que el refugio dejó programada para el próximo pedido automático: es suya
  // (`solicitudId`) y todavía no la usó ningún pedido.
  preguntasSeguimiento: {
    where: { fechaBaja: null, seguimientos: { none: {} } },
    orderBy: [{ fechaAlta: 'desc' }, { id: 'desc' }],
    select: { id: true, texto: true, fechaAlta: true },
  },
  // `satisfies` y no `as const`: hace falta que el tipo quede estrecho para que Prisma
  // infiera el payload con las relaciones, pero `as const` lo vuelve readonly y Prisma
  // rechaza los `orderBy` inmutables.
} satisfies Prisma.SolicitudInclude;

export type SolicitudEnSeguimiento = NonNullable<Awaited<ReturnType<typeof buscarSolicitud>>>;
export type SeguimientoConPregunta = SolicitudEnSeguimiento['seguimientos'][number];

/**
 * Solicitudes aprobadas que el usuario puede ver desde el perfil con el que consulta (ver
 * `shared/ambito.ts`):
 * - PERSONAL: las que pidió él (es el adoptante) y las de sus mascotas personales publicadas.
 * - REFUGIO: las de mascotas de su refugio.
 */
export function listarSolicitudesDeUsuario(
  usuarioId: number,
  refugioId: number | null,
  ambito: Ambito,
) {
  const OR: Prisma.SolicitudWhereInput[] =
    ambito === 'REFUGIO'
      ? // `-1` no matchea nada: cubre un refugio desasignado después del login.
        [{ publicacion: { mascota: { refugioId: refugioId ?? -1 } } }]
      : [{ usuarioId }, { publicacion: { usuarioId, mascota: { refugioId: null } } }];

  return prisma.solicitud.findMany({
    where: {
      fechaBaja: null,
      ...APROBADA_VIGENTE,
      OR,
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

/**
 * Catálogo vigente de preguntas del flujo pedido (adopción o tránsito). Deja afuera las que
 * escribieron los refugios para una solicitud puntual: esas no se sortean nunca.
 */
export function listarPreguntas(esAdopcion: boolean) {
  return prisma.preguntaSeguimiento.findMany({
    where: { esAdopcion, solicitudId: null, fechaBaja: null },
    orderBy: { posicion: 'asc' },
    select: { id: true, texto: true, esInicial: true },
  });
}

export interface DatosNuevoPedido {
  solicitudId: number;
  preguntaSeguimientoId: number;
  /** Cuándo llegó el pedido: es su fecha de alta, no "ahora". */
  fechaPedido: Date;
  plazo: Date;
}

const INCLUDE_PREGUNTA = { preguntaSeguimiento: { select: { id: true, texto: true } } } as const;

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
          esManual: false,
          plazo: pedido.plazo,
          ...datosAlta(usuarioAlta),
          fechaAlta: pedido.fechaPedido,
        },
        include: INCLUDE_PREGUNTA,
      }),
    ),
  );
}

interface DatosPreguntaDeSolicitud {
  solicitudId: number;
  texto: string;
  esAdopcion: boolean;
}

/**
 * Una pregunta escrita por el refugio, atada a su solicitud. `posicion` no aplica (no es del
 * catálogo): va en 0.
 */
function datosPreguntaDeSolicitud(datos: DatosPreguntaDeSolicitud, usuarioAlta: number) {
  return {
    texto: datos.texto,
    esAdopcion: datos.esAdopcion,
    posicion: 0,
    solicitud: { connect: { id: datos.solicitudId } },
    ...datosAlta(usuarioAlta),
  };
}

/**
 * Pedido manual del refugio: se crea en el momento, con su propia pregunta, y queda marcado
 * como manual para que no ocupe un lugar en la secuencia de días. Pregunta y pedido se
 * escriben juntos (create anidado = una sola transacción).
 */
export function crearPedidoManual(
  datos: DatosPreguntaDeSolicitud & { fechaPedido: Date; plazo: Date },
  usuarioAlta: number,
) {
  return prisma.seguimiento.create({
    data: {
      solicitud: { connect: { id: datos.solicitudId } },
      preguntaSeguimiento: { create: datosPreguntaDeSolicitud(datos, usuarioAlta) },
      esManual: true,
      plazo: datos.plazo,
      ...datosAlta(usuarioAlta),
      fechaAlta: datos.fechaPedido,
    },
    include: INCLUDE_PREGUNTA,
  });
}

/**
 * Deja una pregunta del refugio esperando al próximo pedido automático. Hay a lo sumo una:
 * si ya había otra programada se da de baja (lógica) y la reemplaza la nueva.
 */
export async function programarPregunta(datos: DatosPreguntaDeSolicitud, usuarioId: number) {
  const [, creada] = await prisma.$transaction([
    prisma.preguntaSeguimiento.updateMany({
      where: { solicitudId: datos.solicitudId, fechaBaja: null, seguimientos: { none: {} } },
      data: datosBaja(usuarioId),
    }),
    prisma.preguntaSeguimiento.create({
      data: datosPreguntaDeSolicitud(datos, usuarioId),
      select: { id: true, texto: true, fechaAlta: true },
    }),
  ]);

  return creada;
}

/** Baja lógica de la pregunta programada de la solicitud. Devuelve cuántas dio de baja. */
export async function cancelarPreguntaProgramada(solicitudId: number, usuarioId: number) {
  const { count } = await prisma.preguntaSeguimiento.updateMany({
    where: { solicitudId, fechaBaja: null, seguimientos: { none: {} } },
    data: datosBaja(usuarioId),
  });

  return count;
}

export function buscarSeguimiento(seguimientoId: number) {
  return prisma.seguimiento.findFirst({
    where: { id: seguimientoId, fechaBaja: null },
    include: INCLUDE_PREGUNTA,
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
    include: INCLUDE_PREGUNTA,
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
