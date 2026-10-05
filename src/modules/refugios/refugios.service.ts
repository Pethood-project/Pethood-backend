/**
 * Perfil público de un refugio (spec 023). Solo lectura. Los datos de contacto (teléfono y
 * email) no se exponen: el contacto es por chat.
 */
import { AppError } from '../../middlewares/errorHandler';
import { listarDeRefugio } from '../resenas/resenas.service';
import type { PerfilPublicoRefugioDto } from './refugios.dto';
import * as repo from './refugios.repository';

/** Nombre del estado del catálogo EstadoRefugio (prisma/seed/catalogos.ts). */
const ESTADO_REFUGIO_ACTIVO = 'Activo';

export async function obtenerPerfilPublico(
  refugioId: number,
  usuarioId: number,
): Promise<PerfilPublicoRefugioDto> {
  const refugio = await repo.buscarRefugio(refugioId);

  // Un refugio que no está Activo (pendiente de verificación, suspendido, inactivo) no se muestra.
  if (!refugio || refugio.estado.nombre !== ESTADO_REFUGIO_ACTIVO) {
    throw new AppError('NO_ENCONTRADO', 'No encontramos ese refugio', 404);
  }

  const [actor, publicacionesActivas, resenas] = await Promise.all([
    repo.buscarUsuario(usuarioId),
    repo.contarPublicacionesActivas(refugioId),
    listarDeRefugio(refugioId),
  ]);

  return {
    id: refugio.id,
    nombre: refugio.nombre,
    descripcion: refugio.descripcion,
    imagenUrl: refugio.imagenUrl,
    verificado: refugio.verificado,
    provincia: refugio.provincia,
    localidad: refugio.localidad,
    calleAltura: refugio.calleAltura,
    mapaUrl: refugio.mapaUrl,
    fechaAlta: refugio.fechaAlta.toISOString(),
    resumen: {
      publicacionesActivas,
      resenas: { promedio: resenas.promedio, cantidad: resenas.cantidad },
    },
    esMiembro: actor?.refugioId === refugio.id,
  };
}
