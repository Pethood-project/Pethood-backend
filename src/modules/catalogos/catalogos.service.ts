import { AppError } from '../../middlewares/errorHandler';
import { vacunasDeEspecie } from '../../shared/vacunas';
import * as repo from './catalogos.repository';

/**
 * Estados con los que una mascota puede nacer. "Adoptado" y "Fallecido" existen en el
 * catálogo pero no son un alta válida: se llega a ellos por transición posterior.
 * La regla vive acá porque los frontends no deciden reglas de negocio.
 */
const ESTADOS_SELECCIONABLES_EN_ALTA = ['Disponible', 'En_Tratamiento', 'En_Transito'];

/** Estados con los que se puede ofrecer la mascota en adopción. */
const ESTADOS_QUE_HABILITAN_PUBLICACION = ['Disponible', 'En_Transito'];

/**
 * Estados con los que nace un aviso de animal perdido (spec 020). "Resuelto" existe en el
 * catálogo pero es el cierre del caso (HU-13.2), nunca un alta.
 */
const ESTADOS_ANIMAL_PERDIDO_EN_ALTA = ['Perdido', 'Encontrado'];

/**
 * El cierre del caso (HU-13.2, spec 024): el aviso queda marcado "Volvió con su dueño" y sus
 * salas de reencuentro pasan a sólo lectura.
 *
 * Es el nombre del catálogo `Estado_Animal_Perdido` y vive acá —y no en cada módulo— porque
 * lo miran tres: el alta (para rechazarlo), el reclamo (para no abrir sala de un caso
 * cerrado) y el chat (para cerrar la sala).
 */
const ESTADO_ANIMAL_PERDIDO_RESUELTO = 'Resuelto';

export function listarEspecies() {
  return repo.listarEspecies();
}

export async function listarRazasDeEspecie(especieId: number) {
  if (!(await repo.existeEspecie(especieId))) {
    throw new AppError('NO_ENCONTRADO', 'La especie no existe', 404);
  }

  return repo.listarRazasDeEspecie(especieId);
}

/**
 * Vacunas del plan de la especie (spec 019), en el orden del calendario: alimentan el
 * selector del alta de mascota y el de historia clínica. Vacío si la especie no tiene plan.
 */
export async function listarVacunasDeEspecie(especieId: number) {
  const especie = await repo.existeEspecie(especieId);

  if (!especie) {
    throw new AppError('NO_ENCONTRADO', 'La especie no existe', 404);
  }

  return vacunasDeEspecie(especie.nombre).map(({ tipo, nombre, descripcion }) => ({
    tipo,
    nombre,
    descripcion,
  }));
}

/** Estados del aviso (Activa, Pausada, Finalizada), para el filtro de "Mis publicaciones". */
export function listarEstadosPublicacion() {
  return repo.listarEstadosPublicacion();
}

export async function listarEstadosMascota() {
  const estados = await repo.listarEstadosMascota();

  return estados.map((estado) => ({
    ...estado,
    seleccionableEnAlta: ESTADOS_SELECCIONABLES_EN_ALTA.includes(estado.nombre),
    habilitaPublicacion: ESTADOS_QUE_HABILITAN_PUBLICACION.includes(estado.nombre),
  }));
}

/**
 * Estados del aviso de animal perdido: alimentan el filtro del portal (todos) y el selector del
 * alta (sólo los que tienen `seleccionableEnAlta`).
 */
/** Filtro por estado de «Mis Campañas» (spec 026). */
export function listarEstadosCampania() {
  return repo.listarEstadosCampania();
}

export async function listarEstadosAnimalPerdido() {
  const estados = await repo.listarEstadosAnimalPerdido();

  return estados.map((estado) => ({
    ...estado,
    seleccionableEnAlta: ESTADOS_ANIMAL_PERDIDO_EN_ALTA.includes(estado.nombre),
  }));
}

export {
  ESTADOS_SELECCIONABLES_EN_ALTA,
  ESTADOS_QUE_HABILITAN_PUBLICACION,
  ESTADOS_ANIMAL_PERDIDO_EN_ALTA,
  ESTADO_ANIMAL_PERDIDO_RESUELTO,
};
