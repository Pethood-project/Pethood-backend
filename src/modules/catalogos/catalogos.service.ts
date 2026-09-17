import { AppError } from '../../middlewares/errorHandler';
import * as repo from './catalogos.repository';

/**
 * Estados con los que una mascota puede nacer. "Adoptado" y "Fallecido" existen en el
 * catálogo pero no son un alta válida: se llega a ellos por transición posterior.
 * La regla vive acá porque los frontends no deciden reglas de negocio.
 */
const ESTADOS_SELECCIONABLES_EN_ALTA = ['Disponible', 'En_Tratamiento', 'En_Transito'];

/** Estados con los que se puede ofrecer la mascota en adopción. */
const ESTADOS_QUE_HABILITAN_PUBLICACION = ['Disponible', 'En_Transito'];

export function listarEspecies() {
  return repo.listarEspecies();
}

export async function listarRazasDeEspecie(especieId: number) {
  if (!(await repo.existeEspecie(especieId))) {
    throw new AppError('NO_ENCONTRADO', 'La especie no existe', 404);
  }

  return repo.listarRazasDeEspecie(especieId);
}

export async function listarEstadosMascota() {
  const estados = await repo.listarEstadosMascota();

  return estados.map((estado) => ({
    ...estado,
    seleccionableEnAlta: ESTADOS_SELECCIONABLES_EN_ALTA.includes(estado.nombre),
    habilitaPublicacion: ESTADOS_QUE_HABILITAN_PUBLICACION.includes(estado.nombre),
  }));
}

export { ESTADOS_SELECCIONABLES_EN_ALTA, ESTADOS_QUE_HABILITAN_PUBLICACION };
