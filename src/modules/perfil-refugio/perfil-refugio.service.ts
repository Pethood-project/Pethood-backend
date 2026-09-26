import { AppError } from '../../middlewares/errorHandler';
import { persistirImagenPerfil } from '../../shared/imagenPerfil';
import { registrarAuditoria } from '../../shared/logAuditoria';
import type { ArchivoSubida } from '../../shared/r2';
import type { ActualizarPerfilRefugioBody, PerfilRefugio } from './perfil-refugio.dto';
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
    direccion: refugio.direccion,
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
  const actualizado = await repo.actualizarRefugio(refugio.id, usuarioId, { ...body, imagenUrl });

  await registrarAuditoria({
    usuarioId,
    accion: 'EDITAR_PERFIL_REFUGIO',
    entidad: 'Refugio',
    entidadId: refugio.id,
  });

  return armarPerfil(actualizado, usuarioId);
}
