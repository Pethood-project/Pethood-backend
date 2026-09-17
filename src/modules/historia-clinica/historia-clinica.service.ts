import { AppError } from '../../middlewares/errorHandler';
import { registrarAuditoria } from '../../shared/logAuditoria';
import { borrarImagen, guardarImagen } from '../../shared/storage';
import { aFechaISO } from '../../shared/validation/dates';
import type {
  CrearHistoriaClinicaDto,
  EditarHistoriaClinicaDto,
  HistoriaClinicaDto,
} from './historia-clinica.dto';
import * as repo from './historia-clinica.repository';

const SUBCARPETA_DOCUMENTOS = 'historias-clinicas';

export interface Contexto {
  usuarioId: number;
  archivo?: { buffer: Buffer; mimetype: string };
}

type Registro = Awaited<ReturnType<typeof repo.crear>>;

function aDto(registro: Registro): HistoriaClinicaDto {
  return {
    id: registro.id,
    fechaVisita: aFechaISO(registro.fechaVisita),
    fechaProxima: registro.fechaProxima ? aFechaISO(registro.fechaProxima) : null,
    requiereRevision: registro.requiereRevision,
    vacunacion: registro.vacunacion,
    titulo: registro.titulo,
    descripcion: registro.descripcion,
    documentoUrl: registro.documentoUrl,
    mascotaId: registro.mascotaId,
    usuarioAlta: registro.usuarioAlta,
    fechaAlta: registro.fechaAlta.toISOString(),
  };
}

type Mascota = NonNullable<Awaited<ReturnType<typeof repo.buscarMascota>>>;
type Usuario = NonNullable<Awaited<ReturnType<typeof repo.buscarUsuario>>>;

/** Asociación mínima para leer o dar de alta (HU-8.1/HU-8.2): dueño directo o refugio dueño. */
function tieneAcceso(mascota: Mascota, usuario: Usuario): boolean {
  if (mascota.usuarioId === usuario.id) return true;
  return usuario.refugioId !== null && usuario.refugioId === mascota.refugioId;
}

/**
 * Permiso de edición y baja (HU-8.3 modificar / HU-8.4 eliminar, misma regla en ambas): un
 * integrante del refugio dueño puede gestionar cualquier registro de esa mascota; un
 * adoptante solo el que él mismo cargó.
 */
function puedeGestionar(
  mascota: Mascota,
  usuario: Usuario,
  registro: { usuarioAlta: number },
): boolean {
  if (usuario.refugioId !== null && usuario.refugioId === mascota.refugioId) return true;
  return mascota.usuarioId === usuario.id && registro.usuarioAlta === usuario.id;
}

async function exigirMascotaYUsuario(mascotaId: number, usuarioId: number) {
  const [mascota, usuario] = await Promise.all([
    repo.buscarMascota(mascotaId),
    repo.buscarUsuario(usuarioId),
  ]);

  if (!mascota) throw new AppError('NO_ENCONTRADO', 'La mascota no existe', 404);
  if (!usuario) throw new AppError('NO_ENCONTRADO', 'El usuario no existe', 404);

  return { mascota, usuario };
}

async function exigirAcceso(mascotaId: number, usuarioId: number) {
  const { mascota, usuario } = await exigirMascotaYUsuario(mascotaId, usuarioId);

  if (!tieneAcceso(mascota, usuario)) {
    throw new AppError('NO_AUTORIZADO', 'Esa mascota no está asociada a tu cuenta', 403);
  }

  return { mascota, usuario };
}

export async function crearHistoriaClinica(
  mascotaId: number,
  datos: CrearHistoriaClinicaDto,
  contexto: Contexto,
): Promise<HistoriaClinicaDto> {
  await exigirAcceso(mascotaId, contexto.usuarioId);

  const documentoUrl = contexto.archivo
    ? await guardarImagen(contexto.archivo, SUBCARPETA_DOCUMENTOS)
    : null;

  let registro: Registro;
  try {
    registro = await repo.crear(
      {
        fechaVisita: datos.fechaVisita,
        fechaProxima: datos.fechaProxima,
        requiereRevision: datos.requiereRevision,
        vacunacion: datos.vacunacion,
        titulo: datos.titulo,
        descripcion: datos.descripcion,
        documentoUrl,
        mascotaId,
      },
      contexto.usuarioId,
    );
  } catch (err) {
    if (documentoUrl) await borrarImagen(documentoUrl);
    throw err;
  }

  await registrarAuditoria({
    usuarioId: contexto.usuarioId,
    accion: 'CREAR',
    entidad: 'HistoriaClinica',
    entidadId: registro.id,
    detalle: `mascota=${mascotaId}`,
  });

  return aDto(registro);
}

