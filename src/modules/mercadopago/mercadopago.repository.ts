import { prisma } from '../../shared/prisma';
import { datosAlta, datosBaja, datosModificacion } from '../../shared/auditoria';

export const ESTADO_CONEXION = { VINCULADA: 'VINCULADA', REVINCULAR: 'REVINCULAR' } as const;

export function buscarRefugioDeUsuario(usuarioId: number) {
  return prisma.usuario.findFirst({
    where: { id: usuarioId, fechaBaja: null },
    select: { refugioId: true },
  });
}

/** La conexión vigente del refugio (no dada de baja), con los tokens cifrados. */
export function buscarConexion(refugioId: number) {
  return prisma.conexionMercadoPago.findFirst({ where: { refugioId, fechaBaja: null } });
}

/** Vincular o revincular: una fila por refugio, que se reactiva si estaba dada de baja. */
export function guardarConexion(
  refugioId: number,
  datos: { mpUserId: string; accessToken: string; refreshToken: string; vence: Date },
  usuarioId: number,
) {
  return prisma.conexionMercadoPago.upsert({
    where: { refugioId },
    create: { refugioId, ...datos, estado: ESTADO_CONEXION.VINCULADA, ...datosAlta(usuarioId) },
    update: {
      ...datos,
      estado: ESTADO_CONEXION.VINCULADA,
      usuarioBaja: null,
      fechaBaja: null,
      ...datosModificacion(usuarioId),
    },
  });
}

export function actualizarTokens(
  id: number,
  datos: { accessToken: string; refreshToken: string; vence: Date },
  usuarioId: number,
) {
  return prisma.conexionMercadoPago.update({
    where: { id },
    data: { ...datos, ...datosModificacion(usuarioId) },
  });
}

export function marcarRevincular(id: number, usuarioId: number) {
  return prisma.conexionMercadoPago.update({
    where: { id },
    data: { estado: ESTADO_CONEXION.REVINCULAR, ...datosModificacion(usuarioId) },
  });
}

/** Desvincular: baja lógica y los tokens se borran (no quedan secretos de más). */
export async function darDeBaja(refugioId: number, usuarioId: number): Promise<boolean> {
  const { count } = await prisma.conexionMercadoPago.updateMany({
    where: { refugioId, fechaBaja: null },
    data: { accessToken: '', refreshToken: '', ...datosBaja(usuarioId) },
  });
  return count === 1;
}

export function listarPorVencer(limite: Date) {
  return prisma.conexionMercadoPago.findMany({
    where: { fechaBaja: null, estado: ESTADO_CONEXION.VINCULADA, vence: { lte: limite } },
  });
}
