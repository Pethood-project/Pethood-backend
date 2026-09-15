import { prisma } from '../../shared/prisma';

/** Vigente = fila sin fechaBaja. Mismo criterio que dashboard-admin.repository.ts. */

export function buscarUsuarioConRefugio(usuarioId: number) {
  return prisma.usuario.findFirst({ where: { id: usuarioId, fechaBaja: null } });
}

export function buscarRefugio(refugioId: number) {
  return prisma.refugio.findFirst({ where: { id: refugioId, fechaBaja: null } });
}

/** "En el refugio" = estado vigente Disponible/En_Tratamiento/En_Transito (no Adoptado/Fallecido). */
export function contarMascotasEnRefugio(refugioId: number) {
  return prisma.mascotaEstado.count({
    where: {
      fechaBaja: null,
      estadoMascota: {
        nombre: { in: ['Disponible', 'En_Tratamiento', 'En_Transito'] },
      },
      mascota: { refugioId, fechaBaja: null },
    },
  });
}

export function listarEstadosSolicitud() {
  return prisma.estadoSolicitud.findMany({ where: { fechaBaja: null } });
}

export function listarEstadosMascota() {
  return prisma.estadoMascota.findMany({ where: { fechaBaja: null } });
}

/** Igual agrupación que dashboard-admin.repository.ts, pero scopeada a las mascotas del refugio. */
export function contarMascotasPorEstado(refugioId: number) {
  return prisma.mascotaEstado.groupBy({
    by: ['estadoMascotaId'],
    where: { fechaBaja: null, mascota: { refugioId, fechaBaja: null } },
    _count: { _all: true },
  });
}

/**
 * Publicaciones vigentes (sin baja) de mascotas del refugio, con la fecha en que se publicaron
 * — el service calcula hace cuántos días están publicadas a partir de esto.
 */
export function listarPublicacionesActivas(refugioId: number) {
  return prisma.publicacion.findMany({
    where: {
      fechaBaja: null,
      mascota: { refugioId, fechaBaja: null },
    },
    select: { id: true, fechaAlta: true, mascota: { select: { nombre: true } } },
  });
}

/**
 * Solicitudes del refugio con su estado vigente, sin filtrar por período: "demoradas" es una
 * foto del backlog actual (mismo criterio snapshot que contarMascotasEnRefugio), no algo que
 * dependa del rango desde/hasta elegido en pantalla.
 */
export function listarSolicitudesAbiertas(refugioId: number) {
  return prisma.solicitud.findMany({
    where: {
      fechaBaja: null,
      publicacion: { mascota: { refugioId, fechaBaja: null } },
    },
    include: {
      publicacion: { include: { mascota: true } },
      historicoEstados: {
        where: { fechaBaja: null },
        include: { estadoSolicitud: true },
        orderBy: { fechaAlta: 'desc' },
        take: 1,
      },
    },
  });
}

/** Estado vigente de Solicitud = última Solicitud_Estado sin baja, con fechaAlta en el período. */
export function contarSolicitudesPorEstado(refugioId: number, desde: Date, hasta: Date) {
  return prisma.solicitudEstado.groupBy({
    by: ['estadoSolicitudId'],
    where: {
      fechaBaja: null,
      fechaAlta: { gte: desde, lte: hasta },
      solicitud: { publicacion: { mascota: { refugioId, fechaBaja: null } } },
    },
    _count: { _all: true },
  });
}

export function contarSolicitudesCreadas(refugioId: number, desde: Date, hasta: Date) {
  return prisma.solicitud.count({
    where: {
      fechaBaja: null,
      fechaAlta: { gte: desde, lte: hasta },
      publicacion: { mascota: { refugioId, fechaBaja: null } },
    },
  });
}

/** Solo fecha y monto: el bucketing por mes se hace en el service, igual que dashboard-admin. */
export function listarDonaciones(refugioId: number, desde: Date, hasta: Date) {
  return prisma.donacion.findMany({
    where: {
      fechaBaja: null,
      fechaAlta: { gte: desde, lte: hasta },
      campania: { refugioId, fechaBaja: null },
    },
    select: { fechaAlta: true, monto: true },
  });
}

export async function sumarObjetivoCampaniasActivas(refugioId: number): Promise<number> {
  const resultado = await prisma.campania.aggregate({
    where: { refugioId, fechaBaja: null, estadoCampania: { nombre: 'Activa' } },
    _sum: { objetivo: true },
  });

  return resultado._sum.objetivo ? Number(resultado._sum.objetivo) : 0;
}

// ─────────────── EXPORT CSV ───────────────
// Paginado por cursor (id > último visto), igual criterio que dashboard-admin.repository.ts.

export function paginaSolicitudesParaExport(
  refugioId: number,
  desde: Date,
  hasta: Date,
  cursorId: number | undefined,
  take: number,
) {
  return prisma.solicitud.findMany({
    where: {
      fechaBaja: null,
      fechaAlta: { gte: desde, lte: hasta },
      publicacion: { mascota: { refugioId, fechaBaja: null } },
      ...(cursorId ? { id: { gt: cursorId } } : {}),
    },
    orderBy: { id: 'asc' },
    take,
    include: {
      tipoSolicitud: true,
      publicacion: { include: { mascota: true } },
      historicoEstados: {
        where: { fechaBaja: null },
        include: { estadoSolicitud: true },
        orderBy: { fechaAlta: 'desc' },
        take: 1,
      },
    },
  });
}