export async function listarHistorial(
  mascotaId: number,
  usuarioId: number,
): Promise<HistoriaClinicaDto[]> {
  await exigirAcceso(mascotaId, usuarioId);

  const registros = await repo.listarPorMascota(mascotaId);
  return registros.map(aDto);
}

async function buscarRegistroConMascota(historiaClinicaId: number) {
  const registro = await repo.buscarPorId(historiaClinicaId);
  if (!registro) {
    throw new AppError('NO_ENCONTRADO', 'La historia clínica no existe', 404);
  }

  const mascota = await repo.buscarMascota(registro.mascotaId);
  if (!mascota) {
    throw new AppError('NO_ENCONTRADO', 'La mascota no existe', 404);
  }

  return { registro, mascota };
}

export async function obtenerHistoriaClinica(
  historiaClinicaId: number,
  usuarioId: number,
): Promise<HistoriaClinicaDto> {
  const { registro, mascota } = await buscarRegistroConMascota(historiaClinicaId);
  const usuario = await repo.buscarUsuario(usuarioId);

  if (!usuario) throw new AppError('NO_ENCONTRADO', 'El usuario no existe', 404);
  if (!tieneAcceso(mascota, usuario)) {
    throw new AppError('NO_AUTORIZADO', 'Esa mascota no está asociada a tu cuenta', 403);
  }

  return aDto(registro);
}

/**
 * "Modificar" (HU-8.3): nunca actualiza el registro persistido. Da de baja el anterior y
 * crea uno nuevo con los campos fusionados — lo que no vino en el PATCH conserva el valor
 * vigente. `vacunacion` no es editable y siempre se arrastra del registro anterior.
 */
export async function editarHistoriaClinica(
  historiaClinicaId: number,
  datos: EditarHistoriaClinicaDto,
  contexto: Contexto,
): Promise<HistoriaClinicaDto> {
  const { registro, mascota } = await buscarRegistroConMascota(historiaClinicaId);
  const usuario = await repo.buscarUsuario(contexto.usuarioId);

  if (!usuario) throw new AppError('NO_ENCONTRADO', 'El usuario no existe', 404);
  if (!puedeGestionar(mascota, usuario, registro)) {
    throw new AppError('NO_AUTORIZADO', 'No tenés permisos para editar este registro', 403);
  }

  const documentoNuevo = contexto.archivo
    ? await guardarImagen(contexto.archivo, SUBCARPETA_DOCUMENTOS)
    : undefined;

  let actualizado: Registro;
  try {
    actualizado = await repo.reemplazar(
      historiaClinicaId,
      {
        fechaVisita: datos.fechaVisita ?? registro.fechaVisita,
        fechaProxima: datos.fechaProxima !== undefined ? datos.fechaProxima : registro.fechaProxima,
        requiereRevision: datos.requiereRevision ?? registro.requiereRevision,
        vacunacion: registro.vacunacion,
        titulo: datos.titulo ?? registro.titulo,
        descripcion: datos.descripcion ?? registro.descripcion,
        documentoUrl: documentoNuevo ?? registro.documentoUrl,
        mascotaId: registro.mascotaId,
      },
      contexto.usuarioId,
    );
  } catch (err) {
    if (documentoNuevo) await borrarImagen(documentoNuevo);
    throw err;
  }

  // Recién con la base escrita se limpia el documento viejo (HU-8.3: "si ya tenía un
  // archivo lo quita para guardar el nuevo").
  if (documentoNuevo && registro.documentoUrl) {
    await borrarImagen(registro.documentoUrl);
  }

  await registrarAuditoria({
    usuarioId: contexto.usuarioId,
    accion: 'MODIFICAR',
    entidad: 'HistoriaClinica',
    entidadId: actualizado.id,
    detalle: `reemplaza=${historiaClinicaId}`,
  });

  return aDto(actualizado);
}

/**
 * HU-8.4: baja lógica simple, sin baja+alta — el registro se elimina, no se "corrige".
 * Mismo permiso que HU-8.3: dueño (adoptante) que lo cargó, o cualquier integrante del
 * refugio dueño de la mascota.
 */
export async function eliminarHistoriaClinica(
  historiaClinicaId: number,
  usuarioId: number,
): Promise<{ id: number }> {
  const { registro, mascota } = await buscarRegistroConMascota(historiaClinicaId);
  const usuario = await repo.buscarUsuario(usuarioId);

  if (!usuario) throw new AppError('NO_ENCONTRADO', 'El usuario no existe', 404);
  if (!puedeGestionar(mascota, usuario, registro)) {
    throw new AppError('NO_AUTORIZADO', 'No tiene permisos para eliminar este registro', 403);
  }

  await repo.darDeBaja(historiaClinicaId, usuarioId);

  await registrarAuditoria({
    usuarioId,
    accion: 'ELIMINAR',
    entidad: 'HistoriaClinica',
    entidadId: historiaClinicaId,
  });

  return { id: historiaClinicaId };
}
