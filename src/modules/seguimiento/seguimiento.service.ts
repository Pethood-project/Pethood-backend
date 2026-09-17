import { AppError } from '../../middlewares/errorHandler';
import { USUARIO_SISTEMA_ID } from '../../shared/auditoria';
import { registrarAuditoria } from '../../shared/logAuditoria';
import { borrarImagen, guardarImagen } from '../../shared/storage';
import type {
  ActualizacionCargadaDto,
  ActualizacionSeguimientoDto,
  DetalleSeguimientoDto,
  EstadoSeguimiento,
  RolSeguimiento,
  SeguimientoItemDto,
  SolicitudEnSeguimientoDto,
  SubirActualizacionDto,
} from './seguimiento.dto';
import * as repo from './seguimiento.repository';
import type { SeguimientoConPregunta, SolicitudEnSeguimiento } from './seguimiento.repository';
import {
  correspondeBorrarSeguimientos,
  elegirPregunta,
  pedidosExigiblesA,
  plazoDeRespuesta,
  proximoAviso,
  type TipoFlujo,
} from './seguimiento.secuencia';

const SUBCARPETA_FOTOS = 'seguimientos';
const TIPO_NOTIFICACION_VENCIDO = 'SEGUIMIENTO_VENCIDO';

/** Texto literal de HU-9.1, tanto el de éxito como el del aviso al publicador. */
const MENSAJE_EXITO = 'seguimiento cargado con exito';
const MENSAJE_NO_ENVIADO = 'Actualización de seguimiento no enviado';

/**
 * Textos literales de HU-9.3, para cuando se abre una actualización que todavía no se cargó.
 * La distinción es el plazo: mientras esté abierto el adoptante todavía puede responder
 * ("aún no"), cumplido el plazo ya no ("no se subió").
 */
const MENSAJE_SIN_CARGAR_A_TIEMPO = 'Aún no se sube actualización de este seguimiento';
const MENSAJE_SIN_CARGAR_VENCIDO = 'No se subió actualización de seguimiento';

export interface Contexto {
  usuarioId: number;
  archivo?: { buffer: Buffer; mimetype: string };
}

type Usuario = NonNullable<Awaited<ReturnType<typeof repo.buscarUsuario>>>;

// ─────────────── Lectura del estado de una solicitud ───────────────

/**
 * Fecha en que la solicitud quedó aprobada — el día 0 de la secuencia. Devuelve null si la
 * solicitud no está aprobada AHORA: el histórico se lee ordenado del más nuevo al más viejo,
 * así que si el estado vigente no es "Aprobada" la solicitud no genera seguimientos, aunque
 * alguna vez lo haya estado.
 */
function fechaDeAprobacion(solicitud: SolicitudEnSeguimiento): Date | null {
  const vigente = solicitud.historicoEstados[0];
  if (!vigente || vigente.estadoSolicitud.nombre !== 'Aprobada') return null;

  return vigente.fechaAlta;
}

/** Solo adopción y tránsito generan seguimiento post-adopción. */
function flujoDe(solicitud: SolicitudEnSeguimiento): TipoFlujo | null {
  const nombre = solicitud.tipoSolicitud.nombre;
  return nombre === 'Adopcion' || nombre === 'Transito' ? nombre : null;
}

function rolDe(solicitud: SolicitudEnSeguimiento, usuario: Usuario): RolSeguimiento | null {
  if (solicitud.usuarioId === usuario.id) return 'ADOPTANTE';
  if (solicitud.publicacion.usuarioId === usuario.id) return 'PUBLICADOR';

  const refugioMascota = solicitud.publicacion.mascota.refugioId;
  if (usuario.refugioId !== null && usuario.refugioId === refugioMascota) return 'PUBLICADOR';

  return null;
}

/** Estado derivado (spec 011 §3): no se guarda en base, se calcula contra el reloj. */
function estadoDe(seguimiento: SeguimientoConPregunta, ahora: Date): EstadoSeguimiento {
  if (seguimiento.descripcion !== null) return 'COMPLETADO';
  if (seguimiento.plazo !== null && seguimiento.plazo.getTime() <= ahora.getTime()) {
    return 'VENCIDO';
  }
  return 'PENDIENTE';
}

// ─────────────── Generación de pedidos (el corazón del módulo) ───────────────

