import { AppError } from '../../middlewares/errorHandler';
import { registrarAuditoria } from '../../shared/logAuditoria';
import { borrarImagen, guardarImagen } from '../../shared/storage';
import { aFechaISO } from '../../shared/validation/dates';
import {
  ESTADOS_QUE_HABILITAN_PUBLICACION,
  ESTADOS_SELECCIONABLES_EN_ALTA,
} from '../catalogos/catalogos.service';
import type {
  AmbitoMascotas,
  CrearMascotaDto,
  EditarMascotaDto,
  MascotaCreadaDto,
} from './mascotas.dto';
import * as repo from './mascotas.repository';

const SUBCARPETA_FOTOS = 'mascotas';

/** Trámites de adopción abiertos de otro usuario: frenan la baja de la mascota. */
const ESTADOS_SOLICITUD_ABIERTA = ['Pendiente', 'En_Revision'];

/** El adoptante no elige estado: se deriva de si la mascota es propia o para adopción. */
const ESTADO_POR_DESTINO = {
  ADOPCION: 'Disponible',
  PROPIA: 'Adoptado', // ya tiene dueño, no se ofrece publicarla
} as const;

export interface ContextoCreacion {
  usuarioId: number;
  archivo?: { buffer: Buffer; mimetype: string };
}

export type ContextoEdicion = ContextoCreacion;

export interface ResultadoEliminacion {
  id: number;
  publicacionesDadasDeBaja: number;
}

type MascotaConRelaciones = Awaited<ReturnType<typeof repo.crearConEstado>>;

function aDto(mascota: MascotaConRelaciones): MascotaCreadaDto {
  const estado = mascota.historicoEstados[0]!.estadoMascota;

  return {
    id: mascota.id,
    nombre: mascota.nombre,
    fechaNacimiento: mascota.fechaNacimiento ? aFechaISO(mascota.fechaNacimiento) : null,
    genero: mascota.genero,
    peso: mascota.peso === null ? null : Number(mascota.peso),
    tamanio: mascota.tamanio,
    castrado: mascota.castrado,
    descripcion: mascota.descripcion,
    imagenUrl: mascota.imagenUrl,
    especie: { id: mascota.raza.especie.id, nombre: mascota.raza.especie.nombre },
    raza: { id: mascota.raza.id, nombre: mascota.raza.nombre },
    estado: { id: estado.id, nombre: estado.nombre },
    refugioId: mascota.refugioId,
    usuarioId: mascota.usuarioId,
    habilitaPublicacion: ESTADOS_QUE_HABILITAN_PUBLICACION.includes(estado.nombre),
  };
}

/** Solo un usuario con DNI y teléfono ya verificados puede dar de alta una mascota. */
async function exigirUsuarioVerificado(usuarioId: number) {
  const usuario = await repo.buscarUsuario(usuarioId);

  if (!usuario) {
    throw new AppError('NO_ENCONTRADO', 'El usuario no existe', 404);
  }
  if (!usuario.verificado) {
    throw new AppError(
      'USUARIO_NO_VERIFICADO',
      'Necesitás verificar tu cuenta para poder crear una mascota',
      403,
    );
  }

  return usuario;
}

/**
 * Propiedad = ser quien creó el registro (precondición de HU-6.2 y HU-6.3). Se resuelve
 * siempre en el backend: esconder el botón en la UI no alcanza. Un compañero del mismo
 * refugio tampoco pasa, igual que en publicaciones.service.ts.
 */
async function exigirMascotaPropia(mascotaId: number, usuarioId: number) {
  const mascota = await repo.buscarPorId(mascotaId);

  if (!mascota) {
    throw new AppError('NO_ENCONTRADO', 'La mascota no existe', 404);
  }
  if (mascota.usuarioId !== usuarioId) {
    throw new AppError('NO_AUTORIZADO', 'Esa mascota no es tuya', 403);
  }

  return mascota;
}

/** La raza depende de la especie: se rechaza una combinación que no exista. */
async function resolverRaza(razaId: number, especieId: number) {
  const raza = await repo.buscarRaza(razaId);

  if (!raza) {
    throw new AppError('NO_ENCONTRADO', 'La raza no existe', 404);
  }
  if (raza.especieId !== especieId) {
    throw new AppError('VALIDACION', 'La raza no corresponde a la especie elegida', 400);
  }

  return raza;
}

