import { AppError } from '../../middlewares/errorHandler';
import { direccionDesdeCampos, geocodificarDireccion } from '../../shared/geocoding';
import { resolverCoordenadasDeMapsUrl } from '../../shared/geo';
import { persistirImagenPerfil } from '../../shared/imagenPerfil';
import { registrarAuditoria } from '../../shared/logAuditoria';
import type { ArchivoSubida } from '../../shared/r2';
import type {
  ActualizarPerfilRefugioBody,
  PerfilRefugio,
  PreviewUbicacionRefugioBody,
  UbicacionGeocodificadaRefugioDto,
} from './perfil-refugio.dto';
import type { RefugioConEstado } from './perfil-refugio.repository';
import * as repo from './perfil-refugio.repository';

/** Las que todavía esperan una respuesta del refugio. */
const ESTADOS_SOLICITUD_ABIERTA = ['Pendiente', 'En_Revision'];

/**
 * Hoy cualquier miembro del refugio edita su perfil. Cuando existan roles dentro del
 * refugio (DEUDA_TECNICA.md, ítem 17), la regla va acá y en ningún otro lado: `obtener`
 * la informa en `puedeEditar` y `actualizar` la hace cumplir.
 */
function puedeEditarPerfil(_usuarioId: number, _refugioId: number): boolean {
  return true;
}

async function exigirRefugioDelUsuario(usuarioId: number): Promise<RefugioConEstado> {
  const usuario = await repo.buscarUsuario(usuarioId);
  if (!usuario) {
    throw new AppError('NO_AUTENTICADO', 'No encontramos tu sesión.', 401);
  }
  if (!usuario.refugioId) {
    throw new AppError('SIN_REFUGIO', 'Tu usuario no está asociado a ningún refugio', 403);
  }

  const refugio = await repo.buscarRefugio(usuario.refugioId);
  if (!refugio) {
    throw new AppError('REFUGIO_NO_ENCONTRADO', 'No encontramos tu refugio.', 404);
  }
  return refugio;
}

async function armarPerfil(refugio: RefugioConEstado, usuarioId: number): Promise<PerfilRefugio> {
  const [enRefugio, adopciones, estadosSolicitudes, valoracion] = await Promise.all([
    repo.contarMascotasEnRefugio(refugio.id),
    repo.contarAdopciones(refugio.id),
    repo.listarEstadosVigentesDeSolicitudes(refugio.id),
    repo.valoracionDelRefugio(refugio.id),
  ]);

  return {
    id: refugio.id,
    nombre: refugio.nombre,
    provincia: refugio.provincia,
    localidad: refugio.localidad,
    calleAltura: refugio.calleAltura,
    mapaUrl: refugio.mapaUrl,
    latitud: refugio.latitud,
    longitud: refugio.longitud,
    ubicacionVerificada: refugio.ubicacionVerificada,
    telefono: refugio.telefono,
    email: refugio.email,
    descripcion: refugio.descripcion,
    imagenUrl: refugio.imagenUrl,
    verificado: refugio.verificado,
    estado: refugio.estado.nombre,
    estadisticas: {
      enRefugio,
      adopciones,
      solicitudesAbiertas: estadosSolicitudes.filter((estado) =>
        ESTADOS_SOLICITUD_ABIERTA.includes(estado),
      ).length,
    },
    valoracion: {
      promedio: valoracion.promedio === null ? null : Math.round(valoracion.promedio * 10) / 10,
      cantidad: valoracion.cantidad,
    },
    puedeEditar: puedeEditarPerfil(usuarioId, refugio.id),
  };
}

export async function obtenerPerfil(usuarioId: number): Promise<PerfilRefugio> {
  const refugio = await exigirRefugioDelUsuario(usuarioId);
  return armarPerfil(refugio, usuarioId);
}

export async function actualizarPerfil(
  usuarioId: number,
  body: ActualizarPerfilRefugioBody,
  archivo?: ArchivoSubida,
): Promise<PerfilRefugio> {
  const refugio = await exigirRefugioDelUsuario(usuarioId);

  if (!puedeEditarPerfil(usuarioId, refugio.id)) {
    throw new AppError(
      'SIN_PERMISO_REFUGIO',
      'No tenés permiso para editar los datos del refugio.',
      403,
    );
  }

  // Es la foto que ve cualquiera que mire el refugio, igual que el avatar de una persona:
  // va a la misma carpeta pública.
  const imagenUrl = archivo ? await persistirImagenPerfil(archivo) : undefined;

  // Solo se geocodifica si la dirección estructurada cambió y está completa. Así, corregir el
  // link de Maps a mano no lo pisa con el resultado del geocoder.
  const cambioDireccion =
    body.provincia !== refugio.provincia ||
    body.localidad !== refugio.localidad ||
    body.calleAltura !== refugio.calleAltura;
  const direccion = cambioDireccion ? direccionDesdeCampos(body) : null;
  const ubicacion = direccion ? await geocodificarDireccion(direccion) : null;

  if (direccion && !ubicacion) {
    throw new AppError(
      'DIRECCION_NO_GEOCODIFICADA',
      'No pudimos ubicar esa dirección. Revisá la localidad y la provincia.',
      422,
    );
  }

  const actualizado = await repo.actualizarRefugio(refugio.id, usuarioId, {
    ...body,
    imagenUrl,
    mapaUrl: ubicacion?.mapaUrl,
    latitud: ubicacion?.latitud,
    longitud: ubicacion?.longitud,
  });

  await registrarAuditoria({
    usuarioId,
    accion: 'EDITAR_PERFIL_REFUGIO',
    entidad: 'Refugio',
    entidadId: refugio.id,
  });

  return armarPerfil(actualizado, usuarioId);
}

/**
 * Edición manual del link de Google Maps del refugio desde Mi Refugio. Parsea las coordenadas
 * del link y actualiza latitud/longitud, para que el pin quede donde el miembro lo pegó.
 */
export async function actualizarUbicacion(
  usuarioId: number,
  mapaUrl: string,
): Promise<PerfilRefugio> {
  const refugio = await exigirRefugioDelUsuario(usuarioId);

  if (!puedeEditarPerfil(usuarioId, refugio.id)) {
    throw new AppError(
      'SIN_PERMISO_REFUGIO',
      'No tenés permiso para editar los datos del refugio.',
      403,
    );
  }

  const coordenadas = await resolverCoordenadasDeMapsUrl(mapaUrl);
  if (!coordenadas) {
    throw new AppError(
      'LINK_MAPA_INVALIDO',
      'No pudimos leer la ubicación de ese link. Pegá el link de Google Maps de tu ubicación.',
      422,
    );
  }

  const actualizado = await repo.actualizarUbicacion(refugio.id, usuarioId, {
    mapaUrl,
    latitud: coordenadas.latitud,
    longitud: coordenadas.longitud,
  });

  await registrarAuditoria({
    usuarioId,
    accion: 'EDITAR_UBICACION_REFUGIO',
    entidad: 'Refugio',
    entidadId: refugio.id,
  });

  return armarPerfil(actualizado, usuarioId);
}

/**
 * Geocodifica la dirección estructurada sin guardar nada, para que Datos del refugio muestre
 * el link de Maps que se generaría y el miembro lo verifique antes de guardar.
 */
export async function previewUbicacion(
  body: PreviewUbicacionRefugioBody,
): Promise<UbicacionGeocodificadaRefugioDto> {
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
