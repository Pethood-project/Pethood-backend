/**
 * Módulo de Solicitud, de las dos puntas:
 * - lado solicitante: crearla (HU-7.1) y ver su historial (HU-7.3).
 * - lado de quien publicó la mascota: resolverla (HU-7.4) y ver lo recibido (HU-7.5).
 *
 * "Quien publicó la mascota" no es siempre un refugio: un adoptante particular también
 * puede ofrecer una mascota propia en adopción (`mascotas.dto.ts`, actor ADOPTANTE +
 * destino ADOPCION). Por eso la autorización se resuelve por actor, no por rol:
 * - mascota de un refugio (`refugioId` no nulo) -> cualquier miembro de ESE refugio, desde
 *   la vista de refugio; igual criterio que `mascotas.repository.listarPorAmbito` y el
 *   dashboard de refugio.
 * - mascota personal (`refugioId` nulo) -> solo quien la publicó, desde su perfil personal.
 *
 * Solicitar (y ver lo solicitado) es siempre del perfil personal: desde la vista de refugio
 * no se adopta. Ver `shared/ambito.ts`.
 */
import { FLAGS } from '../../config/flags';
import { AppError } from '../../middlewares/errorHandler';
import { esSolicitudDemorada } from '../../shared/alertasRefugio';
import * as chats from '../chats/chats.service';
import * as favoritos from '../favoritos/favoritos.service';
import * as notificaciones from '../notificaciones/notificaciones.service';
import { esMascotaDelAmbito, esMascotaPropia, type Ambito } from '../../shared/ambito';
import { aFechaISO, finDelDia } from '../../shared/validation/dates';
import { registrarAuditoria } from '../../shared/logAuditoria';
import type {
  CambioDeHogarDto,
  CrearSolicitudDto,
  ElegibilidadDto,
  FiltrosMiasDto,
  FiltrosRecibidasDto,
  HogarDto,
  HogarSolicitanteDto,
  ListaSolicitudesRecibidasDto,
  PeriodoTransitoDto,
  ResolverSolicitudDto,
  SolicitudCreadaDto,
  SolicitudDetalleDto,
  SolicitudResumenDto,
} from './solicitudes.dto';
import * as repo from './solicitudes.repository';

type Actor = { id: number; refugioId: number | null; ambito: Ambito };
type SolicitudConDetalle = NonNullable<Awaited<ReturnType<typeof repo.buscarConDetalle>>>;
type MascotaDeSolicitud = SolicitudConDetalle['publicacion']['mascota'];

async function resolverActor(usuarioId: number, ambito: Ambito): Promise<Actor> {
  const usuario = await repo.buscarUsuarioConRefugio(usuarioId);

  if (!usuario) {
    throw new AppError('NO_ENCONTRADO', 'El usuario no existe', 404);
  }

  return { id: usuario.id, refugioId: usuario.refugioId, ambito };
}

function esPropiaDelActor(mascota: MascotaDeSolicitud, actor: Actor): boolean {
  return esMascotaDelAmbito(mascota, actor, actor.ambito);
}

/**
 * La solicitud tiene que existir y el actor tiene que poder verla con el criterio que se
 * le pase. Un actor que no cumple recibe el mismo 404 que si no existiera: no hay que
 * revelarle a un tercero que la solicitud sí existe.
 */
async function exigirSolicitud(
  solicitudId: number,
  puedeVerla: (solicitud: SolicitudConDetalle) => boolean,
): Promise<SolicitudConDetalle> {
  const solicitud = await repo.buscarConDetalle(solicitudId);

  if (!solicitud || !puedeVerla(solicitud)) {
    throw new AppError('NO_ENCONTRADO', 'La solicitud no existe', 404);
  }

  return solicitud;
}

/** Solo quien publicó la mascota resuelve (HU-7.4) y ve lo recibido (HU-7.5). */
const gestionablePor =
  (actor: Actor) =>
  (solicitud: SolicitudConDetalle): boolean =>
    esPropiaDelActor(solicitud.publicacion.mascota, actor);

/**
 * El detalle lo ven las dos puntas: quien publicó la mascota (HU-7.5) y el propio
 * solicitante, que necesita seguir el estado de lo que mandó (HU-7.3, GUI "Mi Solicitud").
 * Lo que mandó lo ve desde su perfil personal, que es desde donde se solicita.
 */
const visiblePor =
  (actor: Actor) =>
  (solicitud: SolicitudConDetalle): boolean =>
    (actor.ambito === 'PERSONAL' && solicitud.usuarioId === actor.id) ||
    esPropiaDelActor(solicitud.publicacion.mascota, actor);

/**
 * A quién avisarle algo del lado de quien publicó la mascota (spec 004): todos los miembros
 * activos si es de un refugio, o solo el publicador si la mascota es personal — mismo
 * criterio que ya resuelve `chats.service.ts` para abrir la sala.
 */
/** Para `publicaciones.service.ts` (spec 004): a quién avisarle si esta publicación se pausa/da de baja. */
export function listarPendientesDePublicacion(
  publicacionId: number,
): Promise<{ id: number; usuarioId: number }[]> {
  return repo.listarPendientesDePublicacion(publicacionId);
}

