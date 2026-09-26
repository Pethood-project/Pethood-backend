import { prisma } from '../../shared/prisma';
import { datosModificacion } from '../../shared/auditoria';

const includeRefugio = { estado: true } as const;

/** Vigente = fila sin fechaBaja. Mismo criterio que dashboard-refugio.repository.ts. */

export function buscarUsuario(usuarioId: number) {
  return prisma.usuario.findFirst({
    where: { id: usuarioId, fechaBaja: null },
    select: { id: true, refugioId: true },
  });
}

export function buscarRefugio(refugioId: number) {
  return prisma.refugio.findFirst({
    where: { id: refugioId, fechaBaja: null },
    include: includeRefugio,
  });
}

export type RefugioConEstado = NonNullable<Awaited<ReturnType<typeof buscarRefugio>>>;

/** Mismo número que «En el refugio» del dashboard (`contarMascotasEnRefugio`). */
export function contarMascotasEnRefugio(refugioId: number): Promise<number> {
  return prisma.mascotaEstado.count({
    where: {
      fechaBaja: null,
      estadoMascota: { nombre: { in: ['Disponible', 'En_Tratamiento', 'En_Transito'] } },
      mascota: { refugioId, fechaBaja: null },
    },
  });
}

export function contarAdopciones(refugioId: number): Promise<number> {
  return prisma.mascotaEstado.count({
    where: {
      fechaBaja: null,
      estadoMascota: { nombre: 'Adoptado' },
      mascota: { refugioId, fechaBaja: null },
    },
  });
}

/**
 * Nombre del estado vigente de cada solicitud sobre mascotas del refugio. El service decide
 * cuáles cuentan como abiertas: el estado vigente es la última fila, y eso no se puede
 * filtrar con un `count` de Prisma.
 */
export async function listarEstadosVigentesDeSolicitudes(refugioId: number): Promise<string[]> {
  const solicitudes = await prisma.solicitud.findMany({
    where: { fechaBaja: null, publicacion: { mascota: { refugioId, fechaBaja: null } } },
    select: {
      historicoEstados: {
        where: { fechaBaja: null },
        select: { estadoSolicitud: { select: { nombre: true } } },
        orderBy: { fechaAlta: 'desc' },
        take: 1,
      },
    },
  });

  return solicitudes.flatMap((solicitud) =>
    solicitud.historicoEstados.map((fila) => fila.estadoSolicitud.nombre),
  );
}

export async function valoracionDelRefugio(
  refugioId: number,
): Promise<{ promedio: number | null; cantidad: number }> {
  const resultado = await prisma.resena.aggregate({
    where: { refugioReportadoId: refugioId, fechaBaja: null },
    _avg: { puntuacion: true },
    _count: { _all: true },
  });
  return { promedio: resultado._avg.puntuacion, cantidad: resultado._count._all };
}

export interface DatosActualizarRefugio {
  nombre: string;
  direccion: string;
  telefono: string | null;
  email: string | null;
  descripcion: string | null;
  imagenUrl?: string;
}

export function actualizarRefugio(
  refugioId: number,
  usuarioId: number,
  datos: DatosActualizarRefugio,
): Promise<RefugioConEstado> {
  return prisma.refugio.update({
    where: { id: refugioId },
    data: {
      nombre: datos.nombre,
      direccion: datos.direccion,
      telefono: datos.telefono,
      email: datos.email,
      descripcion: datos.descripcion,
      ...(datos.imagenUrl ? { imagenUrl: datos.imagenUrl } : {}),
      ...datosModificacion(usuarioId),
    },
    include: includeRefugio,
  });
}
