import type { Prisma } from '@prisma/client';
import { prisma } from '../../shared/prisma';
import { datosAlta, datosBaja } from '../../shared/auditoria';

export {
  buscarEnCursoDeMascota,
  buscarEstadoPublicacionPorNombre,
  cambiarEstado,
} from '../publicaciones/publicaciones.repository';

const INCLUDE_LISTA = {
  mascota: { include: { raza: { include: { especie: true } }, refugio: true } },
  usuario: true,
  historicoEstados: {
    where: { fechaBaja: null },
    include: { estadoPublicacion: true },
    orderBy: { fechaAlta: 'desc' },
    take: 1,
  },
  _count: { select: { solicitudes: { where: { fechaBaja: null } } } },
} satisfies Prisma.PublicacionInclude;

export type PublicacionAdmin = Prisma.PublicacionGetPayload<{ include: typeof INCLUDE_LISTA }>;

export interface FiltrosListado {
  estados: number[];
  refugioId?: number;
  usuarioId?: number;
  q?: string;
  incluirBajas: boolean;
  page: number;
  limit: number;
}

export async function listar(f: FiltrosListado) {
  const where: Prisma.PublicacionWhereInput = {
    ...(f.incluirBajas ? {} : { fechaBaja: null }),
    ...(f.usuarioId ? { usuarioId: f.usuarioId } : {}),
    ...(f.refugioId ? { mascota: { refugioId: f.refugioId } } : {}),
    ...(f.estados.length > 0
      ? {
          historicoEstados: {
            some: { fechaBaja: null, estadoPublicacionId: { in: f.estados } },
          },
        }
      : {}),
    ...(f.q
      ? {
          OR: [
            { titulo: { contains: f.q, mode: 'insensitive' } },
            { mascota: { nombre: { contains: f.q, mode: 'insensitive' } } },
          ],
        }
      : {}),
  };

  const [items, total] = await prisma.$transaction([
    prisma.publicacion.findMany({
      where,
      include: INCLUDE_LISTA,
      orderBy: [{ fechaAlta: 'desc' }, { id: 'desc' }],
      skip: (f.page - 1) * f.limit,
      take: f.limit,
    }),
    prisma.publicacion.count({ where }),
  ]);

  return { items, total };
}

/** Sin filtro de baja: el admin también ve las moderadas. */
export function buscar(id: number) {
  return prisma.publicacion.findUnique({
    where: { id },
    include: {
      ...INCLUDE_LISTA,
      historicoEstados: {
        include: { estadoPublicacion: true },
        orderBy: [{ fechaAlta: 'desc' }, { id: 'desc' }],
      },
    },
  });
}

/** Baja lógica: cierra el estado vigente en la misma transacción (HU-3.5). */
export function darDeBaja(id: number, adminId: number) {
  return prisma.$transaction([
    prisma.publicacionEstado.updateMany({
      where: { publicacionId: id, fechaBaja: null },
      data: datosBaja(adminId),
    }),
    prisma.publicacion.update({ where: { id }, data: datosBaja(adminId) }),
  ]);
}

/** Revierte la baja y reabre el último estado que tenía la publicación. */
export function revertirBaja(id: number, estadoPublicacionId: number, adminId: number) {
  return prisma.$transaction([
    prisma.publicacion.update({
      where: { id },
      data: { usuarioBaja: null, fechaBaja: null },
    }),
    prisma.publicacionEstado.create({
      data: { publicacionId: id, estadoPublicacionId, ...datosAlta(adminId) },
    }),
  ]);
}

export function crearNotificacion(datos: { mensaje: string; usuarioId: number; adminId: number }) {
  return prisma.notificacion.create({
    data: {
      tipo: 'MODERACION',
      mensaje: datos.mensaje,
      usuarioId: datos.usuarioId,
      ...datosAlta(datos.adminId),
    },
  });
}

export function buscarEstadoMascotaVigente(mascotaId: number) {
  return prisma.mascotaEstado
    .findFirst({
      where: { mascotaId, fechaBaja: null },
      include: { estadoMascota: true },
      orderBy: { fechaAlta: 'desc' },
    })
    .then((fila) => fila?.estadoMascota ?? null);
}

/** Reportes pendientes (spec 008) por publicación: `{ publicacionId → cantidad }`. */
export async function contarReportesPendientes(ids: number[]) {
  const filas = await prisma.reporteProblema.groupBy({
    by: ['objetoId'],
    where: { tipo: 'PUBLICACION', objetoId: { in: ids }, resuelto: false, fechaBaja: null },
    _count: { _all: true },
  });
  return new Map(filas.map((f) => [f.objetoId, f._count._all]));
}
