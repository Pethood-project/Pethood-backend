import { AppError } from '../../middlewares/errorHandler';
import type { FiltrosSolicitudes } from './admin-solicitudes.dto';
import * as repo from './admin-solicitudes.repository';
import type { SolicitudAdmin } from './admin-solicitudes.repository';

function aItemDto(s: SolicitudAdmin) {
  const { mascota } = s.publicacion;
  // El primero del historial es el más nuevo; el vigente es el que no tiene baja.
  const estado = (s.historicoEstados.find((h) => h.fechaBaja === null) ?? s.historicoEstados[0])
    ?.estadoSolicitud;

  return {
    id: s.id,
    mascota: { id: mascota.id, nombre: mascota.nombre },
    solicitante: { id: s.usuario.id, nombre: `${s.usuario.nombre} ${s.usuario.apellido}` },
    refugio: mascota.refugio ? { id: mascota.refugio.id, nombre: mascota.refugio.nombre } : null,
    tipo: s.tipoSolicitud.nombre,
    estado: estado ? { id: estado.id, nombre: estado.nombre } : null,
    fechaAlta: s.fechaAlta,
  };
}

export async function listar(filtros: FiltrosSolicitudes) {
  const { items, total } = await repo.listar(filtros);
  return { items: items.map(aItemDto), total, page: filtros.page, limit: filtros.limit };
}

export async function obtener(id: number) {
  const s = await repo.buscar(id);
  if (!s) throw new AppError('NO_ENCONTRADO', 'No encontramos esa solicitud.', 404);

  return {
    ...aItemDto(s),
    publicacionId: s.publicacionId,
    motivacion: s.motivacion,
    comentario: s.comentario,
    fechaRespuesta: s.fechaRespuesta,
    fechaInicioTransito: s.fechaInicioTransito,
    fechaFinTransito: s.fechaFinTransito,
    fechaBaja: s.fechaBaja,
    historialEstados: s.historicoEstados.map((h) => ({
      estado: h.estadoSolicitud.nombre,
      fechaAlta: h.fechaAlta,
      fechaBaja: h.fechaBaja,
      usuarioAlta: h.usuarioAlta,
    })),
  };
}
