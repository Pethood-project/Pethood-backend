/**
 * Sistema de Reputación (Módulo 10).
 *
 * Una reseña la habilita una transacción CONCRETADA: por eso se guarda `solicitudId` y se
 * exige que su estado vigente sea "Aprobada". Sin esa precondición no se puede impedir que
 * dos desconocidos se reseñen ni validar quién es la contraparte.
 *
 * El autor y el receptor nunca los elige el cliente: se derivan de la transacción. Las dos
 * partes de una solicitud son su solicitante y quien publicó la mascota; el receptor es
 * siempre "el otro". Eso cubre los flujos de HU-10.2 a HU-10.4:
 * - adoptante (solicitante) → refugio o adoptante particular;
 * - refugio o adoptante publicador → adoptante (solicitante);
 * - refugio → hogar de tránsito (solicitante de una solicitud de tipo Transito).
 *
 * Solo alta y baja lógica: nunca se edita el contenido de una reseña ya creada (HU-10.6).
 */
import { AppError } from '../../middlewares/errorHandler';
import { registrarAuditoria } from '../../shared/logAuditoria';
import type {
  CrearResenaDto,
  FlujoResena,
  ResenaDto,
  ResumenResenasDto,
  TransaccionElegibleDto,
} from './resenas.dto';
import * as repo from './resenas.repository';

type ResenaConAutor = Awaited<ReturnType<typeof repo.listarDeUsuario>>[number];
type TransaccionDelActor = Awaited<ReturnType<typeof repo.listarTransaccionesDelActor>>[number];

/** Una transacción habilita reseña solo si su estado VIGENTE es este. */
const ESTADO_TRANSACCION_CONCRETADA = 'Aprobada';

/**
 * Deriva el flujo de la reseña a partir de la transacción y de quién es el receptor.
 * `null` cuando la reseña es histórica y no tiene solicitud asociada.
 */
function calcularFlujo(
  solicitud: ResenaConAutor['solicitud'],
  autorId: number,
  receptorEsRefugio: boolean,
): FlujoResena | null {
  if (!solicitud) return null;

  const autorEsSolicitante = solicitud.usuarioId === autorId;
  const tipoSolicitud = solicitud.tipoSolicitud.nombre;

  if (autorEsSolicitante) {
    return receptorEsRefugio ? 'ADOPTANTE_A_REFUGIO' : 'ADOPTANTE_A_ADOPTANTE';
  }

  // Autor del lado que publicó: si la mascota es de un refugio, la reseña sale del refugio.
  const autorEsRefugio = solicitud.publicacion.mascota.refugioId !== null;

  if (autorEsRefugio) {
    return tipoSolicitud === 'Transito' ? 'REFUGIO_A_TRANSITO' : 'REFUGIO_A_ADOPTANTE';
  }

  return 'ADOPTANTE_A_ADOPTANTE';
}

function aResenaDto(resena: ResenaConAutor): ResenaDto {
  const receptorEsRefugio = resena.refugioReportadoId !== null;

  return {
    id: resena.id,
    puntuacion: resena.puntuacion,
    comentario: resena.comentario,
    fecha: resena.fechaAlta.toISOString(),
    autor: {
      id: resena.autor.id,
      nombre: resena.autor.nombre,
      apellido: resena.autor.apellido,
      imagenUrl: resena.autor.imagenUrl,
    },
    receptor: receptorEsRefugio ? 'REFUGIO' : 'PERSONA',
    flujo: calcularFlujo(resena.solicitud, resena.usuarioAutorId, receptorEsRefugio),
  };
}

/**
 * Promedio (redondeado a un decimal), cantidad, desglose y reseñas. Se calcula sobre la
 * lista ya traída: el volumen por usuario o refugio es chico y así el desglose y el listado
 * no pueden discrepar.
 */
