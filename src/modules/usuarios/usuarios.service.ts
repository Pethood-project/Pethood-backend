import { Prisma } from '@prisma/client';
import bcrypt from 'bcrypt';
import { env } from '../../config/env';
import { AppError } from '../../middlewares/errorHandler';
import type { Ambito } from '../../shared/ambito';
import { direccionDesdeCampos, geocodificarDireccion } from '../../shared/geocoding';
import { resolverCoordenadasDeMapsUrl } from '../../shared/geo';
import { persistirImagenPerfil } from '../../shared/imagenPerfil';
import { registrarAuditoria } from '../../shared/logAuditoria';
import { estaBloqueado, registrarFallo } from '../../shared/rateLimit';
import { ESTADO_USUARIO, ROL_DB, rolesDbAApi } from '../../shared/roles';
import { borrarImagenes, guardarImagen } from '../../shared/storage';
import { firmarUrlArchivo } from '../../shared/urlFirmada';
import type { ArchivoSubida } from '../../shared/r2';
import * as notificaciones from '../notificaciones/notificaciones.service';
import type {
  PerfilPublicoUsuarioDto,
  ActualizarPerfilBody,
  CambiarPasswordBody,
  PerfilPropio,
  PreviewUbicacionBody,
  UbicacionGeocodificadaDto,
} from './usuarios.dto';
import { aRefugioDeSesion } from '../../shared/refugioSesion';
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
    dni: usuario.dni,
    provincia: usuario.provincia,
    localidad: usuario.localidad,
    calleAltura: usuario.calleAltura,
    mapaUrl: usuario.mapaUrl,
    latitud: usuario.latitud,
    longitud: usuario.longitud,
    ubicacionVerificada: usuario.ubicacionVerificada,
    imagenUrl: usuario.imagenUrl,
    verificado: usuario.verificado,
    documentos: {
      dniImagenUrl: firmarUrlArchivo(usuario.dniImagenUrl),
      selfieUrl: firmarUrlArchivo(usuario.selfieUrl),
    },
    roles: rolesDbAApi(nombresDeRol(usuario)),
    refugio: aRefugioDeSesion(usuario.refugio),
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

const SUBCARPETA_DOCUMENTOS = 'documentos-identidad';

export interface ArchivosDocumentos {
  dni_imagen?: ArchivoSubida[];
  selfie?: ArchivoSubida[];
}

/**
 * Sube o reemplaza el DNI y/o la selfie (spec 002.1). No cambia `verificado` ni el estado:
 * solo deja la evidencia lista para que un admin decida con `PATCH /admin/usuarios/:id/verificar`.
 */