/**
 * Deja la solicitud al día contra el reloj: materializa los pedidos cuya fecha ya llegó y
 * avisa al publicador de los que vencieron sin respuesta.
 *
 * Es idempotente — correrla dos veces no duplica pedidos ni repite notificaciones — y por eso
 * puede llamarse desde la lectura. Ver spec 011 §9: el proyecto todavía no tiene scheduler,
 * así que si esto no corriera al leer, ningún pedido aparecería nunca. El día que exista el
 * job basta con llamar a esta misma función desde ahí.
 */
async function sincronizarSolicitud(
  solicitud: SolicitudEnSeguimiento,
  ahora: Date,
): Promise<SeguimientoConPregunta[]> {
  const aprobacion = fechaDeAprobacion(solicitud);
  const flujo = flujoDe(solicitud);

  if (aprobacion === null || flujo === null) return [];

  // HU-9.1: pasados 5 días del fin del tránsito el registro se borra (baja lógica).
  if (correspondeBorrarSeguimientos(aprobacion, flujo, ahora)) {
    if (solicitud.seguimientos.length > 0) {
      await repo.darDeBajaSeguimientosDeSolicitud(solicitud.id, USUARIO_SISTEMA_ID);
    }
    return [];
  }

  const existentes = solicitud.seguimientos;
  const creados = await crearPedidosFaltantes(solicitud, flujo, aprobacion, ahora, existentes);
  const seguimientos = [...existentes, ...creados];

  await avisarVencidos(solicitud, seguimientos, ahora);

  return seguimientos;
}

/**
 * Crea las filas de los pedidos que ya tendrían que existir y todavía no están. Se comparan
 * por CANTIDAD y no por fecha: los pedidos se generan siempre en orden, así que los que
 * faltan son los del final de la secuencia.
 */
async function crearPedidosFaltantes(
  solicitud: SolicitudEnSeguimiento,
  flujo: TipoFlujo,
  aprobacion: Date,
  ahora: Date,
  existentes: SeguimientoConPregunta[],
): Promise<SeguimientoConPregunta[]> {
  const exigibles = pedidosExigiblesA(aprobacion, flujo, ahora);
  const faltantes = exigibles.slice(existentes.length);

  if (faltantes.length === 0) return [];

  const preguntas = await repo.listarPreguntas(flujo === 'Adopcion');

  if (preguntas.length === 0) {
    // Sin catálogo no se puede armar el pedido. Se deja constancia y se sigue: es preferible
    // que la pantalla muestre lo que ya hay a que reviente el listado entero (spec 011 §8).
    console.warn(
      `[seguimiento] no hay preguntas cargadas para el flujo ${flujo}: ` +
        `la solicitud ${solicitud.id} queda sin pedidos nuevos`,
    );
    return [];
  }

  const idsUsados = existentes.map((seguimiento) => seguimiento.preguntaSeguimientoId);
  const nuevos = faltantes.map((pedido) => {
    const pregunta = elegirPregunta(preguntas, idsUsados)!;
    idsUsados.push(pregunta.id);

    return {
      solicitudId: solicitud.id,
      preguntaSeguimientoId: pregunta.id,
      fechaPedido: pedido.fecha,
      plazo: plazoDeRespuesta(pedido.fecha),
    };
  });

  // El autor del alta es SISTEMA: el pedido lo genera el sistema, no una persona.
  return repo.crearPedidos(nuevos, USUARIO_SISTEMA_ID);
}

/**
 * HU-9.1: al vencer el plazo sin respuesta se avisa al publicador con el mensaje
 * "Actualización de seguimiento no enviado", diciendo de qué mascota se trata.
 *
 * `fechaModificacion` en un pedido sin responder es la marca de "ya avisé": es lo que hace
 * que el aviso salga una sola vez por pedido aunque la pantalla se abra mil veces.
 */