export async function destinatariosPublicador(
  mascota: {
    refugioId: number | null;
  },
  publicacionUsuarioId: number,
): Promise<number[]> {
  if (mascota.refugioId === null) return [publicacionUsuarioId];

  const miembros = await repo.listarIdsMiembrosDeRefugio(mascota.refugioId);
  return miembros.map((m) => m.id);
}

/**
 * El período va como `AAAA-MM-DD` y no como instante ISO: es un día del calendario, y un
 * `toISOString()` lo correría al día anterior en cualquier timezone negativa.
 *
 * Solo se arma si están las dos puntas: una sola no es un período que se pueda mostrar.
 */
function aPeriodoTransito(solicitud: SolicitudConDetalle): PeriodoTransitoDto | null {
  const { fechaInicioTransito, fechaFinTransito } = solicitud;

  if (!fechaInicioTransito || !fechaFinTransito) return null;

  return {
    fechaInicio: aFechaISO(fechaInicioTransito),
    fechaFin: aFechaISO(fechaFinTransito),
  };
}

type HogarPersistido = NonNullable<SolicitudConDetalle['hogar']>;

function aHogarDto(hogar: HogarPersistido): HogarSolicitanteDto {
  return {
    direccion: hogar.direccion,
    tipoVivienda: hogar.tipoVivienda,
    espacioExterior: hogar.espacioExterior,
    tieneNinios: hogar.tieneNinios,
    tieneMascotas: hogar.tieneMascotas,
    detalleMascotas: hogar.detalleMascotas,
    experienciaPrevia: hogar.experienciaPrevia,
    horasSolo: hogar.horasSolo,
    descripcion: hogar.descripcion,
  };
}

/**
 * El hogar vigente HOY, solo si no es el mismo que se declaró al enviar. Es el aviso que
 * ve quien resuelve: "declaró esto, y después lo cambió".
 *
 * Se compara por id de fila y no campo por campo porque el hogar se versiona: dos ids
 * distintos ya significan que algo cambió (`crearConHogar` reusa la fila cuando las
 * respuestas son idénticas).
 */
function aCambioDeHogar(solicitud: SolicitudConDetalle): CambioDeHogarDto | null {
  const vigente = solicitud.usuario.hogares[0];

  if (!vigente || !solicitud.hogar || vigente.id === solicitud.hogar.id) return null;

  return { hogar: aHogarDto(vigente), fechaCambio: vigente.fechaAlta.toISOString() };
}

function aResumenDto(solicitud: SolicitudConDetalle): SolicitudResumenDto {
  // El historial viene ordenado desc: el primero es el estado vigente.
  const vigente = solicitud.historicoEstados[0]!.estadoSolicitud;

  return {
    id: solicitud.id,
    publicacionId: solicitud.publicacionId,
    mascota: {
      id: solicitud.publicacion.mascota.id,
      nombre: solicitud.publicacion.mascota.nombre,
      imagenUrl: solicitud.publicacion.mascota.imagenUrl,
    },
    solicitante: {
      id: solicitud.usuario.id,
      nombre: solicitud.usuario.nombre,
      apellido: solicitud.usuario.apellido,
    },
    tipoSolicitud: solicitud.tipoSolicitud.nombre,
    estado: { id: vigente.id, nombre: vigente.nombre },
    comentario: solicitud.comentario,
    transito: aPeriodoTransito(solicitud),
    fechaAlta: solicitud.fechaAlta.toISOString(),
    fechaRespuesta: solicitud.fechaRespuesta?.toISOString() ?? null,
  };
}

function aDetalleDto(solicitud: SolicitudConDetalle): SolicitudDetalleDto {
  return {
    ...aResumenDto(solicitud),
    motivacion: solicitud.motivacion,
    hogar: solicitud.hogar ? aHogarDto(solicitud.hogar) : null,
    cambioDeHogar: aCambioDeHogar(solicitud),
    historial: solicitud.historicoEstados.map((h) => ({
      id: h.estadoSolicitud.id,
      nombre: h.estadoSolicitud.nombre,
      fecha: h.fechaAlta.toISOString(),
    })),
  };
}

/** Tope de solicitudes "Pendiente" simultáneas por usuario (regla transversal 7). */
const MAXIMO_PENDIENTES = 5;

/** Espacios exteriores que cuentan como patio para el booleano del diagrama de clases. */
const ESPACIOS_CON_PATIO = ['Patio', 'Jardin'];

/**
 * Cada motivo por el que HU-7.1 frena una solicitud, con el código y el mensaje literal
 * que exigen los criterios de aceptación (no son textos genéricos: la HU los fija palabra
 * por palabra) y el HTTP que le corresponde al `POST`.
 *
 * Es una sola tabla para que el chequeo previo de la UI y el rechazo del alta no puedan
 * decir cosas distintas: los dos caminos leen de acá.
 */
