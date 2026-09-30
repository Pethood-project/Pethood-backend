import type { Prisma } from '@prisma/client';
import { prisma } from '../../shared/prisma';
import { datosAlta } from '../../shared/auditoria';

export {
  darDeBajaConPublicaciones,
  listarSolicitudesDeMascota,
} from '../mascotas/mascotas.repository';

const INCLUDE = {
  raza: { include: { especie: true } },
  refugio: true,
  usuario: true,
  historicoEstados: {
    where: { fechaBaja: null },
    include: { estadoMascota: true },
    orderBy: { fechaAlta: 'desc' },
    take: 1,
  },
  // Publicación en curso: viva y con estado vigente distinto de Finalizada.
  publicaciones: {
    where: {
      fechaBaja: null,
      historicoEstados: {
        some: { fechaBaja: null, estadoPublicacion: { nombre: { not: 'Finalizada' } } },
      },
    },
    select: { id: true },
    take: 1,
  },
} satisfies Prisma.MascotaInclude;

export type MascotaAdmin = Prisma.MascotaGetPayload<{ include: typeof INCLUDE }>;

export interface FiltrosListado {
  estados: number[];
  especieId?: number;
  refugioId?: number;
  usuarioId?: number;
  q?: string;
  incluirBajas: boolean;
  page: number;
  limit: number;
}

export async function listar(f: FiltrosListado) {
  const where: Prisma.MascotaWhereInput = {
    ...(f.incluirBajas ? {} : { fechaBaja: null }),
    ...(f.usuarioId ? { usuarioId: f.usuarioId } : {}),
    ...(f.refugioId ? { refugioId: f.refugioId } : {}),
    ...(f.especieId ? { raza: { especieId: f.especieId } } : {}),
    ...(f.estados.length > 0
      ? { historicoEstados: { some: { fechaBaja: null, estadoMascotaId: { in: f.estados } } } }
      : {}),
    ...(f.q ? { nombre: { contains: f.q, mode: 'insensitive' } } : {}),
  };

  const [items, total] = await prisma.$transaction([
    prisma.mascota.findMany({
      where,
      include: INCLUDE,
      orderBy: [{ fechaAlta: 'desc' }, { id: 'desc' }],
      skip: (f.page - 1) * f.limit,
      take: f.limit,
    }),
    prisma.mascota.count({ where }),
  ]);

  return { items, total };
}

/** Sin filtro de baja; la historia clínica va en solo lectura (regla 8). */
export function buscar(id: number) {
  return prisma.mascota.findUnique({
    where: { id },
    include: {
      ...INCLUDE,
      historiaClinica: { where: { fechaBaja: null }, orderBy: { fechaVisita: 'desc' } },
    },
  });
}

export function reactivar(id: number) {
  return prisma.mascota.update({ where: { id }, data: { usuarioBaja: null, fechaBaja: null } });
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
