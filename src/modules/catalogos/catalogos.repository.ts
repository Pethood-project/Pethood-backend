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

/** Plan de vacunación de una especie (spec 029): vacunas activas, en orden de creación. */
export function listarVacunasDeEspecie(especieId: number) {
  return prisma.vacuna.findMany({
    where: { fechaBaja: null, especies: { some: { especieId, fechaBaja: null } } },
    select: { id: true, codigo: true, nombre: true, descripcion: true },
    orderBy: { id: 'asc' },
  });
}

export function listarEstadosPublicacion() {
  return prisma.estadoPublicacion.findMany({
    where: { fechaBaja: null },
    select: { id: true, nombre: true },
    orderBy: { id: 'asc' },
  });
}

export function listarEstadosAnimalPerdido() {
  return prisma.estadoAnimalPerdido.findMany({
    where: { fechaBaja: null },
    select: { id: true, nombre: true },
    orderBy: { id: 'asc' },
  });
}

export function listarEstadosCampania() {
  return prisma.estadoCampania.findMany({
    where: { fechaBaja: null },
    select: { id: true, nombre: true },
    orderBy: { id: 'asc' },
  });
}

export function listarEstadosMascota() {
  return prisma.estadoMascota.findMany({
    where: { fechaBaja: null },
    select: { id: true, nombre: true },
    orderBy: { id: 'asc' },
  });
}