async function avisarVencidos(
  solicitud: SolicitudEnSeguimiento,
  seguimientos: SeguimientoConPregunta[],
  ahora: Date,
): Promise<void> {
  const aAvisar = seguimientos.filter(
    (seguimiento) =>
      estadoDe(seguimiento, ahora) === 'VENCIDO' && seguimiento.fechaModificacion === null,
  );

  if (aAvisar.length === 0) return;

  const mascota = solicitud.publicacion.mascota.nombre ?? 'la mascota';

  // Una notificación por pedido vencido: cada uno es un aviso que el adoptante se salteó.
  await Promise.all(
    aAvisar.map(() =>
      repo.crearNotificacion({
        tipo: TIPO_NOTIFICACION_VENCIDO,
        mensaje: `${MENSAJE_NO_ENVIADO} — ${mascota}`,
        usuarioId: solicitud.publicacion.usuarioId,
        usuarioAlta: USUARIO_SISTEMA_ID,
      }),
    ),
  );

  await repo.marcarVencidosNotificados(
    aAvisar.map((seguimiento) => seguimiento.id),
    USUARIO_SISTEMA_ID,
  );

  // Se refleja en memoria lo que se acaba de escribir, para no releer la solicitud entera.
  for (const seguimiento of aAvisar) {
    seguimiento.fechaModificacion = ahora;
    seguimiento.usuarioModificacion = USUARIO_SISTEMA_ID;
  }
}

// ─────────────── Mapeo a DTO ───────────────

function aItem(
  seguimiento: SeguimientoConPregunta,
  indice: number,
  ahora: Date,
): SeguimientoItemDto {
  const estado = estadoDe(seguimiento, ahora);

  return {
    id: seguimiento.id,
    numero: indice + 1,
    pregunta: seguimiento.preguntaSeguimiento.texto,
    estado,
    descripcion: seguimiento.descripcion,
    fotoUrl: seguimiento.fotoUrl,
    fechaPedido: seguimiento.fechaAlta.toISOString(),
    plazo: seguimiento.plazo?.toISOString() ?? null,
    // Solo un pedido completado tiene fecha de respuesta: en uno vencido, la fecha de
    // modificación es la marca del aviso automático, no una respuesta del adoptante.
    fechaRespuesta:
      estado === 'COMPLETADO' ? (seguimiento.fechaModificacion?.toISOString() ?? null) : null,
  };
}

interface Contexto1Solicitud {
  solicitud: SolicitudEnSeguimiento;
  rol: RolSeguimiento;
  seguimientos: SeguimientoConPregunta[];
  ahora: Date;
}

function datosComunes({ solicitud, seguimientos, ahora }: Contexto1Solicitud) {
  const aprobacion = fechaDeAprobacion(solicitud);
  const flujo = flujoDe(solicitud);

  const siguiente = aprobacion && flujo ? proximoAviso(aprobacion, flujo, ahora) : null;

  const items = seguimientos.map((seguimiento, indice) => aItem(seguimiento, indice, ahora));

  return {
    items,
    proximoAviso: siguiente?.toISOString() ?? null,
    finalizado: siguiente === null,
    mascota: {
      id: solicitud.publicacion.mascota.id,
      nombre: solicitud.publicacion.mascota.nombre,
      imagenUrl: solicitud.publicacion.mascota.imagenUrl,
    },
    adoptante: {
      id: solicitud.usuario.id,
      nombre: solicitud.usuario.nombre,
      apellido: solicitud.usuario.apellido,
    },
  };
}

function aResumen(contexto: Contexto1Solicitud): SolicitudEnSeguimientoDto {
  const { items, proximoAviso: siguiente, finalizado, mascota, adoptante } = datosComunes(contexto);
  const pendiente = items.find((item) => item.estado === 'PENDIENTE') ?? null;

  return {
    solicitudId: contexto.solicitud.id,
    tipo: contexto.solicitud.tipoSolicitud.nombre,
    rol: contexto.rol,
    mascota,
    adoptante,
    totales: {
      completados: items.filter((item) => item.estado === 'COMPLETADO').length,
      vencidos: items.filter((item) => item.estado === 'VENCIDO').length,
      pendientes: items.filter((item) => item.estado === 'PENDIENTE').length,
    },
    pendiente: pendiente
      ? { id: pendiente.id, pregunta: pendiente.pregunta, plazo: pendiente.plazo }
      : null,
    proximoAviso: siguiente,
    finalizado,
  };
}

