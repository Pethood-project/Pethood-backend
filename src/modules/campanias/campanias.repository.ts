import type { Prisma } from '@prisma/client';
import { prisma } from '../../shared/prisma';
import { datosAlta, datosModificacion } from '../../shared/auditoria';
import { finDelDia, inicioDelDia } from '../../shared/validation/dates';
import {
  ESTADO_CAMPANIA,
  ESTADO_DONACION,
  ESTADOS_VIGENTES,
  type NombreEstadoDonacion,
} from './campanias.estados';

/** Lo que pinta una tarjeta, en una sola query. El progreso sale de `resumirDonaciones`. */
const SELECCION_CAMPANIA = {
  id: true,
  titulo: true,
  descripcion: true,
  imagenUrl: true,
  objetivo: true,
  fechaInicio: true,
  fechaFin: true,
  alias: true,
  cbu: true,
  refugioId: true,
  fechaAlta: true,
  estadoCampania: { select: { id: true, nombre: true } },
  refugio: { select: { id: true, nombre: true, imagenUrl: true } },
} satisfies Prisma.CampaniaSelect;

export type CampaniaConRelaciones = Prisma.CampaniaGetPayload<{
  select: typeof SELECCION_CAMPANIA;
}>;

const SELECCION_DONACION = {
  id: true,
  monto: true,
  motivoRechazo: true,
  fechaAlta: true,
  estadoDonacion: { select: { id: true, nombre: true } },
  usuario: { select: { id: true, nombre: true, apellido: true, imagenUrl: true } },
} satisfies Prisma.DonacionSelect;

export type DonacionConRelaciones = Prisma.DonacionGetPayload<{
  select: typeof SELECCION_DONACION;
}>;

export interface ResumenDonaciones {
  recaudado: number;
  donantes: number;
  pendientes: number;
}

/**
 * Recaudado, donantes y pendientes de varias campañas en tres queries agrupadas, sin N+1.
 * Sólo las Realizada suman (regla transversal 11). Toda campaña pedida tiene entrada, en 0 si
 * no tiene donaciones.
 */
export async function resumirDonaciones(
  campaniaIds: number[],
): Promise<Map<number, ResumenDonaciones>> {
  const resumen = new Map<number, ResumenDonaciones>(
    campaniaIds.map((id) => [id, { recaudado: 0, donantes: 0, pendientes: 0 }]),
  );
  if (campaniaIds.length === 0) return resumen;

  const base = { campaniaId: { in: campaniaIds }, fechaBaja: null };
  const realizadas = { ...base, estadoDonacion: { nombre: ESTADO_DONACION.REALIZADA } };

  const [montos, donantes, pendientes] = await Promise.all([
    prisma.donacion.groupBy({ by: ['campaniaId'], where: realizadas, _sum: { monto: true } }),
    prisma.donacion.groupBy({ by: ['campaniaId', 'usuarioId'], where: realizadas }),
    prisma.donacion.groupBy({
      by: ['campaniaId'],
      where: { ...base, estadoDonacion: { nombre: ESTADO_DONACION.PENDIENTE } },
      _count: { _all: true },
    }),
  ]);

  for (const fila of montos) {
    resumen.get(fila.campaniaId)!.recaudado = fila._sum.monto ? Number(fila._sum.monto) : 0;
  }
  for (const fila of donantes) {
    resumen.get(fila.campaniaId)!.donantes += 1;
  }
  for (const fila of pendientes) {
    resumen.get(fila.campaniaId)!.pendientes = fila._count._all;
  }

  return resumen;
}

/** El usuario con su refugio y lo necesario para saber si puede crear campañas. */
export function buscarUsuarioConRefugio(usuarioId: number) {
  return prisma.usuario.findFirst({
    where: { id: usuarioId, fechaBaja: null },
    select: {
      id: true,
      refugioId: true,
      refugio: {
        select: {
          id: true,
          verificado: true,
          fechaBaja: true,
          estado: { select: { nombre: true } },
        },
      },
    },
  });
}

export function buscarEstadosCampania() {
  return prisma.estadoCampania.findMany({
    where: { fechaBaja: null },
    select: { id: true, nombre: true },
  });
}

export function buscarEstadosDonacion() {
  return prisma.estadoDonacion.findMany({
    where: { fechaBaja: null },
    select: { id: true, nombre: true },
  });
}

/** Para la quota (§6.3): Inactiva + Activa del refugio. */
export function contarVigentes(refugioId: number) {
  return prisma.campania.count({
    where: {
      refugioId,
      fechaBaja: null,
      estadoCampania: { nombre: { in: [...ESTADOS_VIGENTES] } },
    },
  });
}

export function crear(
  datos: {
    titulo: string;
    descripcion: string;
    objetivo: number;
    fechaInicio: Date;
    fechaFin: Date;
    alias: string | null;
    cbu: string | null;
    imagenUrl: string;
    refugioId: number;
    estadoCampaniaId: number;
  },
  usuarioId: number,
) {
  return prisma.campania.create({
    data: { ...datos, ...datosAlta(usuarioId) },
    select: SELECCION_CAMPANIA,
  });
}

/** Una campaña no dada de baja. Cancelar NO la da de baja (§6.4): sigue apareciendo. */
export function buscarPorId(id: number) {
  return prisma.campania.findFirst({
    where: { id, fechaBaja: null },
    select: SELECCION_CAMPANIA,
  });
}

