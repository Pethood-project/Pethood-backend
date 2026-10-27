/**
 * Preguntas propias de un refugio para el formulario de solicitud.
 *
 * Las gestiona cualquier miembro del refugio, desde la vista de refugio. Los adoptantes
 * particulares que publican una mascota propia no tienen preguntas: el formulario de sus
 * solicitudes es el común.
 */
import { AppError } from '../../middlewares/errorHandler';
import { registrarAuditoria } from '../../shared/logAuditoria';
import { LIMITES } from '../../shared/validation/limits';
import {
  normalizarOpciones,
  type ActualizarPreguntaDto,
  type CrearPreguntaDto,
  type PreguntaAplicableDto,
  type PreguntaDto,
  type ReordenarPreguntasDto,
} from './preguntas-adopcion.dto';
import * as repo from './preguntas-adopcion.repository';
import type { PreguntaConEspecie } from './preguntas-adopcion.repository';

async function exigirRefugio(usuarioId: number): Promise<number> {
  const usuario = await repo.buscarUsuarioConRefugio(usuarioId);

  if (!usuario) {
    throw new AppError('NO_ENCONTRADO', 'El usuario no existe', 404);
  }

  if (usuario.refugioId === null) {
    throw new AppError('SIN_REFUGIO', 'Tu cuenta no pertenece a un refugio', 403);
  }

  return usuario.refugioId;
}

async function exigirPregunta(id: number, refugioId: number): Promise<PreguntaConEspecie> {
  const pregunta = await repo.buscarDelRefugio(id, refugioId);

  if (!pregunta) {
    throw new AppError('NO_ENCONTRADO', 'La pregunta no existe', 404);
  }

  return pregunta;
}

async function exigirEspecie(especieId: number | null | undefined): Promise<void> {
  if (especieId === null || especieId === undefined) return;

  if (!(await repo.buscarEspecie(especieId))) {
    throw new AppError('VALIDACION', 'La especie no existe', 400);
  }
}

async function exigirCupo(refugioId: number, excluirId?: number): Promise<void> {
  const activas = await repo.contarActivas(refugioId, excluirId);
  const maximo = LIMITES.preguntaAdopcion.maximoActivas;

  if (activas >= maximo) {
    throw new AppError(
      'LIMITE_PREGUNTAS',
      `Llegaste al máximo de ${maximo} preguntas activas`,
      409,
    );
  }
}

function aDto(pregunta: PreguntaConEspecie): PreguntaDto {
  return {
    id: pregunta.id,
    texto: pregunta.texto,
    tipo: pregunta.tipo,
    opciones: pregunta.opciones,
    obligatoria: pregunta.obligatoria,
    orden: pregunta.orden,
    activa: pregunta.activa,
    especie: pregunta.especie,
  };
}

export async function listar(usuarioId: number): Promise<PreguntaDto[]> {
  const refugioId = await exigirRefugio(usuarioId);
  return (await repo.listarDelRefugio(refugioId)).map(aDto);
}

export async function crear(datos: CrearPreguntaDto, usuarioId: number): Promise<PreguntaDto> {
  const refugioId = await exigirRefugio(usuarioId);
  await exigirEspecie(datos.especieId);
  await exigirCupo(refugioId);

  const creada = await repo.crear(refugioId, datos, usuarioId);

  await registrarAuditoria({
    usuarioId,
    accion: 'CREAR',
    entidad: 'PreguntaAdopcion',
    entidadId: creada.id,
    detalle: `refugio ${refugioId}`,
  });

  return aDto(creada);
}

export async function actualizar(
  id: number,
  datos: ActualizarPreguntaDto,
  usuarioId: number,
): Promise<PreguntaDto> {
  const refugioId = await exigirRefugio(usuarioId);
  const actual = await exigirPregunta(id, refugioId);

  await exigirEspecie(datos.especieId);

  // Reactivar una pregunta cuenta contra el tope igual que crear una nueva.
  if (datos.activa === true && !actual.activa) await exigirCupo(refugioId, id);

  const tipo = datos.tipo ?? actual.tipo;
  const opciones = normalizarOpciones(
    tipo,
    datos.opciones ?? (datos.tipo === undefined ? actual.opciones : []),
  );

  if ('error' in opciones) {
    throw new AppError('VALIDACION', opciones.error, 400);
  }

  const actualizada = await repo.actualizar(
    id,
    {
      ...(datos.texto === undefined ? {} : { texto: datos.texto }),
      tipo,
      opciones: opciones.opciones,
      ...(datos.obligatoria === undefined ? {} : { obligatoria: datos.obligatoria }),
      ...(datos.especieId === undefined ? {} : { especieId: datos.especieId }),
      ...(datos.activa === undefined ? {} : { activa: datos.activa }),
    },
    usuarioId,
  );

  await registrarAuditoria({
    usuarioId,
    accion: 'EDITAR',
    entidad: 'PreguntaAdopcion',
    entidadId: id,
  });

  return aDto(actualizada);
}

/** Baja lógica: las solicitudes que ya la respondieron conservan el texto que se les preguntó. */
export async function eliminar(id: number, usuarioId: number): Promise<void> {
  const refugioId = await exigirRefugio(usuarioId);
  await exigirPregunta(id, refugioId);

  await repo.darDeBaja(id, usuarioId);

  await registrarAuditoria({
    usuarioId,
    accion: 'ELIMINAR',
    entidad: 'PreguntaAdopcion',
    entidadId: id,
  });
}

/** `ids` ordena las que nombra; las que no nombra quedan al final, como estaban. */
export async function reordenar(
  datos: ReordenarPreguntasDto,
  usuarioId: number,
): Promise<PreguntaDto[]> {
  const refugioId = await exigirRefugio(usuarioId);
  const existentes = new Set((await repo.listarDelRefugio(refugioId)).map((p) => p.id));

  if (datos.ids.some((id) => !existentes.has(id))) {
    throw new AppError('NO_ENCONTRADO', 'La pregunta no existe', 404);
  }

  await repo.reordenar(refugioId, [...new Set(datos.ids)], usuarioId);

  return (await repo.listarDelRefugio(refugioId)).map(aDto);
}

/**
 * Las preguntas que le toca responder a quien solicita una mascota de este refugio: las
 * activas que aplican a la especie de la mascota o a todas, en el orden del refugio.
 */
export async function preguntasAplicables(
  refugioId: number,
  especieId: number | null,
): Promise<PreguntaAplicableDto[]> {
  const preguntas = await repo.listarAplicables(refugioId, especieId);

  return preguntas.map((pregunta) => ({
    id: pregunta.id,
    texto: pregunta.texto,
    tipo: pregunta.tipo,
    opciones: pregunta.opciones,
    obligatoria: pregunta.obligatoria,
  }));
}
