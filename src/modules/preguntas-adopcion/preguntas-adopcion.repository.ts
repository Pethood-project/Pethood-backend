import type { TipoPreguntaAdopcion } from '@prisma/client';
import { datosAlta, datosBaja, datosModificacion } from '../../shared/auditoria';
import { prisma } from '../../shared/prisma';

const CON_ESPECIE = { especie: { select: { id: true, nombre: true } } } as const;

const POR_ORDEN = [{ orden: 'asc' as const }, { id: 'asc' as const }];

export type PreguntaConEspecie = NonNullable<Awaited<ReturnType<typeof buscarDelRefugio>>>;

export function buscarUsuarioConRefugio(usuarioId: number) {
  return prisma.usuario.findFirst({
    where: { id: usuarioId, fechaBaja: null },
    select: { id: true, refugioId: true },
  });
}

export function buscarEspecie(especieId: number) {
  return prisma.especie.findFirst({ where: { id: especieId, fechaBaja: null } });
}

export function listarDelRefugio(refugioId: number) {
  return prisma.preguntaAdopcion.findMany({
    where: { refugioId, fechaBaja: null },
    include: CON_ESPECIE,
    orderBy: POR_ORDEN,
  });
}

export function buscarDelRefugio(id: number, refugioId: number) {
  return prisma.preguntaAdopcion.findFirst({
    where: { id, refugioId, fechaBaja: null },
    include: CON_ESPECIE,
  });
}

/**
 * Las que ve quien completa el formulario: activas y de la especie de la mascota, o sin
 * especie (aplican a todas).
 */
export function listarAplicables(refugioId: number, especieId: number | null) {
  return prisma.preguntaAdopcion.findMany({
    where: {
      refugioId,
      activa: true,
      fechaBaja: null,
      OR: [{ especieId: null }, ...(especieId === null ? [] : [{ especieId }])],
    },
    orderBy: POR_ORDEN,
  });
}

export function contarActivas(refugioId: number, excluirId?: number): Promise<number> {
  return prisma.preguntaAdopcion.count({
    where: {
      refugioId,
      activa: true,
      fechaBaja: null,
      ...(excluirId === undefined ? {} : { id: { not: excluirId } }),
    },
  });
}

export interface DatosPregunta {
  texto: string;
  tipo: TipoPreguntaAdopcion;
  opciones: string[];
  obligatoria: boolean;
  especieId: number | null;
  activa?: boolean;
}

/** La pregunta nueva va al final: su orden es el siguiente al más alto del refugio. */
export async function crear(refugioId: number, datos: DatosPregunta, usuarioId: number) {
  const ultima = await prisma.preguntaAdopcion.aggregate({
    where: { refugioId, fechaBaja: null },
    _max: { orden: true },
  });

  return prisma.preguntaAdopcion.create({
    data: {
      ...datos,
      refugioId,
      orden: (ultima._max.orden ?? -1) + 1,
      ...datosAlta(usuarioId),
    },
    include: CON_ESPECIE,
  });
}

export function actualizar(id: number, datos: Partial<DatosPregunta>, usuarioId: number) {
  return prisma.preguntaAdopcion.update({
    where: { id },
    data: { ...datos, ...datosModificacion(usuarioId) },
    include: CON_ESPECIE,
  });
}

export function darDeBaja(id: number, usuarioId: number) {
  return prisma.preguntaAdopcion.update({
    where: { id },
    data: { activa: false, ...datosBaja(usuarioId) },
  });
}

/** Asigna `orden` según la posición en `ids`; las demás del refugio quedan al final. */
export function reordenar(refugioId: number, ids: number[], usuarioId: number) {
  return prisma.$transaction(async (tx) => {
    for (const [posicion, id] of ids.entries()) {
      await tx.preguntaAdopcion.updateMany({
        where: { id, refugioId, fechaBaja: null },
        data: { orden: posicion, ...datosModificacion(usuarioId) },
      });
    }

    const restantes = await tx.preguntaAdopcion.findMany({
      where: { refugioId, fechaBaja: null, id: { notIn: ids } },
      orderBy: POR_ORDEN,
      select: { id: true },
    });

    for (const [desplazamiento, { id }] of restantes.entries()) {
      await tx.preguntaAdopcion.update({
        where: { id },
        data: { orden: ids.length + desplazamiento },
      });
    }
  });
}
