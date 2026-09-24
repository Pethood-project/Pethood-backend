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
import * as chats from '../chats/chats.service';
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

export async function crearSolicitud(
  datos: CrearSolicitudDto,
  usuarioId: number,
): Promise<SolicitudDetalleDto> {
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
  // sala se abre acá y con la tarjeta del pedido ya adentro.
  //
  // No se espera ni se propaga el error: la solicitud está creada y confirmada al usuario;
  // que la sala no se haya podido abrir no puede convertir eso en un 500. Si falla, el chat
  // simplemente no existe todavía y se puede abrir en el próximo intento.
  await chats.asegurarChatDeSolicitud(creada.id).catch((err: unknown) => {
    console.error('No se pudo abrir el chat de la solicitud', creada.id, err);
  });

  return aDetalleDto(creada);
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
  T extends { fechaAlta: Date; historicoEstados: { estadoSolicitud: { nombre: string } }[] },
>(solicitudes: T[], filtros: FiltrosRecibidasDto | FiltrosMiasDto): T[] {
  return solicitudes.filter((s) => {
    if (filtros.estado && s.historicoEstados[0]?.estadoSolicitud.nombre !== filtros.estado) {
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

  return aDetalleDto(actualizada);
}