function aDetalle(contexto: Contexto1Solicitud): DetalleSeguimientoDto {
  const { items, proximoAviso: siguiente, finalizado, mascota, adoptante } = datosComunes(contexto);
  const hayPendiente = items.some((item) => item.estado === 'PENDIENTE');

  return {
    solicitudId: contexto.solicitud.id,
    tipo: contexto.solicitud.tipoSolicitud.nombre,
    rol: contexto.rol,
    // Solo el adoptante sube actualizaciones, y solo si hay un pedido esperando respuesta.
    puedeSubirActualizacion: contexto.rol === 'ADOPTANTE' && hayPendiente,
    mascota,
    adoptante,
    proximoAviso: siguiente,
    finalizado,
    // GUI-21 muestra lo más reciente arriba.
    seguimientos: [...items].reverse(),
  };
}

// ─────────────── Casos de uso ───────────────

async function exigirUsuario(usuarioId: number): Promise<Usuario> {
  const usuario = await repo.buscarUsuario(usuarioId);
  if (!usuario) throw new AppError('NO_ENCONTRADO', 'El usuario no existe', 404);

  return usuario;
}

/** HU-9.2: todo lo que el usuario tiene en seguimiento, como adoptante o como publicador. */
export async function listarMisSeguimientos(
  usuarioId: number,
  ahora: Date = new Date(),
): Promise<SolicitudEnSeguimientoDto[]> {
  const usuario = await exigirUsuario(usuarioId);
  const solicitudes = await repo.listarSolicitudesDeUsuario(usuario.id, usuario.refugioId);

  const resumenes: SolicitudEnSeguimientoDto[] = [];

  for (const solicitud of solicitudes) {
    const rol = rolDe(solicitud, usuario);
    // El filtro del repositorio ya acota a lo suyo; esto cubre el caso de una solicitud que
    // entró por el refugio pero cuya mascota cambió de dueño.
    if (rol === null) continue;
    if (fechaDeAprobacion(solicitud) === null || flujoDe(solicitud) === null) continue;

    const seguimientos = await sincronizarSolicitud(solicitud, ahora);
    resumenes.push(aResumen({ solicitud, rol, seguimientos, ahora }));
  }

  return resumenes;
}

async function exigirSolicitudAccesible(solicitudId: number, usuarioId: number) {
  const [solicitud, usuario] = await Promise.all([
    repo.buscarSolicitud(solicitudId),
    exigirUsuario(usuarioId),
  ]);

  if (!solicitud) throw new AppError('NO_ENCONTRADO', 'La solicitud no existe', 404);

  if (fechaDeAprobacion(solicitud) === null || flujoDe(solicitud) === null) {
    throw new AppError('NO_ENCONTRADO', 'La solicitud no tiene seguimiento activo', 404);
  }

  const rol = rolDe(solicitud, usuario);
  if (rol === null) {
    throw new AppError('NO_AUTORIZADO', 'Esa solicitud no está asociada a tu cuenta', 403);
  }

  return { solicitud, rol };
}

/** HU-9.2: el historial de una solicitud puntual (GUI-21). */
export async function obtenerSeguimientosDeSolicitud(
  solicitudId: number,
  usuarioId: number,
  ahora: Date = new Date(),
): Promise<DetalleSeguimientoDto> {
  const { solicitud, rol } = await exigirSolicitudAccesible(solicitudId, usuarioId);
  const seguimientos = await sincronizarSolicitud(solicitud, ahora);

  return aDetalle({ solicitud, rol, seguimientos, ahora });
}

/**
 * HU-9.3: una actualización puntual, para la pantalla "Actualización Seguimiento".
 *
 * Sirve a los dos lados: el publicador revisa lo que mandó el adoptante y el adoptante
 * relee lo que él mismo cargó. Cuando no hay nada cargado no se inventa contenido — se
 * devuelve la pregunta y el mensaje que corresponde según si el plazo sigue abierto o no.
 */
