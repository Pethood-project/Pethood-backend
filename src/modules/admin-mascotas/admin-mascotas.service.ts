import { AppError } from '../../middlewares/errorHandler';
import { registrarAuditoria } from '../../shared/logAuditoria';
import { aFechaISO } from '../../shared/validation/dates';
import type { FiltrosMascotas } from './admin-mascotas.dto';
import * as repo from './admin-mascotas.repository';
import type { MascotaAdmin } from './admin-mascotas.repository';

/** Trámites abiertos: frenan la baja (mismo criterio que la baja del dueño). */
const ESTADOS_SOLICITUD_ABIERTA = ['Pendiente', 'En_Revision'];

function aItemDto(m: MascotaAdmin) {
  const estado = m.historicoEstados[0]?.estadoMascota;

  return {
    id: m.id,
    nombre: m.nombre,
    especie: m.raza.especie.nombre,
    raza: m.raza.nombre,
    estado: estado ? { id: estado.id, nombre: estado.nombre } : null,
    duenio: m.refugio
      ? { tipo: 'REFUGIO' as const, id: m.refugio.id, nombre: m.refugio.nombre }
      : {
          tipo: 'ADOPTANTE' as const,
          id: m.usuario.id,
          nombre: `${m.usuario.nombre} ${m.usuario.apellido}`,
        },
    tienePublicacionActiva: m.publicaciones.length > 0,
    fechaAlta: m.fechaAlta,
    fechaBaja: m.fechaBaja,
  };
}

async function buscarOFallar(id: number) {
  const mascota = await repo.buscar(id);
  if (!mascota) throw new AppError('NO_ENCONTRADO', 'No encontramos esa mascota.', 404);
  return mascota;
}

export async function listar(filtros: FiltrosMascotas) {
  const { items, total } = await repo.listar(filtros);
  return { items: items.map(aItemDto), total, page: filtros.page, limit: filtros.limit };
}

export async function obtener(id: number) {
  const m = await buscarOFallar(id);

  return {
    ...aItemDto(m),
    fechaNacimiento: m.fechaNacimiento ? aFechaISO(m.fechaNacimiento) : null,
    genero: m.genero,
    peso: m.peso === null ? null : Number(m.peso),
    tamanio: m.tamanio,
    castrado: m.castrado,
    descripcion: m.descripcion,
    imagenUrl: m.imagenUrl,
    historiaClinica: m.historiaClinica.map((h) => ({
      id: h.id,
      fechaVisita: aFechaISO(h.fechaVisita),
      titulo: h.titulo,
      descripcion: h.descripcion,
      vacunacion: h.vacunacion,
      tipoVacuna: h.tipoVacuna,
      documentoUrl: h.documentoUrl,
    })),
  };
}

export async function darDeBaja(adminId: number, id: number, motivo: string) {
  const m = await buscarOFallar(id);
  if (m.fechaBaja) throw new AppError('MASCOTA_DE_BAJA', 'La mascota ya está dada de baja.', 409);

  const solicitudes = await repo.listarSolicitudesDeMascota(id);
  const hayAbiertas = solicitudes.some((s) => {
    const estado = s.historicoEstados[0]?.estadoSolicitud;
    return estado !== undefined && ESTADOS_SOLICITUD_ABIERTA.includes(estado.nombre);
  });
  if (hayAbiertas) {
    throw new AppError(
      'ADOPCION_EN_CURSO',
      'La mascota tiene solicitudes de adopción abiertas: no se puede dar de baja.',
      409,
    );
  }

  await repo.darDeBajaConPublicaciones(id, adminId);
  await repo.crearNotificacion({
    usuarioId: m.usuarioId,
    adminId,
    mensaje: `Un administrador dio de baja a tu mascota «${m.nombre ?? 'sin nombre'}». Motivo: ${motivo}`,
  });
  await registrarAuditoria({
    usuarioId: adminId,
    accion: 'BAJA_MODERACION',
    entidad: 'Mascota',
    entidadId: id,
    detalle: `motivo=${motivo}`,
  });

  return obtener(id);
}

/** Solo revierte la mascota: las publicaciones que arrastró la baja se reactivan una por una. */
export async function reactivar(adminId: number, id: number, motivo: string) {
  const m = await buscarOFallar(id);
  if (!m.fechaBaja)
    throw new AppError('MASCOTA_NO_DE_BAJA', 'La mascota no está dada de baja.', 409);

  await repo.reactivar(id);
  await registrarAuditoria({
    usuarioId: adminId,
    accion: 'REACTIVAR_MODERACION',
    entidad: 'Mascota',
    entidadId: id,
    detalle: `motivo=${motivo}`,
  });

  return obtener(id);
}
