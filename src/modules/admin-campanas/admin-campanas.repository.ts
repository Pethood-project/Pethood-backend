import type { Prisma } from '@prisma/client';
import { prisma } from '../../shared/prisma';

const INCLUDE = {
  estadoCampania: true,
  refugio: { select: { id: true, nombre: true } },
} satisfies Prisma.CampaniaInclude;

export type CampanaAdmin = Prisma.CampaniaGetPayload<{ include: typeof INCLUDE }>;

export interface FiltrosListado {
  estado?: string;
  refugioId?: number;
  q?: string;
  page: number;
  limit: number;
}

export async function listar(f: FiltrosListado) {
  const where: Prisma.CampaniaWhereInput = {
    fechaBaja: null,
    ...(f.refugioId ? { refugioId: f.refugioId } : {}),
    ...(f.estado ? { estadoCampania: { nombre: { equals: f.estado, mode: 'insensitive' } } } : {}),
    ...(f.q
      ? {
          OR: [
            { titulo: { contains: f.q, mode: 'insensitive' } },
            { refugio: { nombre: { contains: f.q, mode: 'insensitive' } } },
          ],
        }
      : {}),
  };

  const [items, total] = await prisma.$transaction([
    prisma.campania.findMany({
      where,
      include: INCLUDE,
      orderBy: [{ fechaAlta: 'desc' }, { id: 'desc' }],
      skip: (f.page - 1) * f.limit,
      take: f.limit,
    }),
    prisma.campania.count({ where }),
  ]);

  return { items, total };
}

export function buscar(id: number) {
  return prisma.campania.findFirst({ where: { id, fechaBaja: null }, include: INCLUDE });
}

/** Donaciones declaradas (no confirmadas: el modelo no distingue, ver regla 11). */
export function resumenDonaciones(campaniaId: number) {
  return prisma.donacion.aggregate({
    where: { campaniaId, fechaBaja: null },
    _count: { _all: true },
    _sum: { monto: true },
  });
}
