import bcrypt from 'bcrypt';
import { AppError } from '../../middlewares/errorHandler';
import type { Ambito } from '../../shared/ambito';
import { direccionDesdeCampos, geocodificarDireccion } from '../../shared/geocoding';
import { resolverCoordenadasDeMapsUrl } from '../../shared/geo';
import { persistirImagenPerfil } from '../../shared/imagenPerfil';
import { registrarAuditoria } from '../../shared/logAuditoria';
import { ESTADO_USUARIO, ROL_DB, rolesDbAApi } from '../../shared/roles';
import type { ArchivoSubida } from '../../shared/r2';
import type {
  ActualizarPerfilBody,
  CambiarPasswordBody,
  PerfilPropio,
  PreviewUbicacionBody,
  UbicacionGeocodificadaDto,
} from './usuarios.dto';
import type { UsuarioPerfil } from './usuarios.repository';
import * as repo from './usuarios.repository';

const BCRYPT_COST = 10;

function nombresDeRol(usuario: UsuarioPerfil): string[] {
  return usuario.roles
    .filter((vinculo) => vinculo.fechaBaja === null)
    .map((vinculo) => vinculo.rol.nombre);
}

function aPerfil(
  usuario: UsuarioPerfil,
  mascotas: number,
  valoracion: number | null,
): PerfilPropio {
  return {
    id: usuario.id,
    nombre: usuario.nombre,
    apellido: usuario.apellido,
    email: usuario.email,
    telefono: usuario.telefono,
    provincia: usuario.provincia,
    localidad: usuario.localidad,
    calleAltura: usuario.calleAltura,
    mapaUrl: usuario.mapaUrl,
    latitud: usuario.latitud,
    longitud: usuario.longitud,
    ubicacionVerificada: usuario.ubicacionVerificada,
    imagenUrl: usuario.imagenUrl,
    roles: rolesDbAApi(nombresDeRol(usuario)),
    refugio: usuario.refugio,
    tienePassword: Boolean(usuario.contrasena),
    mascotas,
    favoritos: usuario._count.favoritos,
    valoracion: valoracion === null ? null : Math.round(valoracion * 10) / 10,
  };
}

/** `ambito` decide qué mascotas cuenta el perfil: las personales o las del refugio. */
async function armarPerfil(usuario: UsuarioPerfil, ambito: Ambito): Promise<PerfilPropio> {
  const [mascotas, valoracion] = await Promise.all([
    repo.contarMascotasDelAmbito(usuario, ambito),
    repo.promedioValoracion(usuario.id),
  ]);
  return aPerfil(usuario, mascotas, valoracion);
}

export async function obtenerPerfil(usuarioId: number, ambito: Ambito): Promise<PerfilPropio> {
  const usuario = await repo.buscarPerfil(usuarioId);
  if (!usuario) {
    throw new AppError('NO_AUTENTICADO', 'No encontramos tu sesión.', 401);
  }
  return armarPerfil(usuario, ambito);
}

export async function actualizarPerfil(
  usuarioId: number,
  ambito: Ambito,
  body: ActualizarPerfilBody,
  archivo?: ArchivoSubida,
): Promise<PerfilPropio> {
  const actual = await repo.buscarPerfil(usuarioId);
  if (!actual) {
    throw new AppError('NO_AUTENTICADO', 'No encontramos tu sesión.', 401);
  }

  if (body.email !== actual.email) {
    const existente = await repo.buscarPorEmail(body.email);
    if (existente && existente.id !== usuarioId) {
      throw new AppError('EMAIL_DUPLICADO', 'El correo ingresado ya está en uso.', 409);
    }
  }

  // Solo se geocodifica si la dirección estructurada cambió y está completa. Así, editar el
  // nombre o corregir el link de Maps a mano no lo pisa con el resultado del geocoder.
  const cambioDireccion =
    body.provincia !== actual.provincia ||
    body.localidad !== actual.localidad ||
    body.calleAltura !== actual.calleAltura;
  const direccion = cambioDireccion ? direccionDesdeCampos(body) : null;
  const ubicacion = direccion ? await geocodificarDireccion(direccion) : null;

  if (direccion && !ubicacion) {
    throw new AppError(
      'DIRECCION_NO_GEOCODIFICADA',
      'No pudimos ubicar esa dirección. Revisá la localidad y la provincia.',
      422,
    );
  }

  const imagenUrl = archivo ? await persistirImagenPerfil(archivo) : undefined;
  const actualizado = await repo.actualizarPerfil(usuarioId, {
    ...body,
    imagenUrl,
    mapaUrl: ubicacion?.mapaUrl,
    latitud: ubicacion?.latitud,
    longitud: ubicacion?.longitud,
  });

  await registrarAuditoria({
    usuarioId,
    accion: 'EDITAR_PERFIL',
    entidad: 'Usuario',
    entidadId: usuarioId,
  });

  return armarPerfil(actualizado, ambito);
}

