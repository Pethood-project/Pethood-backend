import { Prisma, type Hogar } from '@prisma/client';
import { prisma } from '../../shared/prisma';
import { datosAlta, datosBaja, datosModificacion } from '../../shared/auditoria';

/**
 * Lo que necesitan tanto el resumen como el detalle de una solicitud.
 *
 * Los DOS hogares, a propósito:
 * - `hogar` es la versión que se declaró al enviar, o sea lo que el refugio evaluó.
 * - `usuario.hogares[0]` es la vigente hoy (siempre hay una sola: índice parcial
 *   `hogar_usuario_activo_uq`).
 *
 * Cuando difieren, el solicitante se mudó o corrigió sus datos después de enviar, y el
 * refugio tiene que ver las dos cosas: dónde dijo que estaría y dónde dice estar ahora.
 */
const RELACIONES_SOLICITUD = {
  publicacion: { include: { mascota: true } },
  usuario: {
    include: { hogares: { where: { fechaBaja: null }, take: 1 } },
  },
  hogar: true,
  tipoSolicitud: true,
} as const;

function historicoCompleto() {
  return {
    where: { fechaBaja: null },
    include: { estadoSolicitud: true },
    orderBy: { fechaAlta: 'desc' as const },
  };
}

export function buscarUsuarioConRefugio(usuarioId: number) {
  return prisma.usuario.findFirst({ where: { id: usuarioId, fechaBaja: null } });
}

export function buscarEstadoSolicitudPorNombre(nombre: string) {
  return prisma.estadoSolicitud.findFirst({ where: { nombre, fechaBaja: null } });
}

export function buscarTipoSolicitudPorNombre(nombre: string) {
  return prisma.tipoSolicitud.findFirst({ where: { nombre, fechaBaja: null } });
}

/**
 * La publicación sobre la que se quiere solicitar, con la mascota y su estado vigente:
 * el service necesita el dueño (para rechazar la propia) y el estado (solo se solicita
 * una mascota "Disponible").
 */
export function buscarPublicacionParaSolicitar(publicacionId: number) {
  return prisma.publicacion.findFirst({
    where: { id: publicacionId, fechaBaja: null, mascota: { fechaBaja: null } },
    include: {
      mascota: {
        include: {
          historicoEstados: {
            where: { fechaBaja: null },
            include: { estadoMascota: true },
            orderBy: { fechaAlta: 'desc' },
            take: 1,
          },
        },
      },
    },
  });
}

/**
 * Cuántas solicitudes vivas del usuario están en "Pendiente" ahora mismo. Alimenta la
 * quota anti-spam de 5 (regla transversal 7). Se cuenta sobre el estado VIGENTE del
 * histórico, no sobre `fechaRespuesta`: una "En_Revision" tampoco tiene respuesta y no
 * debe sumar al tope.
 */
export async function contarPendientesDeUsuario(usuarioId: number): Promise<number> {
  const vivas = await prisma.solicitud.findMany({
    where: { usuarioId, fechaBaja: null, fechaRespuesta: null },
    select: {
      historicoEstados: {
        where: { fechaBaja: null },
        select: { estadoSolicitud: { select: { nombre: true } } },
        orderBy: { fechaAlta: 'desc' },
        take: 1,
      },
    },
  });

  return vivas.filter((s) => s.historicoEstados[0]?.estadoSolicitud.nombre === 'Pendiente').length;
}

/**
 * Solicitud viva del usuario sobre esta publicación, sin importar en qué estado esté.
 * Evita que mande dos veces la misma mientras la primera sigue abierta.
 */
export function buscarVivaDeUsuarioEnPublicacion(usuarioId: number, publicacionId: number) {
  return prisma.solicitud.findFirst({
    where: { usuarioId, publicacionId, fechaBaja: null, fechaRespuesta: null },
    select: { id: true },
  });
}

export function buscarHogarActivo(usuarioId: number) {
  return prisma.hogar.findFirst({ where: { usuarioId, fechaBaja: null } });
}

/** Solicitud con el historial de estados completo: sirve tanto para el detalle (HU-7.5) como para resolverla (HU-7.4). */
export function buscarConDetalle(solicitudId: number) {
  return prisma.solicitud.findFirst({
    where: { id: solicitudId, fechaBaja: null },
    include: { ...RELACIONES_SOLICITUD, historicoEstados: historicoCompleto() },
  });
}