const BLOQUEOS = {
  PUBLICACION_PROPIA: {
    codigo: 'PUBLICACION_PROPIA',
    mensaje: 'No podés solicitar tu propia mascota',
    estado: 403,
  },
  NO_VERIFICADO: {
    codigo: 'USUARIO_NO_VERIFICADO',
    mensaje: 'Tenés que verificarte antes de solicitar una adopción',
    estado: 403,
  },
  LIMITE_ALCANZADO: {
    codigo: 'LIMITE_SOLICITUDES',
    mensaje: 'No podés solicitar otra mascota',
    estado: 409,
  },
  YA_SOLICITADA: {
    codigo: 'SOLICITUD_DUPLICADA',
    mensaje: 'Ya tenés una solicitud abierta para esta mascota',
    estado: 409,
  },
} as const;

type MotivoBloqueo = keyof typeof BLOQUEOS;

/**
 * Precondiciones de HU-7.1, en el orden en que las presenta la HU. El frontend las
 * consulta al tocar "Solicitar adopción" para mostrar el cartel correspondiente en vez de
 * hacerle completar cuatro pasos a alguien que no puede solicitar; el alta las vuelve a
 * correr, porque el chequeo previo es UX y no una garantía.
 *
 * `publicacionId` es opcional: sin él solo se evalúa al usuario (sirve para habilitar o
 * no el botón en un listado); con él se agrega la solicitud duplicada.
 *
 * Solo se llega desde el perfil personal (la ruta lo exige): el refugio no adopta.
 */
async function evaluarElegibilidad(
  usuarioId: number,
  publicacionId?: number,
): Promise<ElegibilidadDto> {
  const usuario = await repo.buscarUsuarioConRefugio(usuarioId);

  if (!usuario) {
    throw new AppError('NO_ENCONTRADO', 'El usuario no existe', 404);
  }

  const pendientes = await repo.contarPendientesDeUsuario(usuarioId);
  const hogar = await repo.buscarHogarActivo(usuarioId);
  const abierta = publicacionId
    ? await repo.buscarVivaDeUsuarioEnPublicacion(usuarioId, publicacionId)
    : null;

  // Se resuelve acá (y no solo al crear) para que el botón de la ficha ya nazca oculto o
  // deshabilitado sobre la propia mascota, en vez de dejar que el usuario complete el
  // formulario y recién se entere con el 403 del POST. "Propia" incluye lo de su refugio —
  // ver `shared/ambito.ts`.
  const publicacion = publicacionId
    ? await repo.buscarPublicacionParaSolicitar(publicacionId)
    : null;
  const esPropia = publicacion
    ? esMascotaPropia(publicacion.mascota, { id: usuario.id, refugioId: usuario.refugioId })
    : false;

  const motivo: MotivoBloqueo | null = esPropia
    ? 'PUBLICACION_PROPIA'
    : FLAGS.EXIGIR_VERIFICACION_PARA_SOLICITAR && !usuario.verificado
      ? 'NO_VERIFICADO'
      : abierta
        ? 'YA_SOLICITADA'
        : pendientes >= MAXIMO_PENDIENTES
          ? 'LIMITE_ALCANZADO'
          : null;

  return {
    puedeSolicitar: motivo === null,
    motivo,
    mensaje: motivo ? BLOQUEOS[motivo].mensaje : null,
    verificado: usuario.verificado,
    pendientes,
    maximo: MAXIMO_PENDIENTES,
    solicitudAbiertaId: abierta?.id ?? null,
    hogar: hogar ? aHogarDto(hogar) : null,
  };
}

/** El chequeo previo que consulta la UI antes de abrir el formulario (GUI-7.1.1). */
export function obtenerElegibilidad(
  usuarioId: number,
  publicacionId?: number,
): Promise<ElegibilidadDto> {
  return evaluarElegibilidad(usuarioId, publicacionId);
}

/** Misma evaluación, pero cortando con el error que le corresponde a cada motivo. */
async function exigirPuedeSolicitar(usuarioId: number, publicacionId: number): Promise<void> {
  const { motivo } = await evaluarElegibilidad(usuarioId, publicacionId);

  if (motivo) {
    const { codigo, mensaje, estado } = BLOQUEOS[motivo];
    throw new AppError(codigo, mensaje, estado);
  }
}

/**
 * `tienePatio` no se pregunta: se deriva del chip de espacio exterior. La columna sigue
 * existiendo porque está en el diagrama de clases, pero la respuesta real del formulario
 * es `espacioExterior` — ver `docs/MODELO_DATOS.md`.
 *
 * `detalleMascotas` se descarta si respondió que no tiene otras mascotas: el campo solo
 * se muestra con el switch encendido, y guardar un texto huérfano confundiría al refugio.
 */
