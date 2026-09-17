import { prisma } from '../../shared/prisma';

/** Solo catálogos vigentes (baja lógica = fechaBaja no nula). */
export function listarEspecies() {
  return prisma.especie.findMany({
    where: { fechaBaja: null },
    select: { id: true, nombre: true },
    orderBy: { nombre: 'asc' },
  });
}

export function existeEspecie(especieId: number) {
  return prisma.especie.findFirst({ where: { id: especieId, fechaBaja: null } });
}

/** Razas de una especie: el listado se filtra por la especie elegida antes. */
export function listarRazasDeEspecie(especieId: number) {
  return prisma.raza.findMany({
    where: { especieId, fechaBaja: null },
    select: { id: true, nombre: true },
    orderBy: { nombre: 'asc' },
  });
}

export function listarEstadosMascota() {
  return prisma.estadoMascota.findMany({
    where: { fechaBaja: null },
    select: { id: true, nombre: true },
    orderBy: { id: 'asc' },
  });
}