/**
 * Solicitudes que el actor puede gestionar: las de mascotas de SU refugio (cualquier
 * miembro, sin importar quién la cargó — mismo criterio que
 * `mascotas.repository.listarPorAmbito`) más las de sus propias mascotas personales
 * (un adoptante particular también puede publicar una mascota propia en adopción,
 * `mascotas.dto.ts` DESTINOS). El filtro por nombre de estado y la paginación se
 * resuelven en el service.
 */
export function listarDelActor(actor: { id: number; refugioId: number | null }) {
  const filtroMascota = actor.refugioId
    ? { OR: [{ refugioId: actor.refugioId }, { usuarioId: actor.id }] }
    : { usuarioId: actor.id };

  return prisma.solicitud.findMany({
    where: { fechaBaja: null, publicacion: { mascota: { ...filtroMascota, fechaBaja: null } } },
    include: { ...RELACIONES_SOLICITUD, historicoEstados: historicoCompleto() },
    orderBy: { fechaAlta: 'desc' },
  });
}

/** Respuestas del paso 2 ya normalizadas por el service, listas para persistir. */
export interface DatosHogar {
  direccion: string;
  tipoVivienda: string;
  espacioExterior: string;
  tienePatio: boolean;
  tieneNinios: boolean;
  tieneMascotas: boolean;
  detalleMascotas: string | null;
  experienciaPrevia: boolean;
  horasSolo: number;
  descripcion: string | null;
}

export interface DatosSolicitud {
  publicacionId: number;
  tipoSolicitudId: number;
  motivacion: string;
  fechaInicioTransito: Date | null;
  fechaFinTransito: Date | null;
}

/** Campos del hogar que definen si dos declaraciones son "la misma casa". */
const RESPUESTAS_HOGAR = [
  'direccion',
  'tipoVivienda',
  'espacioExterior',
  'tienePatio',
  'tieneNinios',
  'tieneMascotas',
  'detalleMascotas',
  'experienciaPrevia',
  'horasSolo',
  'descripcion',
] as const satisfies readonly (keyof DatosHogar)[];

/** Si el usuario respondió exactamente lo mismo que la última vez. */
function sonIguales(vigente: Hogar, declarado: DatosHogar): boolean {
  return RESPUESTAS_HOGAR.every((campo) => vigente[campo] === declarado[campo]);
}

/**
 * Alta de HU-7.1, en una sola transacción: hogar del solicitante + solicitud + primer
 * estado "Pendiente" en el histórico. Van juntos porque una solicitud sin estado vigente
 * rompe todas las lecturas del módulo (`historicoEstados[0]` es el estado actual).
 *
 * El hogar se VERSIONA, con el mismo patrón que `HistoriaClinica`: nunca se pisa una fila
 * ya declarada. Tres caminos según lo que respondió:
 *
 * - no tiene hogar todavía -> se crea el primero;
 * - respondió lo mismo que la última vez -> se reusa esa fila, sin versionar. Si no, cada
 *   solicitud dejaría una copia idéntica de la anterior;
 * - cambió algo -> baja lógica de la vigente + alta de la nueva. Sigue habiendo una sola
 *   vigente (índice parcial `hogar_usuario_activo_uq`), y las solicitudes viejas quedan
 *   apuntando a la versión que declararon.
 */
export function crearConHogar(
  usuarioId: number,
  datos: DatosSolicitud,
  hogar: DatosHogar,
  estadoPendienteId: number,
) {
  return prisma.$transaction(async (tx) => {
    const vigente = await tx.hogar.findFirst({ where: { usuarioId, fechaBaja: null } });

    let hogarId: number;

    if (!vigente) {
      hogarId = (await tx.hogar.create({ data: { ...hogar, usuarioId, ...datosAlta(usuarioId) } }))
        .id;
    } else if (sonIguales(vigente, hogar)) {
      hogarId = vigente.id;
    } else {
      // El orden importa: primero la baja, si no el índice parcial rechaza la segunda fila
      // activa del mismo usuario.
      await tx.hogar.update({ where: { id: vigente.id }, data: datosBaja(usuarioId) });
      hogarId = (await tx.hogar.create({ data: { ...hogar, usuarioId, ...datosAlta(usuarioId) } }))
        .id;
    }

    const solicitud = await tx.solicitud.create({
      data: { ...datos, usuarioId, hogarId, ...datosAlta(usuarioId) },
    });

    await tx.solicitudEstado.create({
      data: {
        solicitudId: solicitud.id,
        estadoSolicitudId: estadoPendienteId,
        ...datosAlta(usuarioId),
      },
    });

    return tx.solicitud.findFirstOrThrow({
      where: { id: solicitud.id },
      include: { ...RELACIONES_SOLICITUD, historicoEstados: historicoCompleto() },
    });
  });
}