function aDatosHogar(hogar: HogarDto): repo.DatosHogar {
  return {
    direccion: hogar.direccion,
    tipoVivienda: hogar.tipoVivienda,
    espacioExterior: hogar.espacioExterior,
    tienePatio: ESPACIOS_CON_PATIO.includes(hogar.espacioExterior),
    tieneNinios: hogar.tieneNinios,
    tieneMascotas: hogar.tieneMascotas,
    detalleMascotas: hogar.tieneMascotas ? hogar.detalleMascotas : null,
    experienciaPrevia: hogar.experienciaPrevia,
    horasSolo: hogar.horasSolo,
    descripcion: hogar.descripcion,
  };
}

/** Estado del que sale una mascota que todavía se puede solicitar. */
const ESTADO_SOLICITABLE = 'Disponible';

/** Solo un aviso activo recibe solicitudes: uno pausado o finalizado está fuera del feed. */
const ESTADO_PUBLICACION_SOLICITABLE = 'Activa';

/** Tipo de solicitud que, al aprobarse, transfiere la mascota al adoptante (HU-7.4). */
const TIPO_SOLICITUD_ADOPCION = 'Adopcion';

/**
 * Comentario que queda en las demás solicitudes "Pendiente" de la publicación cuando una
 * adopción se aprueba: se rechazan solas porque la mascota ya tiene un hogar.
 */
const COMENTARIO_RECHAZO_POR_ADOPCION = 'La mascota fue adoptada por otra persona';

export async function crearSolicitud(
  datos: CrearSolicitudDto,
  usuarioId: number,
): Promise<SolicitudCreadaDto> {
  await exigirPuedeSolicitar(usuarioId, datos.publicacionId);

  const publicacion = await repo.buscarPublicacionParaSolicitar(datos.publicacionId);

  if (!publicacion) {
    throw new AppError('NO_ENCONTRADO', 'La publicación no existe', 404);
  }

  // La propia (mascota personal o del mismo refugio) ya cortó arriba en
  // `exigirPuedeSolicitar` con PUBLICACION_PROPIA — mismo criterio que favoritos.

  const estadoMascota = publicacion.mascota.historicoEstados[0]?.estadoMascota.nombre;
  if (estadoMascota !== ESTADO_SOLICITABLE) {
    throw new AppError('MASCOTA_NO_DISPONIBLE', 'Esta mascota ya no está disponible', 409);
  }

  // Desde que la publicación se puede pausar a mano, la mascota puede estar disponible con
  // el aviso pausado: manda el aviso.
  const estadoPublicacion = publicacion.historicoEstados[0]?.estadoPublicacion.nombre;
  if (estadoPublicacion !== ESTADO_PUBLICACION_SOLICITABLE) {
    throw new AppError(
      'PUBLICACION_NO_ACTIVA',
      'Esta publicación no está recibiendo solicitudes en este momento',
      409,
    );
  }

  const tipo = await repo.buscarTipoSolicitudPorNombre(datos.tipoSolicitud);
  if (!tipo) {
    throw new AppError(
      'ERROR_INTERNO',
      `Falta el tipo "${datos.tipoSolicitud}" en el catálogo`,
      500,
    );
  }

  const estadoPendiente = await repo.buscarEstadoSolicitudPorNombre('Pendiente');
  if (!estadoPendiente) {
    throw new AppError('ERROR_INTERNO', 'Falta el estado "Pendiente" en el catálogo', 500);
  }

  const creada = await repo.crearConHogar(
    usuarioId,
    {
      publicacionId: datos.publicacionId,
      tipoSolicitudId: tipo.id,
      motivacion: datos.motivacion,
      fechaInicioTransito: datos.fechaInicioTransito,
      fechaFinTransito: datos.fechaFinTransito,
    },
    aDatosHogar(datos.hogar),
    estadoPendiente.id,
  );

  await registrarAuditoria({
    usuarioId,
    accion: 'CREAR',
    entidad: 'Solicitud',
    entidadId: creada.id,
    detalle: `${datos.tipoSolicitud} sobre publicación ${datos.publicacionId}`,
  });

  // CONSTITUTION §7: la solicitud ES la interacción previa que habilita el chat, así que la
  // sala se abre acá y con la tarjeta del pedido ya adentro. Su id vuelve en la respuesta:
  // la app lleva al solicitante directo a esa conversación.
  //
  // No se propaga el error: la solicitud está creada y confirmada al usuario; que la sala no
  // se haya podido abrir no puede convertir eso en un 500. Si falla, `chatId` va `null`, el
  // chat simplemente no existe todavía y se puede abrir en el próximo intento.
  const chatId = await chats.asegurarChatDeSolicitud(creada.id).catch((err: unknown) => {
    console.error('No se pudo abrir el chat de la solicitud', creada.id, err);
    return null;
  });

  await avisarSolicitudNueva(creada);

  return { ...aDetalleDto(creada), chatId };
}

/**
 * HU-4.2: "X quiere adoptar a Y", al refugio o al publicador particular.
 *
 * Best-effort, mismo criterio que `chats.asegurarChatDeSolicitud` unas líneas arriba: la
 * solicitud ya está creada y confirmada; que el aviso falle no puede convertir eso en un 500.
 */
