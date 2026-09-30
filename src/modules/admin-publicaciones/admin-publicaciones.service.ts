import { AppError } from '../../middlewares/errorHandler';
import { registrarAuditoria } from '../../shared/logAuditoria';
import { aFechaISO } from '../../shared/validation/dates';
import { TRANSICIONES } from '../publicaciones/publicaciones.service';
import type { EstadoBody, FiltrosPublicaciones } from './admin-publicaciones.dto';
import * as repo from './admin-publicaciones.repository';
import type { PublicacionAdmin } from './admin-publicaciones.repository';

const ESTADO_MASCOTA_DISPONIBLE = 'Disponible';

function aItemDto(pub: PublicacionAdmin) {
  const { mascota } = pub;
  const estado = pub.historicoEstados[0]?.estadoPublicacion;

  return {
    id: pub.id,
    titulo: pub.titulo,
    imagenUrl: pub.imagenUrl,
    estado: estado ? { id: estado.id, nombre: estado.nombre } : null,
    mascota: { id: mascota.id, nombre: mascota.nombre, especie: mascota.raza.especie.nombre },
    publicador: mascota.refugio
      ? { tipo: 'REFUGIO' as const, id: mascota.refugio.id, nombre: mascota.refugio.nombre }
      : {
          tipo: 'ADOPTANTE' as const,
          id: pub.usuario.id,
          nombre: `${pub.usuario.nombre} ${pub.usuario.apellido}`,
        },
    cantidadSolicitudes: pub._count.solicitudes,
    // ponytail: ReporteProblema no tiene FKs todavía (§5), no hay qué contar. Cablear con el módulo reportes.
    cantidadReportes: 0,
    fechaAlta: pub.fechaAlta,
    fechaBaja: pub.fechaBaja,
  };
}

async function buscarOFallar(id: number) {
  const pub = await repo.buscar(id);
  if (!pub) throw new AppError('NO_ENCONTRADO', 'No encontramos esa publicación.', 404);
  return pub;
}

export async function listar(filtros: FiltrosPublicaciones) {
  const { items, total } = await repo.listar(filtros);
  return { items: items.map(aItemDto), total, page: filtros.page, limit: filtros.limit };
}

export async function obtener(id: number) {
  const pub = await buscarOFallar(id);
  const { mascota } = pub;

  return {
    ...aItemDto(pub),
    descripcion: pub.descripcion,
    ubicacion: pub.ubicacion,
    requisitos: pub.requisitos,
    personalidad: pub.personalidad,
    desparasitado: pub.desparasitado,
    imagenes: pub.imagenes,
    mascota: {
      id: mascota.id,
      nombre: mascota.nombre,
      fechaNacimiento: mascota.fechaNacimiento ? aFechaISO(mascota.fechaNacimiento) : null,
      genero: mascota.genero,
      tamanio: mascota.tamanio,
      castrado: mascota.castrado,
      imagenUrl: mascota.imagenUrl,
      especie: mascota.raza.especie.nombre,
      raza: mascota.raza.nombre,
    },
    historialEstados: pub.historicoEstados.map((h) => ({
      estado: h.estadoPublicacion.nombre,
      fechaAlta: h.fechaAlta,
      fechaBaja: h.fechaBaja,
      usuarioAlta: h.usuarioAlta,
    })),
    reportes: [], // ponytail: ver cantidadReportes
  };
}

export async function cambiarEstado(adminId: number, id: number, body: EstadoBody) {
  const pub = await buscarOFallar(id);
  const estado = pub.historicoEstados[0]?.estadoPublicacion;

  if (pub.fechaBaja || !estado) {
    throw new AppError('PUBLICACION_DE_BAJA', 'La publicación está dada de baja.', 409);
  }

  const transicion = TRANSICIONES[body.accion];
  if (!transicion.desde.includes(estado.nombre)) {
    throw new AppError('TRANSICION_INVALIDA', transicion.error, 409);
  }

  if (body.accion === 'REACTIVAR') {
    const estadoMascota = (await repo.buscarEstadoMascotaVigente(pub.mascotaId))?.nombre;
    if (estadoMascota !== ESTADO_MASCOTA_DISPONIBLE) {
      throw new AppError(
        'MASCOTA_NO_DISPONIBLE',
        'Para reactivar la publicación, la mascota tiene que estar disponible.',
        409,
      );
    }
  }

  const destino = await repo.buscarEstadoPublicacionPorNombre(transicion.hacia);
  if (!destino) throw new AppError('ERROR_INTERNO', 'Catálogo de estados incompleto.', 500);

  await repo.cambiarEstado(id, destino.id, adminId);
  await registrarAuditoria({
    usuarioId: adminId,
    accion: 'CAMBIAR_ESTADO',
    entidad: 'Publicacion',
    entidadId: id,
    detalle: `estado=${transicion.hacia} (admin) motivo=${body.motivo}`,
  });

  return obtener(id);
}

export async function darDeBaja(adminId: number, id: number, motivo: string) {
  const pub = await buscarOFallar(id);
  if (pub.fechaBaja) {
    throw new AppError('PUBLICACION_DE_BAJA', 'La publicación ya está dada de baja.', 409);
  }

  await repo.darDeBaja(id, adminId);
  await repo.crearNotificacion({
    usuarioId: pub.usuarioId,
    adminId,
    mensaje: `Un administrador dio de baja tu publicación «${pub.titulo}». Motivo: ${motivo}`,
  });
  await registrarAuditoria({
    usuarioId: adminId,
    accion: 'BAJA_MODERACION',
    entidad: 'Publicacion',
    entidadId: id,
    detalle: `motivo=${motivo}`,
  });

  return obtener(id);
}

export async function reactivar(adminId: number, id: number) {
  const pub = await buscarOFallar(id);
  if (!pub.fechaBaja) {
    throw new AppError('PUBLICACION_NO_DE_BAJA', 'La publicación no está dada de baja.', 409);
  }
  if (pub.mascota.fechaBaja) {
    throw new AppError('MASCOTA_DE_BAJA', 'La mascota de la publicación está dada de baja.', 409);
  }
  if (await repo.buscarEnCursoDeMascota(pub.mascotaId)) {
    throw new AppError('YA_PUBLICADA', 'Esa mascota ya tiene otra publicación en curso.', 409);
  }

  // El primero del historial (más nuevo) es el estado que se cerró con la baja.
  const ultimo = pub.historicoEstados[0];
  if (!ultimo) throw new AppError('ERROR_INTERNO', 'La publicación no tiene historial.', 500);

  await repo.revertirBaja(id, ultimo.estadoPublicacionId, adminId);
  await registrarAuditoria({
    usuarioId: adminId,
    accion: 'REACTIVAR_MODERACION',
    entidad: 'Publicacion',
    entidadId: id,
  });

  return obtener(id);
}
