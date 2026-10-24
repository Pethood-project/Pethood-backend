import { prisma } from '../../shared/prisma';
import { datosAlta, datosBaja } from '../../shared/auditoria';

/** Campos del autor que se muestran en la reseña. */
const AUTOR_SELECT = { id: true, nombre: true, apellido: true, imagenUrl: true } as const;

/**
 * Vínculo mínimo con la transacción para poder derivar el flujo de la reseña sin otra
 * consulta: quién solicitó, qué tipo de solicitud era y de quién era la mascota.
 */
const SOLICITUD_SELECT = {
  usuarioId: true,
  tipoSolicitud: { select: { nombre: true } },
  publicacion: { select: { mascota: { select: { refugioId: true } } } },
} as const;

export interface DatosCrearResena {
  puntuacion: number;
  comentario: string | null;
  usuarioAutorId: number;
  refugioReportadoId: number | null;
  usuarioReportadoId: number | null;
  solicitudId: number;
}

export function buscarUsuario(usuarioId: number) {
  return prisma.usuario.findFirst({
    where: { id: usuarioId, fechaBaja: null },
    select: { id: true, refugioId: true },
  });
}

/**
 * La transacción con sus dos partes: el solicitante y la publicación con su mascota, de
 * quien depende si la contraparte es un refugio o una persona. El estado VIGENTE es el
 * primer elemento del histórico ordenado desc (el alta de un estado no da de baja al
 * anterior; ver `solicitudes.repository.ts`).
 */
export function buscarSolicitudConPartes(solicitudId: number) {
  return prisma.solicitud.findFirst({
    where: { id: solicitudId, fechaBaja: null },
    include: {
      tipoSolicitud: true,
      usuario: { select: AUTOR_SELECT },
      publicacion: {
        include: {
          mascota: {
            include: {
              refugio: { select: { id: true, nombre: true, imagenUrl: true } },
              usuario: { select: AUTOR_SELECT },
            },
          },
        },
      },
      historicoEstados: {
        where: { fechaBaja: null },
        include: { estadoSolicitud: true },
        orderBy: { fechaAlta: 'desc' },
        take: 1,
      },
    },
  });
}

/** Reseña activa de este autor sobre esta transacción, si ya existe. */
export function buscarActivaDeAutor(solicitudId: number, usuarioAutorId: number) {
  return prisma.resena.findFirst({
    where: { solicitudId, usuarioAutorId, fechaBaja: null },
    select: { id: true },
  });
}

export function buscarResena(resenaId: number) {
  return prisma.resena.findFirst({ where: { id: resenaId, fechaBaja: null } });
}

export function crear(datos: DatosCrearResena) {
  return prisma.resena.create({
    data: { ...datos, ...datosAlta(datos.usuarioAutorId) },
    include: { autor: { select: AUTOR_SELECT }, solicitud: { select: SOLICITUD_SELECT } },
  });
}

export function darDeBaja(resenaId: number, usuarioBaja: number) {
  return prisma.resena.update({ where: { id: resenaId }, data: datosBaja(usuarioBaja) });
}

export function listarDeUsuario(usuarioReportadoId: number) {
  return prisma.resena.findMany({
    where: { usuarioReportadoId, fechaBaja: null },
    include: { autor: { select: AUTOR_SELECT }, solicitud: { select: SOLICITUD_SELECT } },
    orderBy: { fechaAlta: 'desc' },
  });
}

export function listarDeRefugio(refugioReportadoId: number) {
  return prisma.resena.findMany({
    where: { refugioReportadoId, fechaBaja: null },
    include: { autor: { select: AUTOR_SELECT }, solicitud: { select: SOLICITUD_SELECT } },
    orderBy: { fechaAlta: 'desc' },
  });
}

/** Quién recibe las reseñas que se consultan: una persona o un refugio. */
export type ReceptorResenas = { usuarioReportadoId: number } | { refugioReportadoId: number };

/**
 * Una página del historial, de la más nueva a la más vieja. El id va como desempate para que
 * dos reseñas con la misma fecha no se repitan ni se salteen entre páginas. Se piden
 * `limite + 1` filas para saber si hay más sin un `count` aparte; `skip: 1` porque la reseña
 * del cursor es la última que el cliente ya tiene.
 */
export function listarPaginaDeReceptor(receptor: ReceptorResenas, limite: number, cursor?: number) {
  return prisma.resena.findMany({
    where: { ...receptor, fechaBaja: null },
    include: { autor: { select: AUTOR_SELECT }, solicitud: { select: SOLICITUD_SELECT } },
    orderBy: [{ fechaAlta: 'desc' }, { id: 'desc' }],
    take: limite + 1,
    ...(cursor === undefined ? {} : { cursor: { id: cursor }, skip: 1 }),
  });
}

/** ¿El cursor es una reseña viva de este receptor? Con un id ajeno la página saldría vacía. */
export async function existeDeReceptor(receptor: ReceptorResenas, resenaId: number) {
  const fila = await prisma.resena.findFirst({
    where: { ...receptor, id: resenaId, fechaBaja: null },
    select: { id: true },
  });

  return fila !== null;
}

/** Cuántas reseñas vivas hay de cada puntuación: alcanza para el promedio y el desglose. */
export async function contarPorPuntuacion(receptor: ReceptorResenas) {
  const filas = await prisma.resena.groupBy({
    by: ['puntuacion'],
    where: { ...receptor, fechaBaja: null },
    _count: { _all: true },
  });

  return filas.map((fila) => ({ puntuacion: fila.puntuacion, cantidad: fila._count._all }));
}

/**
 * Transacciones vivas en las que el actor es parte, desde cualquiera de sus dos perfiles:
 * lo que solicitó (solicitante) o lo que publicó (mascota personal o de su refugio). El
 * service filtra las que están "Aprobada" y descarta las ya reseñadas.
 */
export function listarTransaccionesDelActor(usuarioId: number, refugioId: number | null) {
  const condiciones: object[] = [
    { usuarioId },
    { publicacion: { mascota: { usuarioId, refugioId: null } } },
  ];

  if (refugioId !== null) {
    condiciones.push({ publicacion: { mascota: { refugioId } } });
  }

  return prisma.solicitud.findMany({
    where: { fechaBaja: null, OR: condiciones },
    include: {
      tipoSolicitud: true,
      usuario: { select: AUTOR_SELECT },
      publicacion: {
        include: {
          mascota: {
            include: {
              refugio: { select: { id: true, nombre: true, imagenUrl: true } },
              usuario: { select: AUTOR_SELECT },
            },
          },
        },
      },
      historicoEstados: {
        where: { fechaBaja: null },
        include: { estadoSolicitud: true },
        orderBy: { fechaAlta: 'desc' },
        take: 1,
      },
    },
    orderBy: { fechaAlta: 'desc' },
  });
}

/** Ids de las transacciones que este autor ya reseñó, de las que se están evaluando. */
export function listarSolicitudesResenadas(usuarioAutorId: number, solicitudIds: number[]) {
  if (solicitudIds.length === 0) return Promise.resolve<{ solicitudId: number | null }[]>([]);

  return prisma.resena.findMany({
    where: { usuarioAutorId, fechaBaja: null, solicitudId: { in: solicitudIds } },
    select: { solicitudId: true },
  });
}
