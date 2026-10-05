import { Prisma, type TipoReporte } from '@prisma/client';
import { datosAlta, datosModificacion } from '../../shared/auditoria';
import { prisma } from '../../shared/prisma';

const PERSONA = { id: true, nombre: true, apellido: true } as const;

export function buscarUsuario(usuarioId: number) {
  return prisma.usuario.findFirst({
    where: { id: usuarioId, fechaBaja: null },
    select: { id: true, refugioId: true },
  });
}

/** Reportes sin resolver del usuario: alimenta la quota anti-spam (regla 5 de la spec). */
export function contarPendientesDelUsuario(usuarioId: number) {
  return prisma.reporteProblema.count({
    where: { usuarioAlta: usuarioId, resuelto: false, fechaBaja: null },
  });
}

export function buscarPendienteDuplicado(usuarioId: number, tipo: TipoReporte, objetoId: number) {
  return prisma.reporteProblema.findFirst({
    where: { usuarioAlta: usuarioId, tipo, objetoId, resuelto: false, fechaBaja: null },
    select: { id: true },
  });
}

export function crear(datos: {
  usuarioId: number;
  tipo: TipoReporte;
  objetoId: number;
  motivo: string;
}) {
  return prisma.reporteProblema.create({
    data: {
      tipo: datos.tipo,
      objetoId: datos.objetoId,
      motivo: datos.motivo,
      ...datosAlta(datos.usuarioId),
    },
  });
}

/** El índice único parcial `reporte_problema_pendiente_uq` rechazó un duplicado en carrera. */
export function esViolacionDeUnicidad(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}

export function buscarReporte(id: number) {
  return prisma.reporteProblema.findFirst({ where: { id, fechaBaja: null } });
}

export interface FiltrosListado {
  estado: 'pendiente' | 'resuelto' | 'todos';
  tipo?: TipoReporte;
  page: number;
  limit: number;
}

export async function listar(f: FiltrosListado) {
  const where: Prisma.ReporteProblemaWhereInput = {
    fechaBaja: null,
    ...(f.estado === 'todos' ? {} : { resuelto: f.estado === 'resuelto' }),
    ...(f.tipo ? { tipo: f.tipo } : {}),
  };
  // Pendientes: el más viejo primero (hay que atender en orden de llegada). El resto, el último.
  const sentido = f.estado === 'pendiente' ? 'asc' : 'desc';

  const [items, total] = await prisma.$transaction([
    prisma.reporteProblema.findMany({
      where,
      orderBy: [{ fechaAlta: sentido }, { id: sentido }],
      skip: (f.page - 1) * f.limit,
      take: f.limit,
    }),
    prisma.reporteProblema.count({ where }),
  ]);

  return { items, total };
}

/** Los reportes de un objeto, para el detalle admin de publicaciones. */
export function listarDeObjeto(tipo: TipoReporte, objetoId: number) {
  return prisma.reporteProblema.findMany({
    where: { tipo, objetoId, fechaBaja: null },
    orderBy: [{ fechaAlta: 'desc' }, { id: 'desc' }],
  });
}

/** `usuarioAlta`/`usuarioModificacion` son columnas planas, sin relación: se resuelven aparte. */
export function listarPersonas(ids: number[]) {
  return prisma.usuario.findMany({ where: { id: { in: ids } }, select: PERSONA });
}

/** Marca el reporte como resuelto y avisa al reportante en la misma transacción. */
export function resolver(datos: {
  id: number;
  adminId: number;
  respuesta: string;
  reportanteId: number;
  mensajeAviso: string;
}) {
  return prisma.$transaction(async (tx) => {
    const reporte = await tx.reporteProblema.update({
      where: { id: datos.id },
      data: { resuelto: true, respuesta: datos.respuesta, ...datosModificacion(datos.adminId) },
    });
    await tx.notificacion.create({
      data: {
        tipo: 'REPORTE_RESUELTO',
        mensaje: datos.mensajeAviso,
        usuarioId: datos.reportanteId,
        ...datosAlta(datos.adminId),
      },
    });
    return reporte;
  });
}

// ─── Objetos reportables: un lookup por tipo. `incluirBajas` solo lo usa el detalle admin. ───

const vigente = (incluirBajas: boolean) => (incluirBajas ? {} : { fechaBaja: null });