export async function obtenerActualizacion(
  seguimientoId: number,
  usuarioId: number,
  ahora: Date = new Date(),
): Promise<ActualizacionSeguimientoDto> {
  const seguimiento = await repo.buscarSeguimiento(seguimientoId);
  if (!seguimiento) throw new AppError('NO_ENCONTRADO', 'El seguimiento no existe', 404);

  const { solicitud, rol } = await exigirSolicitudAccesible(seguimiento.solicitudId, usuarioId);

  // Sincronizar antes de leer: un pedido cuyo plazo venció recién tiene que mostrar el
  // mensaje de vencido, no el de "aún no", y este es un punto de entrada válido para eso.
  const seguimientos = await sincronizarSolicitud(solicitud, ahora);

  // El número de pedido solo tiene sentido dentro de la secuencia de su solicitud.
  const indice = seguimientos.findIndex((item) => item.id === seguimientoId);
  const item = aItem(seguimiento, indice === -1 ? 0 : indice, ahora);

  const mensajePorEstado: Record<EstadoSeguimiento, string | null> = {
    COMPLETADO: null,
    PENDIENTE: MENSAJE_SIN_CARGAR_A_TIEMPO,
    VENCIDO: MENSAJE_SIN_CARGAR_VENCIDO,
  };

  return {
    ...item,
    solicitudId: solicitud.id,
    tipo: solicitud.tipoSolicitud.nombre,
    rol,
    mascota: {
      id: solicitud.publicacion.mascota.id,
      nombre: solicitud.publicacion.mascota.nombre,
      imagenUrl: solicitud.publicacion.mascota.imagenUrl,
    },
    adoptante: {
      id: solicitud.usuario.id,
      nombre: solicitud.usuario.nombre,
      apellido: solicitud.usuario.apellido,
    },
    mensaje: mensajePorEstado[item.estado],
  };
}

/**
 * HU-9.1: el adoptante responde el pedido activo con descripción y foto.
 *
 * Todas las validaciones corren ANTES de tocar el storage: si se guardara la imagen primero,
 * un rechazo por permisos o por plazo vencido dejaría el archivo huérfano en disco.
 */
export async function subirActualizacion(
  seguimientoId: number,
  datos: SubirActualizacionDto,
  contexto: Contexto,
  ahora: Date = new Date(),
): Promise<ActualizacionCargadaDto> {
  const seguimiento = await repo.buscarSeguimiento(seguimientoId);
  if (!seguimiento) throw new AppError('NO_ENCONTRADO', 'El seguimiento no existe', 404);

  const { solicitud, rol } = await exigirSolicitudAccesible(
    seguimiento.solicitudId,
    contexto.usuarioId,
  );

  if (rol !== 'ADOPTANTE') {
    throw new AppError(
      'NO_AUTORIZADO',
      'Solo quien tiene la mascota a su cargo puede subir la actualización',
      403,
    );
  }

  // Deja la solicitud al día primero: puede marcar este mismo pedido como vencido.
  await sincronizarSolicitud(solicitud, ahora);

  const estado = estadoDe(seguimiento, ahora);

  if (estado === 'COMPLETADO') {
    throw new AppError('SEGUIMIENTO_COMPLETADO', 'Este seguimiento ya fue completado', 409);
  }

  if (estado === 'VENCIDO') {
    throw new AppError(
      'SEGUIMIENTO_VENCIDO',
      'El plazo de 48 horas para responder este seguimiento venció',
      409,
    );
  }

  // HU-9.1, texto literal. El backend no puede verificar que la foto venga de la cámara
  // nativa (regla transversal 9): eso lo fuerza el front, acá solo se exige que exista.
  if (!contexto.archivo) {
    throw new AppError('VALIDACION', 'Adjuntar imagen de prueba', 400);
  }

  const fotoUrl = await guardarImagen(contexto.archivo, SUBCARPETA_FOTOS);

  let actualizado: SeguimientoConPregunta;
  try {
    actualizado = await repo.responderSeguimiento(
      seguimientoId,
      { descripcion: datos.descripcion, fotoUrl },
      contexto.usuarioId,
    );
  } catch (err) {
    await borrarImagen(fotoUrl);
    throw err;
  }

  await registrarAuditoria({
    usuarioId: contexto.usuarioId,
    accion: 'RESPONDER',
    entidad: 'Seguimiento',
    entidadId: seguimientoId,
    detalle: `solicitud=${solicitud.id}`,
  });

  // El número de pedido es su posición dentro de la secuencia de esa solicitud.
  const indice = solicitud.seguimientos.findIndex((item) => item.id === seguimientoId);

  return {
    mensaje: MENSAJE_EXITO,
    seguimiento: aItem(actualizado, indice === -1 ? 0 : indice, ahora),
  };
}
