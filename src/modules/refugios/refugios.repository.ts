import { prisma } from '../../shared/prisma';

export function buscarRefugio(id: number) {
  return prisma.refugio.findFirst({
    where: { id, fechaBaja: null },
    select: {
      id: true,
      nombre: true,
      descripcion: true,
      imagenUrl: true,
      verificado: true,
      provincia: true,
      localidad: true,
      calleAltura: true,
      mapaUrl: true,
      fechaAlta: true,
      estado: { select: { nombre: true } },
    },
  });
}

/** Publicaciones del refugio con estado vigente «Activa», igual criterio que el feed. */
export function contarPublicacionesActivas(refugioId: number) {
  return prisma.publicacion.count({
    where: {
      fechaBaja: null,
      mascota: { refugioId, fechaBaja: null },
      historicoEstados: { some: { fechaBaja: null, estadoPublicacion: { nombre: 'Activa' } } },
    },
  });
}

export function buscarUsuario(usuarioId: number) {
  return prisma.usuario.findFirst({
    where: { id: usuarioId, fechaBaja: null },
    select: { id: true, refugioId: true },
  });
}