/** Historial propio del solicitante (HU-7.3). El filtro y la paginación van en el service. */
export function listarDelSolicitante(usuarioId: number) {
  return prisma.solicitud.findMany({
    where: { usuarioId, fechaBaja: null },
    include: { ...RELACIONES_SOLICITUD, historicoEstados: historicoCompleto() },
    orderBy: { fechaAlta: 'desc' },
  });
}

/**
 * Resuelve la solicitud SI Y SOLO SI sigue "Pendiente" en el momento de la escritura,
 * atómicamente: aislamiento Serializable para que dos PATCH concurrentes sobre la misma
 * solicitud no puedan pisarse (uno gana, el otro recibe `null` y el service lo traduce a
 * `409 SOLICITUD_YA_RESUELTA` en vez de dejar el histórico inconsistente).
 *
 * Devuelve `null` en vez de tirar un error de Prisma: quien pierde la carrera no rompió
 * nada, solo llegó tarde — es el mismo caso que "ya estaba resuelta" que valida el service
 * antes de llamar acá, así que ambos caminos terminan en el mismo 409.
 */
export async function resolverSiPendiente(
  solicitudId: number,
  estadoSolicitudId: number,
  comentario: string | null,
  usuarioId: number,
) {
  try {
    return await prisma.$transaction(
      async (tx) => {
        const vigente = await tx.solicitudEstado.findFirst({
          where: { solicitudId, fechaBaja: null },
          orderBy: { fechaAlta: 'desc' },
          include: { estadoSolicitud: true },
        });

        if (vigente?.estadoSolicitud.nombre !== 'Pendiente') {
          return null;
        }

        await tx.solicitud.update({
          where: { id: solicitudId },
          data: { comentario, fechaRespuesta: new Date(), ...datosModificacion(usuarioId) },
        });

        await tx.solicitudEstado.create({
          data: { solicitudId, estadoSolicitudId, ...datosAlta(usuarioId) },
        });

        return tx.solicitud.findFirstOrThrow({
          where: { id: solicitudId },
          include: { ...RELACIONES_SOLICITUD, historicoEstados: historicoCompleto() },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  } catch (err) {
    // P2034 = conflicto de serialización: el otro PATCH concurrente confirmó primero.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2034') {
      return null;
    }
    throw err;
  }
}

/**
 * Todas las solicitudes vivas sin respuesta, con el tipo (para `secuenciaDias`) y el
 * estado vigente. `fechaRespuesta: null` es un filtro de performance, no la fuente de
 * verdad: quien decide si sigue "Pendiente" es el service, mirando `historicoEstados[0]`
 * — así una solicitud "En_Revision" (tampoco tiene respuesta todavía) no se cuela.
 * Usado por el cron de HU-7.6.
 */
export function listarSinRespuesta() {
  return prisma.solicitud.findMany({
    where: { fechaBaja: null, fechaRespuesta: null },
    include: {
      tipoSolicitud: true,
      historicoEstados: {
        where: { fechaBaja: null },
        include: { estadoSolicitud: true },
        orderBy: { fechaAlta: 'desc' },
        take: 1,
      },
    },
  });
}

/**
 * Cancelación automática de HU-7.6: baja lógica de la solicitud + nuevo estado
 * "Cancelada" en el histórico, SI Y SOLO SI sigue "Pendiente" al momento de escribir
 * (mismo aislamiento Serializable que `resolverSiPendiente`, para no cancelar algo que un
 * refugio acaba de aceptar/rechazar un instante antes de que corra el cron).
 */
export async function cancelarSiPendiente(
  solicitudId: number,
  estadoCanceladaId: number,
  usuarioId: number,
): Promise<boolean> {
  try {
    return await prisma.$transaction(
      async (tx) => {
        const vigente = await tx.solicitudEstado.findFirst({
          where: { solicitudId, fechaBaja: null },
          orderBy: { fechaAlta: 'desc' },
          include: { estadoSolicitud: true },
        });

        if (vigente?.estadoSolicitud.nombre !== 'Pendiente') {
          return false;
        }

        await tx.solicitud.update({
          where: { id: solicitudId },
          data: datosBaja(usuarioId),
        });

        await tx.solicitudEstado.create({
          data: { solicitudId, estadoSolicitudId: estadoCanceladaId, ...datosAlta(usuarioId) },
        });

        return true;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2034') {
      return false;
    }
    throw err;
  }
}