/**
 * Edición manual del link de Google Maps desde Mi Perfil. Parsea las coordenadas del link
 * (incluidos los cortos de `maps.app.goo.gl`) y actualiza latitud/longitud junto con la URL,
 * para que el pin quede exactamente donde el usuario lo pegó.
 */
export async function actualizarUbicacion(
  usuarioId: number,
  ambito: Ambito,
  mapaUrl: string,
): Promise<PerfilPropio> {
  const actual = await repo.buscarPerfil(usuarioId);
  if (!actual) {
    throw new AppError('NO_AUTENTICADO', 'No encontramos tu sesión.', 401);
  }

  const coordenadas = await resolverCoordenadasDeMapsUrl(mapaUrl);
  if (!coordenadas) {
    throw new AppError(
      'LINK_MAPA_INVALIDO',
      'No pudimos leer la ubicación de ese link. Pegá el link de Google Maps de tu ubicación.',
      422,
    );
  }

  const actualizado = await repo.actualizarUbicacion(usuarioId, {
    mapaUrl,
    latitud: coordenadas.latitud,
    longitud: coordenadas.longitud,
  });

  await registrarAuditoria({
    usuarioId,
    accion: 'EDITAR_UBICACION',
    entidad: 'Usuario',
    entidadId: usuarioId,
  });

  return armarPerfil(actualizado, ambito);
}

/**
 * Geocodifica la dirección estructurada sin guardar nada, para que Datos personales muestre
 * el link de Maps que se generaría y el usuario lo verifique antes de guardar.
 */
export async function previewUbicacion(
  body: PreviewUbicacionBody,
): Promise<UbicacionGeocodificadaDto> {
  const direccion = direccionDesdeCampos(body);
  const ubicacion = direccion ? await geocodificarDireccion(direccion) : null;

  if (!ubicacion) {
    throw new AppError(
      'DIRECCION_NO_GEOCODIFICADA',
      'No pudimos ubicar esa dirección. Revisá la localidad y la provincia.',
      422,
    );
  }

  return ubicacion;
}

export async function cambiarPassword(usuarioId: number, body: CambiarPasswordBody): Promise<void> {
  const usuario = await repo.buscarHashContrasena(usuarioId);
  if (!usuario) {
    throw new AppError('NO_AUTENTICADO', 'No encontramos tu sesión.', 401);
  }

  if (usuario.contrasena) {
    if (!body.passwordActual) {
      throw new AppError('VALIDACION', 'Ingresá tu contraseña actual para poder cambiarla.', 400);
    }

    const ok = await bcrypt.compare(body.passwordActual, usuario.contrasena);
    if (!ok) {
      throw new AppError('CREDENCIALES_INVALIDAS', 'La contraseña actual no es correcta.', 401);
    }
  }

  const hash = await bcrypt.hash(body.passwordNueva, BCRYPT_COST);
  await repo.actualizarContrasena(usuarioId, hash);

  await registrarAuditoria({
    usuarioId,
    accion: 'CAMBIAR_CONTRASENA',
    entidad: 'Usuario',
    entidadId: usuarioId,
  });
}

/**
 * HU-1.8. Misma baja para quien se registró con correo o con Google: el usuario queda
 * Inactivo, se cierran trámites abiertos y el perfil deja de verse. El cliente cierra
 * la sesión; el JWT no se invalida (regla 3).
 */
export async function darDeBajaCuenta(usuarioId: number): Promise<void> {
  const usuario = await repo.buscarPerfil(usuarioId);
  if (!usuario) {
    throw new AppError('NO_AUTENTICADO', 'No encontramos tu sesión.', 401);
  }

  if (nombresDeRol(usuario).includes(ROL_DB.ADMIN)) {
    throw new AppError(
      'NO_SE_PUEDE_BAJAR_ADMIN',
      'No se puede dar de baja una cuenta de administrador.',
      403,
    );
  }

  const [estadoInactivo, estadoCancelada] = await Promise.all([
    repo.buscarEstadoUsuarioPorNombre(ESTADO_USUARIO.INACTIVO),
    repo.buscarEstadoSolicitudPorNombre('Cancelada'),
  ]);

  if (!estadoInactivo || !estadoCancelada) {
    throw new AppError(
      'ERROR_INTERNO',
      'No pudimos dar de baja la cuenta. Intentalo de nuevo.',
      500,
    );
  }

  await repo.darDeBajaCuenta(usuarioId, estadoInactivo.id, estadoCancelada.id);

  await registrarAuditoria({
    usuarioId,
    accion: 'BAJA_CUENTA',
    entidad: 'Usuario',
    entidadId: usuarioId,
  });
}