function resumir(resenas: ResenaConAutor[]): ResumenResenasDto {
  const cantidad = resenas.length;
  const total = resenas.reduce((suma, resena) => suma + resena.puntuacion, 0);

  return {
    promedio: cantidad === 0 ? null : Math.round((total / cantidad) * 10) / 10,
    cantidad,
    distribucion: [5, 4, 3, 2, 1].map((puntuacion) => ({
      puntuacion,
      cantidad: resenas.filter((resena) => resena.puntuacion === puntuacion).length,
    })),
    resenas: resenas.map(aResenaDto),
  };
}

/** HU-10.1. Registra la reseña, validando que la transacción exista, esté concretada y que
 * el autor sea una de sus partes. */
export async function crearResena(datos: CrearResenaDto, usuarioId: number): Promise<ResenaDto> {
  const actor = await repo.buscarUsuario(usuarioId);

  if (!actor) {
    throw new AppError('NO_ENCONTRADO', 'El usuario no existe', 404);
  }

  const solicitud = await repo.buscarSolicitudConPartes(datos.solicitudId);

  if (!solicitud) {
    throw new AppError('NO_ENCONTRADO', 'La solicitud no existe', 404);
  }

  const estadoVigente = solicitud.historicoEstados[0]?.estadoSolicitud.nombre;
  if (estadoVigente !== ESTADO_TRANSACCION_CONCRETADA) {
    throw new AppError(
      'TRANSACCION_NO_FINALIZADA',
      'Solo podés reseñar una adopción o un tránsito ya concretado',
      409,
    );
  }

  const mascota = solicitud.publicacion.mascota;
  const autorEsSolicitante = solicitud.usuarioId === actor.id;
  const autorEsRefugio = mascota.refugioId !== null && actor.refugioId === mascota.refugioId;
  const autorEsPublicadorPersonal = mascota.refugioId === null && mascota.usuarioId === actor.id;

  if (!autorEsSolicitante && !autorEsRefugio && !autorEsPublicadorPersonal) {
    throw new AppError('NO_PARTICIPA', 'No participaste de esta transacción', 403);
  }

  // El receptor es siempre la contraparte. Cuando reseña el solicitante, mira a quien
  // publicó (refugio o persona); cuando reseña quien publicó, mira al solicitante.
  let refugioReportadoId: number | null = null;
  let usuarioReportadoId: number | null = null;

  if (autorEsSolicitante) {
    if (mascota.refugioId !== null) {
      refugioReportadoId = mascota.refugioId;
    } else {
      usuarioReportadoId = mascota.usuarioId;
    }
  } else {
    usuarioReportadoId = solicitud.usuarioId;
  }

  if (usuarioReportadoId !== null && usuarioReportadoId === actor.id) {
    throw new AppError('RESENA_PROPIA', 'No podés reseñarte a vos mismo', 403);
  }

  if (await repo.buscarActivaDeAutor(datos.solicitudId, actor.id)) {
    throw new AppError('RESENA_DUPLICADA', 'Ya reseñaste esta transacción', 409);
  }

  const creada = await repo.crear({
    puntuacion: datos.puntuacion,
    comentario: datos.comentario,
    usuarioAutorId: actor.id,
    refugioReportadoId,
    usuarioReportadoId,
    solicitudId: datos.solicitudId,
  });

  await registrarAuditoria({
    usuarioId: actor.id,
    accion: 'CREAR',
    entidad: 'Resena',
    entidadId: creada.id,
    detalle: `solicitud ${datos.solicitudId} · ${datos.puntuacion}★`,
  });

  return aResenaDto(creada);
}

/** HU-10.5. Historial y promedio de una persona (adoptante o quien ofreció tránsito). */
export async function listarDeUsuario(usuarioId: number): Promise<ResumenResenasDto> {
  const usuario = await repo.buscarUsuario(usuarioId);

  if (!usuario) {
    throw new AppError('NO_ENCONTRADO', 'El usuario no existe', 404);
  }

  return resumir(await repo.listarDeUsuario(usuarioId));
}

/** HU-10.5. Historial y promedio de un refugio. */
export async function listarDeRefugio(refugioId: number): Promise<ResumenResenasDto> {
  return resumir(await repo.listarDeRefugio(refugioId));
}

