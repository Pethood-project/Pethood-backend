import { Prisma, type Hogar, type Mascota, type MotivoSolicitud } from '@prisma/client';
import { prisma } from '../../shared/prisma';
import type { Ambito } from '../../shared/ambito';
import { datosAlta, datosBaja, datosModificacion } from '../../shared/auditoria';
import { estaAbierta, type NombreEstadoSolicitud } from '../../shared/requestStates';

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
  publicacion: {
    include: {
      // Quién publicó, para decirle a la persona de quién espera respuesta: el refugio, o la
      // persona si la mascota es particular.
      mascota: { include: { refugio: { select: { id: true, nombre: true, imagenUrl: true } } } },
      usuario: { select: { id: true, nombre: true, apellido: true, imagenUrl: true } },
    },
  },
  usuario: {
    include: { hogares: { where: { fechaBaja: null }, take: 1 } },
  },
  hogar: true,
  tipoSolicitud: true,
  respuestas: { where: { fechaBaja: null }, orderBy: { orden: 'asc' as const } },
} as const;

function historicoCompleto() {
  return {
    where: { fechaBaja: null },
    include: { estadoSolicitud: true },
    orderBy: { fechaAlta: 'desc' as const },
  };
}

/** Solo el estado vigente (la fila más nueva del histórico), para decidir si está abierta. */
const SOLO_VIGENTE = {
  where: { fechaBaja: null },
  select: { estadoSolicitud: { select: { nombre: true } } },
  orderBy: { fechaAlta: 'desc' as const },
  take: 1,
};

/** Solicitudes abiertas de una publicación, sin contar `excluirSolicitudId` si se pasa. */
export async function listarAbiertasDePublicacion(
  publicacionId: number,
  excluirSolicitudId?: number,
): Promise<{ id: number; usuarioId: number }[]> {
  const solicitudes = await prisma.solicitud.findMany({
    where: {
      publicacionId,
      fechaBaja: null,
      ...(excluirSolicitudId === undefined ? {} : { id: { not: excluirSolicitudId } }),
    },
    select: { id: true, usuarioId: true, historicoEstados: SOLO_VIGENTE },
  });

  return solicitudes
    .filter((s) => estaAbierta(s.historicoEstados[0]?.estadoSolicitud.nombre))
    .map(({ id, usuarioId }) => ({ id, usuarioId }));
}

/** Ids de los miembros activos de un refugio — a quién avisarle algo del lado publicador. */
export function listarIdsMiembrosDeRefugio(refugioId: number): Promise<{ id: number }[]> {
  return prisma.usuario.findMany({
    where: { refugioId, fechaBaja: null },
    select: { id: true },
  });
}

export function buscarUsuarioConRefugio(usuarioId: number) {
  return prisma.usuario.findFirst({ where: { id: usuarioId, fechaBaja: null } });
}

export function buscarEstadoSolicitudPorNombre(nombre: string) {
  return prisma.estadoSolicitud.findFirst({ where: { nombre, fechaBaja: null } });
}

export function buscarEstadoMascotaPorNombre(nombre: string) {
  return prisma.estadoMascota.findFirst({ where: { nombre, fechaBaja: null } });
}