async function avisarSolicitudNueva(solicitud: SolicitudConDetalle): Promise<void> {
  try {
    const mascota = solicitud.publicacion.mascota;
    const destinatarios = await destinatariosPublicador(mascota, solicitud.publicacion.usuarioId);
    const nombreMascota = mascota.nombre ?? 'tu mascota';
    const nombreAdoptante = `${solicitud.usuario.nombre} ${solicitud.usuario.apellido}`;

    await Promise.all(
      destinatarios.map((usuarioId) =>
        notificaciones.notificar({
          usuarioId,
          tipo: 'SOLICITUD_NUEVA',
          mensaje: `${nombreAdoptante} quiere adoptar a ${nombreMascota}`,
          asuntoMail: `Nueva solicitud de adopción: ${nombreMascota}`,
          entidadTipo: 'SOLICITUD',
          entidadId: solicitud.id,
          canal: { mail: true, push: true },
        }),
      ),
    );
  } catch (err) {
    console.error('No se pudo avisar la solicitud nueva', solicitud.id, err);
  }
}

/**
 * Historial propio del solicitante (HU-7.3). Mismo filtro y paginación en memoria que
 * `listarRecibidas`, por la misma razón: el volumen por usuario es chico.
 */
export async function listarMias(
  usuarioId: number,
  filtros: FiltrosMiasDto,
): Promise<ListaSolicitudesRecibidasDto> {
  const todas = await repo.listarDelSolicitante(usuarioId);
  const filtradas = filtrarPorEstadoYFecha(todas, filtros);

  const pagina = filtradas.slice(filtros.desplazamiento, filtros.desplazamiento + filtros.limite);

  return { total: filtradas.length, solicitudes: pagina.map(aResumenDto) };
}

/**
 * Estado y rango de fecha (sobre `fechaAlta`, las dos puntas inclusive) de `listarMias` y
 * `listarRecibidas`. Un genérico y no un tipo con nombre porque lo único que importa acá es
 * la forma mínima que necesita el filtro, no de qué repo salió la lista.
 */
function filtrarPorEstadoYFecha<
  T extends {
    fechaAlta: Date;
    historicoEstados: { fechaAlta: Date; estadoSolicitud: { nombre: string } }[];
  },
>(solicitudes: T[], filtros: FiltrosRecibidasDto | FiltrosMiasDto): T[] {
  // `estado` (uno) y `estados` (varios) se suman; sin ninguno, no se filtra por estado.
  const estados: string[] = filtros.estado ? [...filtros.estados, filtros.estado] : filtros.estados;
  const hoy = new Date();

  return solicitudes.filter((s) => {
    const fila = s.historicoEstados[0];
    const vigente = fila?.estadoSolicitud.nombre;
    if (estados.length > 0 && (vigente === undefined || !estados.includes(vigente))) {
      return false;
    }
    // Mismo criterio que el panel «Solicitudes demoradas» del dashboard del refugio.
    if (
      filtros.demoradas &&
      (!fila || !esSolicitudDemorada({ nombre: fila.estadoSolicitud.nombre, desde: fila.fechaAlta }, hoy))
    ) {
      return false;
    }
    if (filtros.fechaDesde && s.fechaAlta < filtros.fechaDesde) return false;
    if (filtros.fechaHasta && s.fechaAlta > finDelDia(filtros.fechaHasta)) return false;
    return true;
  });
}

export async function obtenerDetalle(
  solicitudId: number,
  usuarioId: number,
  ambito: Ambito,
): Promise<SolicitudDetalleDto> {
  const actor = await resolverActor(usuarioId, ambito);
  const solicitud = await exigirSolicitud(solicitudId, visiblePor(actor));

  return aDetalleDto(solicitud);
}

// ponytail: filtro por estado y paginación en memoria, no en la query — el volumen de
// solicitudes por actor es chico. Si esto escala, mover a where/skip/take en
// `repo.listarDelActor`.
export async function listarRecibidas(
  usuarioId: number,
  ambito: Ambito,
  filtros: FiltrosRecibidasDto,
): Promise<ListaSolicitudesRecibidasDto> {
  const actor = await resolverActor(usuarioId, ambito);
  const todas = await repo.listarDelActor(actor);
  const filtradas = filtrarPorEstadoYFecha(todas, filtros);

  const pagina = filtradas.slice(filtros.desplazamiento, filtros.desplazamiento + filtros.limite);

  return { total: filtradas.length, solicitudes: pagina.map(aResumenDto) };
}

