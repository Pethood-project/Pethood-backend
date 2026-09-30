import type { Prisma } from '@prisma/client';
import { prisma } from '../../shared/prisma';
import { finDelDia } from '../../shared/validation/dates';

const INCLUDE = {
  publicacion: { include: { mascota: { include: { refugio: true } } } },
  usuario: true,
  tipoSolicitud: true,
  historicoEstados: {
    include: { estadoSolicitud: true },
    orderBy: [{ fechaAlta: 'desc' }, { id: 'desc' }],
  },
} satisfies Prisma.SolicitudInclude;

export type SolicitudAdmin = Prisma.SolicitudGetPayload<{ include: typeof INCLUDE }>;

export interface FiltrosListado {
  estados: number[];
  tipo?: string;
  refugioId?: number;
  solicitanteId?: number;
  desde?: Date;
  hasta?: Date;
  q?: string;
  page: number;
  limit: number;
}

export async function listar(f: FiltrosListado) {
  const where: Prisma.SolicitudWhereInput = {
    fechaBaja: null,
    ...(f.solicitanteId ? { usuarioId: f.solicitanteId } : {}),
    ...(f.refugioId ? { publicacion: { mascota: { refugioId: f.refugioId } } } : {}),
    ...(f.tipo ? { tipoSolicitud: { nombre: { equals: f.tipo, mode: 'insensitive' } } } : {}),
    ...(f.desde || f.hasta
      ? { fechaAlta: { gte: f.desde, lte: f.hasta ? finDelDia(f.hasta) : undefined } }
      : {}),
    ...(f.estados.length > 0
      ? { historicoEstados: { some: { fechaBaja: null, estadoSolicitudId: { in: f.estados } } } }
      : {}),
    ...(f.q
      ? {
          OR: [
            { publicacion: { mascota: { nombre: { contains: f.q, mode: 'insensitive' } } } },
            { usuario: { nombre: { contains: f.q, mode: 'insensitive' } } },
            { usuario: { apellido: { contains: f.q, mode: 'insensitive' } } },
            { usuario: { email: { contains: f.q, mode: 'insensitive' } } },
          ],
        }
      : {}),
  };

  const [items, total] = await prisma.$transaction([
    prisma.solicitud.findMany({
      where,
      include: INCLUDE,
      orderBy: [{ fechaAlta: 'desc' }, { id: 'desc' }],
      skip: (f.page - 1) * f.limit,
      take: f.limit,
    }),
    prisma.solicitud.count({ where }),
  ]);

  return { items, total };
}

export function buscar(id: number) {
  return prisma.solicitud.findUnique({ where: { id }, include: INCLUDE });
}