/** ¿Existe la campaña del cursor? Sin esto, Prisma devuelve una página vacía sin avisar. */
export function existeCampania(id: number) {
  return prisma.campania.findUnique({ where: { id }, select: { id: true } });
}

export interface FiltrosDelRefugio {
  fechaDesde?: Date;
  fechaHasta?: Date;
  estados: number[];
}

/**
 * «Mis Campañas», de la más reciente a la más vieja (por alta, con el id de desempate para que
 * el cursor no repita ni saltee). La fecha filtra por el INICIO de la campaña (HU-12.1).
 */
export function listarDelRefugio(
  refugioId: number,
  filtros: FiltrosDelRefugio,
  limite: number,
  cursor?: number,
) {
  const { fechaDesde, fechaHasta, estados } = filtros;

  return prisma.campania.findMany({
    where: {
      refugioId,
      fechaBaja: null,
      ...(fechaDesde
        ? {
            fechaInicio: {
              gte: inicioDelDia(fechaDesde),
              ...(fechaHasta ? { lte: finDelDia(fechaHasta) } : {}),
            },
          }
        : {}),
      ...(estados.length > 0 ? { estadoCampaniaId: { in: estados } } : {}),
    },
    orderBy: [{ fechaAlta: 'desc' }, { id: 'desc' }],
    take: limite + 1,
    ...(cursor === undefined ? {} : { cursor: { id: cursor }, skip: 1 }),
    select: SELECCION_CAMPANIA,
  });
}

/** Portal del adoptante (HU-12.2): sólo las Activa, de todos los refugios. */
export function listarActivas(limite: number, cursor?: number) {
  return prisma.campania.findMany({
    where: { fechaBaja: null, estadoCampania: { nombre: ESTADO_CAMPANIA.ACTIVA } },
    orderBy: [{ fechaAlta: 'desc' }, { id: 'desc' }],
    take: limite + 1,
    ...(cursor === undefined ? {} : { cursor: { id: cursor }, skip: 1 }),
    select: SELECCION_CAMPANIA,
  });
}

/**
 * Cambia el estado sólo si sigue en `desdeEstadoId`. Devuelve si cambió: `false` es la carrera
 * esperada con otro miembro o con el cron, no un error de base.
 */
export async function cambiarEstadoSi(
  id: number,
  desdeEstadoId: number,
  haciaEstadoId: number,
  usuarioId: number,
): Promise<boolean> {
  const { count } = await prisma.campania.updateMany({
    where: { id, estadoCampaniaId: desdeEstadoId, fechaBaja: null },
    data: { estadoCampaniaId: haciaEstadoId, ...datosModificacion(usuarioId) },
  });
  return count === 1;
}

/** Lo que evalúa el cron (HU-12.4): las que todavía pueden cambiar solas. */
export function listarVigentesParaCron() {
  return prisma.campania.findMany({
    where: { fechaBaja: null, estadoCampania: { nombre: { in: [...ESTADOS_VIGENTES] } } },
    select: {
      id: true,
      objetivo: true,
      fechaInicio: true,
      fechaFin: true,
      estadoCampania: { select: { nombre: true } },
    },
  });
}

export function crearDonacion(
  datos: { campaniaId: number; monto: number; estadoDonacionId: number },
  usuarioId: number,
) {
  return prisma.donacion.create({
    data: { ...datos, usuarioId, ...datosAlta(usuarioId) },
    select: SELECCION_DONACION,
  });
}

/** Lo justo para decidir si el refugio puede revisarla. */
export function buscarDonacion(id: number) {
  return prisma.donacion.findFirst({
    where: { id, fechaBaja: null },
    select: {
      id: true,
      campaniaId: true,
      estadoDonacion: { select: { nombre: true } },
      campania: { select: { refugioId: true } },
    },
  });
}

export function buscarDonacionCompleta(id: number) {
  return prisma.donacion.findFirst({ where: { id, fechaBaja: null }, select: SELECCION_DONACION });
}

export function existeDonacion(id: number) {
  return prisma.donacion.findUnique({ where: { id }, select: { id: true } });
}

/** Bandeja del refugio, de la más reciente a la más vieja. */
export function listarDonaciones(
  campaniaId: number,
  estado: NombreEstadoDonacion | undefined,
  limite: number,
  cursor?: number,
) {
  return prisma.donacion.findMany({
    where: {
      campaniaId,
      fechaBaja: null,
      ...(estado ? { estadoDonacion: { nombre: estado } } : {}),
    },
    orderBy: [{ fechaAlta: 'desc' }, { id: 'desc' }],
    take: limite + 1,
    ...(cursor === undefined ? {} : { cursor: { id: cursor }, skip: 1 }),
    select: SELECCION_DONACION,
  });
}

/** Aplica o rechaza sólo si sigue Pendiente (carrera entre dos miembros, §8). */
export async function resolverDonacionSi(
  id: number,
  pendienteId: number,
  haciaEstadoId: number,
  motivoRechazo: string | null,
  usuarioId: number,
): Promise<boolean> {
  const { count } = await prisma.donacion.updateMany({
    where: { id, estadoDonacionId: pendienteId, fechaBaja: null },
    data: { estadoDonacionId: haciaEstadoId, motivoRechazo, ...datosModificacion(usuarioId) },
  });
  return count === 1;
}