/**
 * Transacciones concretadas que el usuario todavía no reseñó, desde el perfil activo. Es lo
 * que habilita el botón "Reseñar" y de dónde el modal saca a quién se está valorando.
 */
export async function listarElegibles(usuarioId: number): Promise<TransaccionElegibleDto[]> {
  const actor = await repo.buscarUsuario(usuarioId);

  if (!actor) {
    throw new AppError('NO_ENCONTRADO', 'El usuario no existe', 404);
  }

  const transacciones = await repo.listarTransaccionesDelActor(actor.id, actor.refugioId);

  const concretadas = transacciones.filter(
    (transaccion) =>
      transaccion.historicoEstados[0]?.estadoSolicitud.nombre === ESTADO_TRANSACCION_CONCRETADA,
  );

  const resenadas = await repo.listarSolicitudesResenadas(
    actor.id,
    concretadas.map((transaccion) => transaccion.id),
  );
  const idsResenados = new Set(resenadas.map((fila) => fila.solicitudId));

  return concretadas
    .filter((transaccion) => !idsResenados.has(transaccion.id))
    .map((transaccion) => aElegibleDto(transaccion, actor.id));
}

function aElegibleDto(
  transaccion: TransaccionDelActor,
  usuarioId: number,
): TransaccionElegibleDto {
  const mascota = transaccion.publicacion.mascota;
  const autorEsSolicitante = transaccion.usuarioId === usuarioId;
  const tipoSolicitud = transaccion.tipoSolicitud.nombre;

  let contraparte: TransaccionElegibleDto['contraparte'];
  let flujo: FlujoResena;

  if (autorEsSolicitante && mascota.refugio) {
    contraparte = {
      tipo: 'REFUGIO',
      id: mascota.refugio.id,
      nombre: mascota.refugio.nombre,
      imagenUrl: mascota.refugio.imagenUrl,
    };
    flujo = 'ADOPTANTE_A_REFUGIO';
  } else if (autorEsSolicitante) {
    contraparte = {
      tipo: 'PERSONA',
      id: mascota.usuario.id,
      nombre: `${mascota.usuario.nombre} ${mascota.usuario.apellido}`,
      imagenUrl: mascota.usuario.imagenUrl,
    };
    flujo = 'ADOPTANTE_A_ADOPTANTE';
  } else if (mascota.refugio) {
    contraparte = {
      tipo: 'PERSONA',
      id: transaccion.usuario.id,
      nombre: `${transaccion.usuario.nombre} ${transaccion.usuario.apellido}`,
      imagenUrl: transaccion.usuario.imagenUrl,
    };
    flujo = tipoSolicitud === 'Transito' ? 'REFUGIO_A_TRANSITO' : 'REFUGIO_A_ADOPTANTE';
  } else {
    contraparte = {
      tipo: 'PERSONA',
      id: transaccion.usuario.id,
      nombre: `${transaccion.usuario.nombre} ${transaccion.usuario.apellido}`,
      imagenUrl: transaccion.usuario.imagenUrl,
    };
    flujo = 'ADOPTANTE_A_ADOPTANTE';
  }

  return {
    solicitudId: transaccion.id,
    tipoSolicitud,
    fecha: transaccion.fechaAlta.toISOString(),
    mascota: {
      id: mascota.id,
      nombre: mascota.nombre,
      imagenUrl: mascota.imagenUrl,
    },
    contraparte,
    flujo,
  };
}

/** HU-10.6 (admin). Baja lógica de una reseña reportada. Nunca se edita su contenido. */
export async function darDeBaja(resenaId: number, adminId: number): Promise<void> {
  const resena = await repo.buscarResena(resenaId);

  if (!resena) {
    throw new AppError('NO_ENCONTRADO', 'La reseña no existe', 404);
  }

  await repo.darDeBaja(resenaId, adminId);

  await registrarAuditoria({
    usuarioId: adminId,
    accion: 'BAJA',
    entidad: 'Resena',
    entidadId: resenaId,
    detalle: `Reseña de ${resena.puntuacion}★`,
  });
}