export async function resolverSolicitud(
  solicitudId: number,
  datos: ResolverSolicitudDto,
  usuarioId: number,
  ambito: Ambito,
): Promise<SolicitudDetalleDto> {
  const actor = await resolverActor(usuarioId, ambito);
  const solicitud = await exigirSolicitud(solicitudId, gestionablePor(actor));

  const vigenteAlLeer = solicitud.historicoEstados[0]!.estadoSolicitud;
  if (vigenteAlLeer.nombre !== 'Pendiente') {
    throw new AppError('SOLICITUD_YA_RESUELTA', 'Esta solicitud ya fue resuelta', 409);
  }

  const nuevoEstado = await repo.buscarEstadoSolicitudPorNombre(datos.estado);
  if (!nuevoEstado) {
    throw new AppError('ERROR_INTERNO', `Falta el estado "${datos.estado}" en el catálogo`, 500);
  }

  // Aprobar una solicitud de ADOPCIÓN no es sólo cambiar el estado: hay que darle la mascota
  // al adoptante. El tránsito es temporal (la mascota vuelve al refugio), así que sólo se
  // resuelve. Ver `aprobarAdopcion`.
  if (datos.estado === 'Aprobada' && solicitud.tipoSolicitud.nombre === TIPO_SOLICITUD_ADOPCION) {
    return aprobarAdopcion(solicitud, nuevoEstado.id, datos.comentario, usuarioId);
  }

  // Revalida "Pendiente" atómicamente al escribir: si otro PATCH concurrente ya la
  // resolvió entre la lectura de arriba y este punto, `resolverSiPendiente` devuelve
  // `null` en vez de pisar su resultado.
  const actualizada = await repo.resolverSiPendiente(
    solicitudId,
    nuevoEstado.id,
    datos.comentario,
    usuarioId,
  );

  if (!actualizada) {
    throw new AppError('SOLICITUD_YA_RESUELTA', 'Esta solicitud ya fue resuelta', 409);
  }

  await registrarAuditoria({
    usuarioId,
    accion: datos.estado === 'Aprobada' ? 'APROBAR' : 'RECHAZAR',
    entidad: 'Solicitud',
    entidadId: solicitudId,
    detalle: `${vigenteAlLeer.nombre} -> ${datos.estado}`,
  });

  await avisarSolicitudResuelta(actualizada);

  return aDetalleDto(actualizada);
}

/**
 * HU-4.1: rechazada, o aprobada de un tránsito (la adopción aprobada tiene su propio aviso,
 * más completo, en `aprobarAdopcion` — a esta función ya no la alcanza porque
 * `resolverSolicitud` deriva ese caso antes de llegar a `resolverSiPendiente`).
 * Best-effort: la resolución de la solicitud ya se escribió, un aviso que falla no la revierte.
 */
async function avisarSolicitudResuelta(solicitud: SolicitudConDetalle): Promise<void> {
  try {
    const nombreMascota = solicitud.publicacion.mascota.nombre ?? 'la mascota';
    const vigente = solicitud.historicoEstados[0]!.estadoSolicitud.nombre;

    if (vigente === 'Aprobada') {
      await notificaciones.notificar({
        usuarioId: solicitud.usuarioId,
        tipo: 'SOLICITUD_ACEPTADA',
        mensaje: `¡Tu solicitud por ${nombreMascota} fue aceptada! Ya podés coordinar por el chat.`,
        asuntoMail: `Tu solicitud por ${nombreMascota} fue aceptada`,
        entidadTipo: 'SOLICITUD',
        entidadId: solicitud.id,
        canal: { mail: true, push: true },
      });
      return;
    }

    await notificaciones.notificar({
      usuarioId: solicitud.usuarioId,
      tipo: 'SOLICITUD_RECHAZADA',
      mensaje: `Tu solicitud por ${nombreMascota} no fue aceptada esta vez`,
      asuntoMail: `Tu solicitud por ${nombreMascota} fue rechazada`,
      entidadTipo: 'SOLICITUD',
      entidadId: solicitud.id,
      canal: { mail: true, push: true },
    });
  } catch (err) {
    console.error('No se pudo avisar la resolución de la solicitud', solicitud.id, err);
  }
}

/**
 * Avisos de una adopción aprobada (spec 004): al adoptante que ya puede coordinar, al
 * publicador porque le arranca el seguimiento, y a quienes tenían otra solicitud pendiente
 * sobre la misma publicación y `aprobarAdopcion` ya les rechazó (HU-7.4) — "la mascota que
 * solicitaste fue adoptada por otra persona". Best-effort, mismo criterio que
 * `avisarSolicitudResuelta`: la adopción ya quedó aprobada, un aviso que falla no la revierte.
 */