async function resolverEstadoInicial(datos: CrearMascotaDto): Promise<number> {
  if (datos.actor === 'ADOPTANTE') {
    const nombre = ESTADO_POR_DESTINO[datos.destino];
    const estado = await repo.buscarEstadoMascotaPorNombre(nombre);

    if (!estado) {
      throw new AppError('ERROR_INTERNO', `Falta el estado "${nombre}" en el catálogo`, 500);
    }

    return estado.id;
  }

  // El refugio sí elige, pero solo entre los estados válidos como punto de partida.
  const estado = await repo.buscarEstadoMascota(datos.estadoMascotaId);

  if (!estado) {
    throw new AppError('NO_ENCONTRADO', 'El estado no existe', 404);
  }
  if (!ESTADOS_SELECCIONABLES_EN_ALTA.includes(estado.nombre)) {
    throw new AppError('VALIDACION', 'Ese estado no es válido al crear una mascota', 400);
  }

  return estado.id;
}

export async function crearMascota(
  datos: CrearMascotaDto,
  contexto: ContextoCreacion,
): Promise<MascotaCreadaDto> {
  // La foto es obligatoria y bloquea el guardado.
  if (!contexto.archivo) {
    throw new AppError('FOTO_REQUERIDA', 'Debe agregar al menos una foto de la mascota', 400);
  }

  const usuario = await exigirUsuarioVerificado(contexto.usuarioId);
  const raza = await resolverRaza(datos.razaId, datos.especieId);
  const estadoMascotaId = await resolverEstadoInicial(datos);

  if (datos.actor === 'REFUGIO' && !usuario.refugioId) {
    throw new AppError('SIN_REFUGIO', 'Tu usuario no está asociado a ningún refugio', 403);
  }

  const imagenUrl = await guardarImagen(contexto.archivo, SUBCARPETA_FOTOS);

  let mascota: MascotaConRelaciones;
  try {
    // La mascota queda asociada automáticamente a quien la crea.
    mascota = await repo.crearConEstado(
      {
        nombre: datos.nombre,
        fechaNacimiento: datos.fechaNacimiento,
        genero: datos.genero,
        peso: datos.peso,
        tamanio: datos.tamanio,
        castrado: datos.castrado,
        descripcion: datos.descripcion,
        imagenUrl,
        razaId: raza.id,
        refugioId: datos.actor === 'REFUGIO' ? usuario.refugioId : null,
        usuarioId: usuario.id,
        estadoMascotaId,
      },
      usuario.id,
    );
  } catch (err) {
    // No dejar la foto huérfana si la escritura en base falló.
    await borrarImagen(imagenUrl);
    throw err;
  }

  await registrarAuditoria({
    usuarioId: usuario.id,
    accion: 'CREAR',
    entidad: 'Mascota',
    entidadId: mascota.id,
    detalle: `actor=${datos.actor}`,
  });

  return aDto(mascota);
}

/**
 * Edición parcial (HU-6.2): solo se escriben los campos que llegaron. Prisma ignora los
 * `undefined`, así que un campo ausente no toca la columna; `descripcion: null` sí la
 * limpia. El estado no se edita acá — ver el comentario de `editarMascotaSchema`.
 */