export const BUSCAR_OBJETO = {
  PUBLICACION: (id: number, incluirBajas: boolean) =>
    prisma.publicacion.findFirst({
      where: { id, ...vigente(incluirBajas) },
      select: {
        titulo: true,
        imagenUrl: true,
        usuarioId: true,
        fechaBaja: true,
        mascota: { select: { refugioId: true } },
      },
    }),
  USUARIO: (id: number, incluirBajas: boolean) =>
    prisma.usuario.findFirst({
      where: { id, ...vigente(incluirBajas) },
      select: {
        ...PERSONA,
        email: true,
        telefono: true,
        imagenUrl: true,
        verificado: true,
        provincia: true,
        localidad: true,
        fechaAlta: true,
        fechaBaja: true,
        estado: { select: { nombre: true } },
        refugio: { select: { id: true, nombre: true } },
      },
    }),
  REFUGIO: (id: number, incluirBajas: boolean) =>
    prisma.refugio.findFirst({
      where: { id, ...vigente(incluirBajas) },
      select: {
        id: true,
        nombre: true,
        imagenUrl: true,
        fechaBaja: true,
        estado: { select: { nombre: true } },
      },
    }),
  RESENA: (id: number, incluirBajas: boolean) =>
    prisma.resena.findFirst({
      where: { id, ...vigente(incluirBajas) },
      select: {
        puntuacion: true,
        comentario: true,
        usuarioAutorId: true,
        fechaAlta: true,
        fechaBaja: true,
        autor: { select: PERSONA },
        usuarioReportado: { select: PERSONA },
        refugioReportado: { select: { id: true, nombre: true } },
      },
    }),
  ANIMAL_PERDIDO: (id: number, incluirBajas: boolean) =>
    prisma.animalPerdido.findFirst({
      where: { id, ...vigente(incluirBajas) },
      select: {
        nombre: true,
        descripcion: true,
        imagenUrl: true,
        imagenes: true,
        provincia: true,
        localidad: true,
        referencia: true,
        fechaSuceso: true,
        fechaAlta: true,
        usuarioReportanteId: true,
        fechaBaja: true,
        estadoAnimalPerdido: { select: { nombre: true } },
        usuarioReportante: { select: PERSONA },
      },
    }),
  CAMPANIA: (id: number, incluirBajas: boolean) =>
    prisma.campania.findFirst({
      where: { id, ...vigente(incluirBajas) },
      select: {
        titulo: true,
        descripcion: true,
        objetivo: true,
        fechaInicio: true,
        fechaFin: true,
        imagenUrl: true,
        refugioId: true,
        fechaBaja: true,
        estadoCampania: { select: { nombre: true } },
        refugio: { select: { id: true, nombre: true } },
        donaciones: { where: { fechaBaja: null }, select: { monto: true } },
      },
    }),
  // `Mensaje` no tiene baja lógica (solo alta): no hay `fechaBaja` que filtrar.
  MENSAJE: (id: number) =>
    prisma.mensaje.findFirst({
      where: { id },
      select: { id: true, contenido: true, tipo: true, usuarioId: true, chatId: true },
    }),
} as const;

/**
 * Cuántos reportes tiene cada objeto de una página (spec 008): pendientes y totales, sin los
 * dados de baja. Una sola consulta agrupada; la clave es `${tipo}:${objetoId}`.
 */
export async function contarPorObjeto(pares: Array<{ tipo: TipoReporte; objetoId: number }>) {
  const filas =
    pares.length === 0
      ? []
      : await prisma.reporteProblema.groupBy({
          by: ['tipo', 'objetoId', 'resuelto'],
          where: { fechaBaja: null, OR: pares },
          _count: { _all: true },
        });

  const conteos = new Map<string, { pendientes: number; totales: number }>();
  for (const f of filas) {
    const clave = `${f.tipo}:${f.objetoId}`;
    const actual = conteos.get(clave) ?? { pendientes: 0, totales: 0 };
    actual.totales += f._count._all;
    if (!f.resuelto) actual.pendientes += f._count._all;
    conteos.set(clave, actual);
  }
  return conteos;
}

export function esParticipanteDelChat(usuarioId: number, chatId: number) {
  return prisma.usuarioChat
    .findFirst({ where: { chatId, usuarioId, fechaBaja: null }, select: { id: true } })
    .then((fila) => fila !== null);
}

/** Ventana de mensajes alrededor del reportado (spec 008): `antes` y `despues` por id. */
export async function ventanaDeMensajes(chatId: number, mensajeId: number, tamanio: number) {
  const campos = {
    id: true,
    contenido: true,
    imagenes: true,
    fechaAlta: true,
    usuario: { select: PERSONA },
  } as const;

  const [antes, centro, despues] = await Promise.all([
    prisma.mensaje.findMany({
      where: { chatId, id: { lt: mensajeId } },
      orderBy: { id: 'desc' },
      take: tamanio,
      select: campos,
    }),
    prisma.mensaje.findMany({ where: { id: mensajeId }, select: campos }),
    prisma.mensaje.findMany({
      where: { chatId, id: { gt: mensajeId } },
      orderBy: { id: 'asc' },
      take: tamanio,
      select: campos,
    }),
  ]);

  return [...antes.reverse(), ...centro, ...despues];
}