async function avisarAdopcionAprobada(
  solicitud: SolicitudConDetalle,
  otrosPretendientes: { id: number; usuarioId: number }[],
  idsRechazados: number[],
): Promise<void> {
  try {
    const mascota = solicitud.publicacion.mascota;
    const nombreMascota = mascota.nombre ?? 'la mascota';

    await notificaciones.notificar({
      usuarioId: solicitud.usuarioId,
      tipo: 'SOLICITUD_ACEPTADA',
      mensaje: `¡Tu solicitud por ${nombreMascota} fue aceptada! Ya podés coordinar por el chat.`,
      asuntoMail: `Tu solicitud por ${nombreMascota} fue aceptada`,
      entidadTipo: 'SOLICITUD',
      entidadId: solicitud.id,
      canal: { mail: true, push: true },
    });

    const destinatarios = await destinatariosPublicador(mascota, solicitud.publicacion.usuarioId);
    await Promise.all(
      destinatarios.map((destId) =>
        notificaciones.notificar({
          usuarioId: destId,
          tipo: 'ADOPCION_COMPLETADA',
          mensaje: `La adopción de ${nombreMascota} se completó, ya empezó el seguimiento`,
          entidadTipo: 'SOLICITUD',
          entidadId: solicitud.id,
          canal: { push: true },
        }),
      ),
    );

    const rechazados = otrosPretendientes.filter((otra) => idsRechazados.includes(otra.id));
    await Promise.all(
      rechazados.map((otra) =>
        notificaciones.notificar({
          usuarioId: otra.usuarioId,
          tipo: 'SOLICITUD_MASCOTA_ADOPTADA_POR_OTRO',
          mensaje: `${nombreMascota} ya fue adoptada por otra persona`,
          entidadTipo: 'SOLICITUD',
          entidadId: otra.id,
          canal: { push: true },
        }),
      ),
    );

    // Quienes la tenían en favoritos y no la habían solicitado: no se les avisó arriba. Una
    // adopción es definitiva, así que el texto no promete que vuelva.
    const yaAvisados = new Set([
      solicitud.usuarioId,
      ...destinatarios,
      ...rechazados.map((otra) => otra.usuarioId),
    ]);
    const conFavorito = await favoritos.listarUsuariosConFavorito(mascota.id);

    await Promise.all(
      conFavorito
        .filter((usuarioId) => !yaAvisados.has(usuarioId))
        .map((usuarioId) =>
          notificaciones.notificar({
            usuarioId,
            tipo: 'FAVORITO_ADOPTADO',
            mensaje: `${nombreMascota}, que tenías en favoritos, ya fue adoptada.`,
            entidadTipo: 'FAVORITOS',
            entidadId: mascota.id,
            canal: { push: true },
          }),
        ),
    );
  } catch (err) {
    console.error('No se pudo avisar la adopción aprobada', solicitud.id, err);
  }
}

// ─────────────── Jobs programados (spec 004, entregable 4) ───────────────

const DIAS_PENDIENTE_MUCHO = 3;
const MS_POR_DIA = 24 * 60 * 60 * 1000;

/** "Solicitud pendiente hace muchos días sin responder", al publicador. Un aviso por solicitud. */
export async function avisarPendientesHaceMucho(ahora: Date = new Date()): Promise<void> {
  const solicitudes = await repo.listarSinRespuestaConDetalle();
  const limite = DIAS_PENDIENTE_MUCHO * MS_POR_DIA;

  for (const solicitud of solicitudes) {
    if (solicitud.historicoEstados[0]?.estadoSolicitud.nombre !== 'Pendiente') continue;
    if (solicitud.fechaAlta.getTime() + limite > ahora.getTime()) continue;

    const mascota = solicitud.publicacion.mascota;
    const nombreMascota = mascota.nombre ?? 'la mascota';
    const destinatarios = await destinatariosPublicador(mascota, solicitud.publicacion.usuarioId);

    await Promise.all(
      destinatarios.map((usuarioId) =>
        notificaciones.notificarUnaVez({
          usuarioId,
          tipo: 'SOLICITUD_PENDIENTE_HACE_MUCHO',
          mensaje: `Tenés una solicitud por ${nombreMascota} sin responder hace varios días`,
          asuntoMail: `Solicitud pendiente: ${nombreMascota}`,
          entidadTipo: 'SOLICITUD',
          entidadId: solicitud.id,
          canal: { mail: true },
        }),
      ),
    );
  }
}

const DIAS_TRANSITO_POR_VENCER = 3;

/** "Tránsito por comenzar" (día anterior) y "próximo a la fecha límite" (spec 004). */
export async function avisarTransitosProgramados(ahora: Date = new Date()): Promise<void> {
  const solicitudes = await repo.listarTransitosAprobados();

  for (const solicitud of solicitudes) {
    if (solicitud.historicoEstados[0]?.estadoSolicitud.nombre !== 'Aprobada') continue;

    const { fechaInicioTransito: inicio, fechaFinTransito: fin } = solicitud;
    if (!inicio || !fin) continue;

    const mascota = solicitud.publicacion.mascota;
    const nombreMascota = mascota.nombre ?? 'la mascota';
    const destinatariosRefugio = await destinatariosPublicador(
      mascota,
      solicitud.publicacion.usuarioId,
    );
    const destinatarios = [solicitud.usuarioId, ...destinatariosRefugio];

    const faltanParaInicio = inicio.getTime() - ahora.getTime();
    const yaEmpezoYFaltanParaFin = fin.getTime() - ahora.getTime();

    // Ventana de un día: el job corre 1x/día, así que basta con "cae dentro de las próximas
    // 24-48h" para pegarle una sola vez sin exigir precisión de reloj.
    if (faltanParaInicio > 0 && faltanParaInicio <= MS_POR_DIA) {
      await Promise.all(
        destinatarios.map((usuarioId) =>
          notificaciones.notificarUnaVez({
            usuarioId,
            tipo: 'TRANSITO_POR_COMENZAR',
            mensaje: `El tránsito de ${nombreMascota} empieza mañana`,
            entidadTipo: 'SOLICITUD',
            entidadId: solicitud.id,
            canal: { push: true },
          }),
        ),
      );
    }

    if (
      yaEmpezoYFaltanParaFin > 0 &&
      yaEmpezoYFaltanParaFin <= DIAS_TRANSITO_POR_VENCER * MS_POR_DIA
    ) {
      await Promise.all(
        destinatarios.map((usuarioId) =>
          notificaciones.notificarUnaVez({
            usuarioId,
            tipo: 'TRANSITO_POR_VENCER',
            mensaje: `El tránsito de ${nombreMascota} está por terminar`,
            entidadTipo: 'SOLICITUD',
            entidadId: solicitud.id,
            canal: { push: true },
          }),
        ),
      );
    }
  }
}

