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

export { ESTADOS_SELECCIONABLES_EN_ALTA, ESTADOS_QUE_HABILITAN_PUBLICACION };