export async function editarMascota(
  mascotaId: number,
  datos: EditarMascotaDto,
  contexto: ContextoEdicion,
): Promise<MascotaCreadaDto> {
  const mascota = await exigirMascotaPropia(mascotaId, contexto.usuarioId);

  const camposCambiados = Object.entries(datos)
    .filter(([, valor]) => valor !== undefined)
    .map(([campo]) => campo);

  if (contexto.archivo) camposCambiados.push('foto');

  if (camposCambiados.length === 0) {
    throw new AppError('VALIDACION', 'No enviaste ningún cambio', 400);
  }

  // Cambiar de raza obliga a revalidarla contra su especie, igual que en el alta.
  if (datos.razaId !== undefined && datos.especieId !== undefined) {
    await resolverRaza(datos.razaId, datos.especieId);
  }

  const imagenAnterior = mascota.imagenUrl;
  const imagenNueva = contexto.archivo
    ? await guardarImagen(contexto.archivo, SUBCARPETA_FOTOS)
    : undefined;

  let actualizada;
  try {
    actualizada = await repo.actualizar(
      mascotaId,
      {
        nombre: datos.nombre,
        fechaNacimiento: datos.fechaNacimiento,
        genero: datos.genero,
        peso: datos.peso,
        tamanio: datos.tamanio,
        castrado: datos.castrado,
        descripcion: datos.descripcion,
        razaId: datos.razaId,
        imagenUrl: imagenNueva,
      },
      contexto.usuarioId,
    );
  } catch (err) {
    // No dejar la foto nueva huérfana si la escritura en base falló.
    if (imagenNueva) await borrarImagen(imagenNueva);
    throw err;
  }

  // Recién con la base escrita se limpia la foto vieja, y solo si nadie más la apunta:
  // una publicación puede estar reusando ese mismo string.
  if (
    imagenNueva &&
    imagenAnterior &&
    !(await repo.existePublicacionQueUsaImagen(imagenAnterior))
  ) {
    await borrarImagen(imagenAnterior);
  }

  if (actualizada.historicoEstados.length === 0) {
    throw new AppError('ERROR_INTERNO', 'La mascota no tiene un estado vigente', 500);
  }

  await registrarAuditoria({
    usuarioId: contexto.usuarioId,
    accion: 'EDITAR',
    entidad: 'Mascota',
    entidadId: mascotaId,
    detalle: `campos=${camposCambiados.join(',')}`,
  });

  return aDto(actualizada);
}

/**
 * Baja lógica (HU-6.3, REQUISITOS.md §6). Arrastra las publicaciones activas de la mascota
 * porque la HU pide retirar "su información y publicación", pero se frena si hay
 * solicitudes de adopción sin responder: cancelarle el trámite a otro usuario en silencio
 * sería peor que pedirle al dueño que las resuelva primero.
 */
export async function eliminarMascota(
  mascotaId: number,
  usuarioId: number,
): Promise<ResultadoEliminacion> {
  await exigirMascotaPropia(mascotaId, usuarioId);

  const solicitudes = await repo.listarSolicitudesDeMascota(mascotaId);
  const hayAbiertas = solicitudes.some((solicitud) => {
    const estado = solicitud.historicoEstados[0]?.estadoSolicitud;
    return estado !== undefined && ESTADOS_SOLICITUD_ABIERTA.includes(estado.nombre);
  });

  if (hayAbiertas) {
    throw new AppError(
      'SOLICITUDES_ABIERTAS',
      'Esa mascota tiene solicitudes de adopción sin responder. Resolvelas antes de eliminarla',
      409,
    );
  }

  const publicacionesDadasDeBaja = await repo.darDeBajaConPublicaciones(mascotaId, usuarioId);

  await registrarAuditoria({
    usuarioId,
    accion: 'ELIMINAR',
    entidad: 'Mascota',
    entidadId: mascotaId,
    detalle: `publicaciones=${publicacionesDadasDeBaja}`,
  });

  return { id: mascotaId, publicacionesDadasDeBaja };
}

/**
 * Listado de mascotas del ámbito pedido.
 *
 * Un miembro de refugio tiene dos conjuntos separados: las mascotas que cargó como
 * persona y las del refugio. El cliente elige cuál quiere con `ambito`; sin ese dato se
 * devuelven las personales, que es lo que ve un adoptante común.
 *
 * Pedir el ámbito del refugio sin pertenecer a uno es un error y no una lista vacía: la
 * app no debería llegar a preguntarlo, y devolver vacío escondería el bug.
 */
export async function listarMisMascotas(
  usuarioId: number,
  ambito: AmbitoMascotas = 'PERSONAL',
): Promise<MascotaCreadaDto[]> {
  let filtro: { usuarioId: number } | { refugioId: number } = { usuarioId };

  if (ambito === 'REFUGIO') {
    const usuario = await repo.buscarUsuario(usuarioId);

    if (!usuario) {
      throw new AppError('NO_ENCONTRADO', 'El usuario no existe', 404);
    }
    if (!usuario.refugioId) {
      throw new AppError('SIN_REFUGIO', 'Tu usuario no está asociado a ningún refugio', 403);
    }

    filtro = { refugioId: usuario.refugioId };
  }

  const mascotas = await repo.listarPorAmbito(filtro);

  return mascotas
    .filter((mascota) => mascota.historicoEstados.length > 0)
    .map((mascota) => aDto(mascota as MascotaConRelaciones));
}