/**
 * Aprobación de una adopción (HU-7.4): resuelve la solicitud, crea la mascota propia del
 * adoptante, pasa la mascota publicada a "Adoptado", finaliza la publicación y rechaza las
 * demás solicitudes pendientes — todo en una transacción (`repo.aprobarAdopcion`).
 */
async function aprobarAdopcion(
  solicitud: SolicitudConDetalle,
  estadoAprobadaId: number,
  comentario: string | null,
  usuarioId: number,
): Promise<SolicitudDetalleDto> {
  const [estadoRechazada, estadoMascotaAdoptado, estadoPublicacionFinalizada] = await Promise.all([
    repo.buscarEstadoSolicitudPorNombre('Rechazada'),
    repo.buscarEstadoMascotaPorNombre('Adoptado'),
    repo.buscarEstadoPublicacionPorNombre('Finalizada'),
  ]);

  if (!estadoRechazada || !estadoMascotaAdoptado || !estadoPublicacionFinalizada) {
    throw new AppError(
      'ERROR_INTERNO',
      'Faltan estados en el catálogo para aprobar la adopción',
      500,
    );
  }

  const mascota = solicitud.publicacion.mascota;

  // Antes de la transacción: a esta altura todavía siguen "Pendiente" (spec 004, para saber
  // a quién de ellas avisarle después que la mascota ya fue adoptada por otro).
  const otrosPretendientes = await repo.listarOtrasPendientesDePublicacion(
    solicitud.publicacionId,
    solicitud.id,
  );

  const resultado = await repo.aprobarAdopcion(solicitud.id, usuarioId, {
    estadoAprobadaId,
    estadoRechazadaId: estadoRechazada.id,
    estadoMascotaAdoptadoId: estadoMascotaAdoptado.id,
    estadoPublicacionFinalizadaId: estadoPublicacionFinalizada.id,
    comentario,
    comentarioRechazo: COMENTARIO_RECHAZO_POR_ADOPCION,
    publicacionId: solicitud.publicacionId,
    mascotaOrigenId: mascota.id,
    mascotaOrigen: {
      nombre: mascota.nombre,
      fechaNacimiento: mascota.fechaNacimiento,
      genero: mascota.genero,
      peso: mascota.peso,
      tamanio: mascota.tamanio,
      castrado: mascota.castrado,
      descripcion: mascota.descripcion,
      imagenUrl: mascota.imagenUrl,
      razaId: mascota.razaId,
    },
    adoptanteId: solicitud.usuarioId,
  });

  if (!resultado) {
    throw new AppError('SOLICITUD_YA_RESUELTA', 'Esta solicitud ya fue resuelta', 409);
  }

  await registrarAuditoria({
    usuarioId,
    accion: 'APROBAR',
    entidad: 'Solicitud',
    entidadId: solicitud.id,
    detalle: `Pendiente -> Aprobada (adopción, mascota ${mascota.id} -> usuario ${solicitud.usuarioId})`,
  });

  await registrarAuditoria({
    usuarioId,
    accion: 'CREAR',
    entidad: 'Mascota',
    entidadId: resultado.mascotaAdoptadaId,
    detalle: `adoptada por usuario ${solicitud.usuarioId} (solicitud ${solicitud.id})`,
  });

  await registrarAuditoria({
    usuarioId,
    accion: 'CAMBIAR_ESTADO',
    entidad: 'Mascota',
    entidadId: mascota.id,
    detalle: 'Adoptado (adopción aprobada)',
  });

  await registrarAuditoria({
    usuarioId,
    accion: 'CAMBIAR_ESTADO',
    entidad: 'Publicacion',
    entidadId: solicitud.publicacionId,
    detalle: 'Finalizada (adopción aprobada)',
  });

  for (const rechazadaId of resultado.solicitudesRechazadas) {
    await registrarAuditoria({
      usuarioId,
      accion: 'RECHAZAR',
      entidad: 'Solicitud',
      entidadId: rechazadaId,
      detalle: 'Rechazada al aprobarse otra solicitud de la misma publicación',
    });
  }

  await avisarAdopcionAprobada(
    resultado.solicitud,
    otrosPretendientes,
    resultado.solicitudesRechazadas,
  );

  return aDetalleDto(resultado.solicitud);
}