export async function subirDocumentos(usuarioId: number, archivos: ArchivosDocumentos) {
  const dni = archivos.dni_imagen?.[0];
  const selfie = archivos.selfie?.[0];
  if (!dni && !selfie) {
    throw new AppError('VALIDACION', 'Subí la foto del DNI y/o la selfie.', 400);
  }

  // Tope de subidas por usuario (5 cada 15 min, el mismo contador en memoria que el login):
  // cada request son hasta 2 x 5 MB y los reemplazos dejan archivos huérfanos (deuda #41).
  const claveLimite = `documentos:${usuarioId}`;
  if (estaBloqueado(claveLimite)) {
    throw new AppError(
      'DEMASIADOS_INTENTOS',
      'Subiste documentación muchas veces seguidas. Probá de nuevo en unos minutos.',
      429,
    );
  }
  registrarFallo(claveLimite);

  const actual = await repo.buscarPerfil(usuarioId);
  if (!actual) throw new AppError('NO_AUTENTICADO', 'No encontramos tu sesión.', 401);

  // Un usuario verificado no reemplaza sus documentos: la aprobación del admin quedaría
  // apuntando a archivos distintos de los que revisó. Cambiarlos pasa por un admin.
  if (actual.verificado) {
    throw new AppError(
      'USUARIO_YA_VERIFICADO',
      'Tu identidad ya está verificada. Si necesitás cambiar tus documentos, escribinos a soporte.',
      409,
    );
  }

  const estadosPermitidos: string[] = [ESTADO_USUARIO.PENDIENTE, ESTADO_USUARIO.ACTIVO];
  const sinPermiso = new AppError(
    'CUENTA_NO_ACTIVA',
    'Tu cuenta no puede subir documentación.',
    403,
  );
  if (!estadosPermitidos.includes(actual.estado.nombre)) throw sinPermiso;

  const [dniImagenUrl, selfieUrl] = await Promise.all([
    dni ? guardarImagen(dni, SUBCARPETA_DOCUMENTOS) : undefined,
    selfie ? guardarImagen(selfie, SUBCARPETA_DOCUMENTOS) : undefined,
  ]);
  const actualizado = await repo.actualizarDocumentos(
    usuarioId,
    { dniImagenUrl, selfieUrl },
    estadosPermitidos,
  );
  // La cuenta dejó de calificar entre el chequeo y la escritura: no queda nada referenciado.
  if (!actualizado) {
    await borrarImagenes([dniImagenUrl, selfieUrl].filter((u): u is string => Boolean(u)));
    throw sinPermiso;
  }

  await registrarAuditoria({
    usuarioId,
    accion: 'SUBIR_DOCUMENTOS',
    entidad: 'Usuario',
    entidadId: usuarioId,
    // Las rutas reemplazadas quedan acá: el archivo viejo sigue en storage (no se borra) y
    // sin esto no habría forma de volver a encontrarlo.
    detalle: [
      dni ? `dni=${dniImagenUrl} (antes=${actual.dniImagenUrl ?? '-'})` : null,
      selfie ? `selfie=${selfieUrl} (antes=${actual.selfieUrl ?? '-'})` : null,
    ]
      .filter(Boolean)
      .join(' '),
  });

  return {
    dniImagenUrl: firmarUrlArchivo(actualizado.dniImagenUrl),
    selfieUrl: firmarUrlArchivo(actualizado.selfieUrl),
  };
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

  await notificaciones.notificar({
    usuarioId,
    tipo: 'CONTRASENA_CAMBIADA',
    mensaje: 'Tu contraseña se cambió. Si no fuiste vos, contactate con nosotros ya mismo.',
    asuntoMail: 'Tu contraseña de PetHood cambió',
    entidadTipo: 'PERFIL',
    entidadId: usuarioId,
    canal: { mail: true, push: true },
    usuarioAlta: usuarioId,
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

  // Solo mail: con la cuenta dada de baja ya no puede entrar, así que una fila de bandeja
  // nunca se vería.
  await notificaciones.enviarMailDirecto({
    to: usuario.email,
    asunto: 'Tu cuenta de PetHood fue dada de baja',
    texto: `Tu cuenta de PetHood fue dada de baja.\n\nSi no fuiste vos, escribinos a ${env.MAIL_SOPORTE}.`,
  });
}

const DIAS_PERFIL_INCOMPLETO = 2;
const MS_POR_DIA = 24 * 60 * 60 * 1000;

/** Job programado (spec 004): perfil incompleto a los 2-3 días de registrarse. Se avisa una
 * sola vez por cuenta — `notificarUnaVez` evita repetirlo en cada corrida diaria. */
export async function avisarPerfilesIncompletos(ahora: Date = new Date()): Promise<void> {
  const desde = new Date(ahora.getTime() - DIAS_PERFIL_INCOMPLETO * MS_POR_DIA);
  const usuarios = await repo.listarPerfilesIncompletos(desde);

  await Promise.all(
    usuarios.map((usuario) =>
      notificaciones.notificarUnaVez({
        usuarioId: usuario.id,
        tipo: 'PERFIL_INCOMPLETO',
        mensaje: `${usuario.nombre}, completá tu perfil para aprovechar PetHood al máximo`,
        entidadTipo: 'PERFIL',
        entidadId: usuario.id,
        canal: { push: true },
        silenciosoDeNoche: true,
      }),
    ),
  );
}

/** Email del usuario SISTEMA (prisma/seed): una cuenta interna que no es un perfil. */
const EMAIL_SISTEMA = 'sistema@pethood.internal';

/** Spec 023. Una persona suspendida, inactiva, dada de baja o el usuario SISTEMA no se muestran. */
export async function obtenerPerfilPublico(
  id: number,
  actorId: number,
): Promise<PerfilPublicoUsuarioDto> {
  const usuario = await repo.buscarPerfilPublico(id);
  const estado = usuario?.estado.nombre;
  const visible =
    usuario !== null &&
    usuario.email !== EMAIL_SISTEMA &&
    estado !== ESTADO_USUARIO.SUSPENDIDO &&
    estado !== ESTADO_USUARIO.INACTIVO;

  if (!usuario || !visible) {
    throw new AppError('NO_ENCONTRADO', 'No encontramos a esa persona', 404);
  }

  return {
    id: usuario.id,
    nombre: usuario.nombre,
    apellido: usuario.apellido,
    imagenUrl: usuario.imagenUrl,
    verificado: usuario.verificado,
    provincia: usuario.provincia,
    localidad: usuario.localidad,
    fechaAlta: usuario.fechaAlta.toISOString(),
    esPropio: usuario.id === actorId,
  };
}

/** Carga única del DNI (spec 027 §6.11): con DNI ya cargado sólo lo corrige un admin. */
export async function cargarDni(
  usuarioId: number,
  dni: string,
  ambito: Ambito,
): Promise<PerfilPropio> {
  const yaCargado = () =>
    new AppError(
      'DNI_YA_CARGADO',
      'Tu DNI ya está cargado. Si hay un error, escribinos desde Soporte.',
      409,
    );

  const usuario = await repo.buscarPerfil(usuarioId);
  if (!usuario) throw new AppError('NO_ENCONTRADO', 'El usuario no existe', 404);
  if (usuario.dni) throw yaCargado();

  let guardado: boolean;
  try {
    guardado = await repo.guardarDni(usuarioId, dni);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new AppError('DNI_DUPLICADO', 'Ya existe una cuenta con ese DNI.', 409);
    }
    throw err;
  }
  if (!guardado) throw yaCargado();

  // El DNI no va al detalle: el log de auditoría no guarda datos personales de más.
  await registrarAuditoria({
    usuarioId,
    accion: 'CARGAR_DNI',
    entidad: 'Usuario',
    entidadId: usuarioId,
  });

  return obtenerPerfil(usuarioId, ambito);
}