export function buscarEstadoPublicacionPorNombre(nombre: string) {
  return prisma.estadoPublicacion.findFirst({ where: { nombre, fechaBaja: null } });
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
      historicoEstados: {
        where: { fechaBaja: null },
        include: { estadoPublicacion: true },
        orderBy: { fechaAlta: 'desc' },
        take: 1,
      },
      mascota: {
        include: {
          // La especie decide qué preguntas del refugio le tocan a quien solicita.
          raza: { select: { especieId: true } },
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
 * Cuántas solicitudes abiertas tiene el usuario ahora mismo, en cualquier etapa. Alimenta la
 * quota anti-spam de 5. Se cuenta sobre el estado vigente del histórico: las finales no
 * suman.
 */
export async function contarAbiertasDeUsuario(usuarioId: number): Promise<number> {
  const solicitudes = await prisma.solicitud.findMany({
    where: { usuarioId, fechaBaja: null },
    select: { historicoEstados: SOLO_VIGENTE },
  });

  return solicitudes.filter((s) => estaAbierta(s.historicoEstados[0]?.estadoSolicitud.nombre))
    .length;
}

/**
 * Solicitud abierta del usuario sobre esta publicación. Evita que mande dos veces la misma
 * mientras la primera sigue abierta; una retirada, cerrada o ya resuelta no cuenta.
 */
export async function buscarAbiertaDeUsuarioEnPublicacion(
  usuarioId: number,
  publicacionId: number,
): Promise<{ id: number } | null> {
  const solicitudes = await prisma.solicitud.findMany({
    where: { usuarioId, publicacionId, fechaBaja: null },
    select: { id: true, historicoEstados: SOLO_VIGENTE },
  });

  const abierta = solicitudes.find((s) =>
    estaAbierta(s.historicoEstados[0]?.estadoSolicitud.nombre),
  );

  return abierta ? { id: abierta.id } : null;
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
 * Solicitudes que el actor puede gestionar desde el perfil en el que está parado (ver
 * `shared/ambito.ts`):
 * - REFUGIO: las de mascotas de SU refugio (cualquier miembro, sin importar quién la
 *   cargó — mismo criterio que `mascotas.repository.listarPorAmbito`).
 * - PERSONAL: las de sus mascotas personales (un adoptante particular también puede
 *   publicar una mascota propia en adopción, `mascotas.dto.ts` DESTINOS).
 * El filtro por nombre de estado y la paginación se resuelven en el service.
 */
export function listarDelActor(actor: { id: number; refugioId: number | null; ambito: Ambito }) {
  // `autenticar` ya garantiza que REFUGIO llega de un miembro; el `-1` solo cubre un
  // refugio desasignado después del login, y no matchea ninguna fila.
  const filtroMascota =
    actor.ambito === 'REFUGIO'
      ? { refugioId: actor.refugioId ?? -1 }
      : { usuarioId: actor.id, refugioId: null };

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

/** Una respuesta ya validada, con la copia del texto que se le preguntó a la persona. */
export interface DatosRespuesta {
  preguntaAdopcionId: number;
  preguntaTexto: string;
  respuesta: string;
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
  respuestas: DatosRespuesta[] = [],
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

    if (respuestas.length > 0) {
      await tx.solicitudRespuesta.createMany({
        data: respuestas.map((respuesta, orden) => ({
          ...respuesta,
          solicitudId: solicitud.id,
          orden,
          ...datosAlta(usuarioId),
        })),
      });
    }

    return tx.solicitud.findFirstOrThrow({
      where: { id: solicitud.id },
      include: { ...RELACIONES_SOLICITUD, historicoEstados: historicoCompleto() },
    });
  });
}

/** Guarda (o borra, con `null`) la nota privada de quien publicó. La última escritura gana. */
export function guardarNota(solicitudId: number, texto: string | null, usuarioId: number) {
  return prisma.solicitud.update({
    where: { id: solicitudId },
    data: { notaInterna: texto, ...datosModificacion(usuarioId) },
    include: { ...RELACIONES_SOLICITUD, historicoEstados: historicoCompleto() },
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

export interface Transicion {
  /** Estados vigentes desde los que se acepta el cambio. */
  desde: readonly NombreEstadoSolicitud[];
  estadoId: number;
  /** Causa, en los estados finales que la llevan. */
  motivo?: MotivoSolicitud;
  usuarioId: number;
  /** Respuesta del refugio (Aprobada y Rechazada): su comentario y la fecha en que respondió. */
  respuesta?: { comentario: string | null };
}

/**
 * Pasa la solicitud a otro estado SI Y SOLO SI el vigente sigue siendo uno de `desde` en el
 * momento de escribir. Es atómico (Serializable): si dos acciones compiten sobre la misma
 * solicitud gana una y la otra recibe `null`, que el service traduce a un 409.
 *
 * Devuelve `null` en vez de tirar un error de Prisma: quien pierde la carrera no rompió
 * nada, solo llegó tarde.
 */
export async function transicionar(solicitudId: number, transicion: Transicion) {
  try {
    return await prisma.$transaction(
      async (tx) => {
        const vigente = await tx.solicitudEstado.findFirst({
          where: { solicitudId, fechaBaja: null },
          orderBy: { fechaAlta: 'desc' },
          include: { estadoSolicitud: true },
        });

        const nombre = vigente?.estadoSolicitud.nombre as NombreEstadoSolicitud | undefined;
        if (!nombre || !transicion.desde.includes(nombre)) {
          return null;
        }

        await tx.solicitud.update({
          where: { id: solicitudId },
          data: {
            ...(transicion.respuesta
              ? { comentario: transicion.respuesta.comentario, fechaRespuesta: new Date() }
              : {}),
            ...datosModificacion(transicion.usuarioId),
          },
        });

        await tx.solicitudEstado.create({
          data: {
            solicitudId,
            estadoSolicitudId: transicion.estadoId,
            motivo: transicion.motivo ?? null,
            ...datosAlta(transicion.usuarioId),
          },
        });

        return tx.solicitud.findFirstOrThrow({
          where: { id: solicitudId },
          include: { ...RELACIONES_SOLICITUD, historicoEstados: historicoCompleto() },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  } catch (err) {
    // P2034 = conflicto de serialización: la otra escritura concurrente confirmó primero.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2034') {
      return null;
    }
    throw err;
  }
}

/**
 * Las solicitudes que pueden estar abiertas, con el detalle para avisar a las dos puntas.
 * `fechaRespuesta: null` es solo un filtro de performance (una abierta nunca respondió): quien
 * decide si sigue abierta es el service, mirando el estado vigente.
 */
export function listarSinRespuestaConDetalle() {
  return prisma.solicitud.findMany({
    where: { fechaBaja: null, fechaRespuesta: null },
    include: {
      ...RELACIONES_SOLICITUD,
      historicoEstados: historicoCompleto(),
    },
  });
}

/** Solicitudes de tránsito aprobadas, con fechas — para el job de tránsitos (spec 004). */
export function listarTransitosAprobados() {
  return prisma.solicitud.findMany({
    where: {
      fechaBaja: null,
      tipoSolicitud: { nombre: 'Transito' },
      fechaInicioTransito: { not: null },
      fechaFinTransito: { not: null },
      historicoEstados: { some: { fechaBaja: null, estadoSolicitud: { nombre: 'Aprobada' } } },
    },
    include: { ...RELACIONES_SOLICITUD, historicoEstados: historicoCompleto() },
  });
}

/** Datos de la mascota publicada que se copian a la mascota propia del adoptante. */
export type MascotaAdoptada = Pick<
  Mascota,
  | 'nombre'
  | 'fechaNacimiento'
  | 'genero'
  | 'peso'
  | 'tamanio'
  | 'castrado'
  | 'desparasitado'
  | 'descripcion'
  | 'imagenUrl'
  | 'razaId'
>;

export interface DatosAprobacionAdopcion {
  estadoAprobadaId: number;
  estadoCerradaId: number;
  estadoMascotaAdoptadoId: number;
  estadoPublicacionFinalizadaId: number;
  comentario: string | null;
  publicacionId: number;
  mascotaOrigenId: number;
  mascotaOrigen: MascotaAdoptada;
  adoptanteId: number;
}

export interface ResultadoAprobacionAdopcion {
  solicitud: NonNullable<Awaited<ReturnType<typeof buscarConDetalle>>>;
  mascotaAdoptadaId: number;
  solicitudesCerradas: number[];
}

/**
 * Aprobación de una adopción, en una sola transacción Serializable. Además de resolver la
 * solicitud, todo lo que tiene que pasar junta para no dejar el sistema a medias:
 *
 * 1. aprueba la solicitud, si sigue "Revisada" al escribir;
 * 2. crea para el adoptante una mascota propia (sin refugio) con estado "Adoptado",
 *    copiando los datos de la mascota publicada;
 * 3. pasa la mascota ORIGINAL a "Adoptado" (baja de su estado vigente + alta del nuevo);
 * 4. finaliza la publicación del aviso (baja del estado vigente + alta de "Finalizada");
 * 5. cierra las demás solicitudes abiertas de esa publicación, en la etapa que estén.
 *
 * Devuelve `null` si la solicitud ya no está "Revisada" al escribir (otra acción ganó la
 * carrera). Los ids de catálogo los resuelve el servicio.
 */
export async function aprobarAdopcion(
  solicitudId: number,
  usuarioId: number,
  datos: DatosAprobacionAdopcion,
): Promise<ResultadoAprobacionAdopcion | null> {
  try {
    return await prisma.$transaction(
      async (tx) => {
        const vigente = await tx.solicitudEstado.findFirst({
          where: { solicitudId, fechaBaja: null },
          orderBy: { fechaAlta: 'desc' },
          include: { estadoSolicitud: true },
        });

        if (vigente?.estadoSolicitud.nombre !== 'Revisada') {
          return null;
        }

        // 1. Resolver la solicitud aprobada.
        await tx.solicitud.update({
          where: { id: solicitudId },
          data: {
            comentario: datos.comentario,
            fechaRespuesta: new Date(),
            ...datosModificacion(usuarioId),
          },
        });

        await tx.solicitudEstado.create({
          data: { solicitudId, estadoSolicitudId: datos.estadoAprobadaId, ...datosAlta(usuarioId) },
        });

        // 2. Mascota nueva del adoptante: propia (sin refugio) y "Adoptado".
        const adoptada = await tx.mascota.create({
          data: {
            ...datos.mascotaOrigen,
            usuarioId: datos.adoptanteId,
            refugioId: null,
            ...datosAlta(usuarioId),
            historicoEstados: {
              create: { estadoMascotaId: datos.estadoMascotaAdoptadoId, ...datosAlta(usuarioId) },
            },
          },
        });

        // La solicitud recuerda la mascota que nació de ella.
        await tx.solicitud.update({
          where: { id: solicitudId },
          data: { mascotaAdoptadaId: adoptada.id },
        });

        // 3. Mascota original -> "Adoptado". Mismo patrón baja+alta que PublicacionEstado,
        //    para mantener una sola fila vigente.
        await tx.mascotaEstado.updateMany({
          where: { mascotaId: datos.mascotaOrigenId, fechaBaja: null },
          data: datosBaja(usuarioId),
        });

        await tx.mascotaEstado.create({
          data: {
            mascotaId: datos.mascotaOrigenId,
            estadoMascotaId: datos.estadoMascotaAdoptadoId,
            ...datosAlta(usuarioId),
          },
        });

        // 4. Publicación -> "Finalizada", salvo que ya lo esté (idempotente).
        const publicacionVigente = await tx.publicacionEstado.findFirst({
          where: { publicacionId: datos.publicacionId, fechaBaja: null },
          orderBy: { fechaAlta: 'desc' },
          include: { estadoPublicacion: true },
        });

        if (publicacionVigente?.estadoPublicacion.nombre !== 'Finalizada') {
          await tx.publicacionEstado.updateMany({
            where: { publicacionId: datos.publicacionId, fechaBaja: null },
            data: datosBaja(usuarioId),
          });

          await tx.publicacionEstado.create({
            data: {
              publicacionId: datos.publicacionId,
              estadoPublicacionId: datos.estadoPublicacionFinalizadaId,
              ...datosAlta(usuarioId),
            },
          });
        }

        // 5. Cerrar las otras solicitudes abiertas de la publicación. El estado vigente es el
        //    de la fila activa más nueva, como en todo el módulo.
        const candidatas = await tx.solicitud.findMany({
          where: { publicacionId: datos.publicacionId, fechaBaja: null, id: { not: solicitudId } },
          select: { id: true, historicoEstados: SOLO_VIGENTE },
        });

        const abiertas = candidatas.filter((s) =>
          estaAbierta(s.historicoEstados[0]?.estadoSolicitud.nombre),
        );

        for (const abierta of abiertas) {
          await tx.solicitud.update({
            where: { id: abierta.id },
            data: datosModificacion(usuarioId),
          });

          await tx.solicitudEstado.create({
            data: {
              solicitudId: abierta.id,
              estadoSolicitudId: datos.estadoCerradaId,
              motivo: 'ADOPTADA_POR_OTRA_PERSONA',
              ...datosAlta(usuarioId),
            },
          });
        }

        const solicitud = await tx.solicitud.findFirstOrThrow({
          where: { id: solicitudId },
          include: { ...RELACIONES_SOLICITUD, historicoEstados: historicoCompleto() },
        });

        return {
          solicitud,
          mascotaAdoptadaId: adoptada.id,
          solicitudesCerradas: abiertas.map((s) => s.id),
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2034') {
      return null;
    }
    throw err;
  }
}
