/**
 * Chat: listado de conversaciones (HU-5.1, GUI-08 / GUI-31) y sala (HU-5.2, GUI-14).
 *
 * El listado es sólo lectura y NUNCA marca nada como leído: eso pasa al abrir la sala, con
 * su propio endpoint. Crear salas sigue siendo de otra HU.
 *
 * RENDIMIENTO del listado: traer el último mensaje y el conteo de no leídos chat por chat
 * sería un N+1 sobre una tabla sin cota. En vez de eso se hacen cuatro queries de tamaño
 * fijo, en dos tandas paralelas, y el cruce se resuelve en memoria con Maps por `chatId`. La
 * cantidad de queries no depende de cuántos chats tenga el usuario.
 *
 * LEÍDO Y ENTREGADO son una comparación de fechas contra `UsuarioChat`, no un booleano de
 * `Mensaje`: cada participante guarda hasta dónde tiene la sala leída y recibida. Un mensaje
 * está entregado cuando TODOS los que no lo emitieron lo recibieron, y leído cuando todos lo
 * leyeron. Así el contador no se rompe con tres o más personas y se puede distinguir el
 * segundo tilde del doble tilde pintado.
 *
 * No se escribe en `logAuditoria` en ninguna de las dos HU: leer no es una operación
 * crítica, y enviar un mensaje ya queda registrado de forma permanente en `mensaje`, que es
 * append-only por definición del modelo.
 */
import type { TipoMensaje } from '@prisma/client';
import { AppError } from '../../middlewares/errorHandler';
import { USUARIO_SISTEMA_ID } from '../../shared/auditoria';
import { borrarImagenes, guardarImagenes } from '../../shared/storage';
import { clasificarAdjuntos, esMimeDeVideo, tipoDeUrl } from '../../shared/adjuntos';
import { estaEnLinea } from '../../websockets/presencia';
import * as emisor from '../../websockets/emisor';
import { LIMITES } from '../../shared/validation/limits';
import type {
  CabeceraChatDto,
  ConversacionDto,
  ContactoChatDto,
  EnviarMensajeDto,
  EntregadosDto,
  HistorialMensajesDto,
  HistorialQuery,
  LeidosDto,
  ListaChatsDto,
  MensajeDto,
  SolicitudEnChatDto,
} from './chats.dto';
import * as repo from './chats.repository';
import type { UltimoMensajeFila } from './chats.repository';

/** Las fotos de chat van con el resto de los archivos subidos, en su propia subcarpeta. */
const SUBCARPETA_FOTOS = 'chats';

/**
 * Cuántos mensajes se miran para estimar en cuánto responde el contacto, y cuántas
 * respuestas hacen falta para animarse a decirlo. Con una sola no hay tendencia: un
 * "responde en ~2 h" basado en un caso es una promesa inventada.
 */
const MENSAJES_PARA_RESPUESTA = 60;
const MINIMO_RESPUESTAS = 2;

type MembresiaConChat = Awaited<ReturnType<typeof repo.listarChatsActivosDeUsuario>>[number];

/** El DTO más su clave de orden como Date, para no ordenar comparando strings. */
interface FilaOrdenable {
  conversacion: ConversacionDto;
  orden: Date;
}

/**
 * Resuelve el otro lado de la conversación.
 *
 * Regla de `Chat.refugioId` (docs/api-chats.md): el refugio es la contraparte SALVO que
 * quien mira sea justamente miembro de ese refugio, en cuyo caso la contraparte es la
 * persona del otro lado. Es simétrico — el adoptante ve al refugio, el refugio ve al
 * adoptante — y sobrevive a la rotación de personal: si quien atendió se va, el adoptante
 * sigue viendo el nombre del refugio y no el de un desconocido.
 *
 * Devuelve `null` cuando no queda ningún participante activo además del usuario: la fila no
 * se puede pintar (no hay nombre ni avatar) y el service la omite.
 */
function resolverContacto(
  chat: MembresiaConChat['chat'],
  refugioDelUsuario: number | null,
): ContactoChatDto | null {
  const { refugio } = chat;

  if (refugio && refugio.id !== refugioDelUsuario) {
    return {
      tipo: 'REFUGIO',
      id: refugio.id,
      nombre: refugio.nombre,
      imagenUrl: refugio.imagenUrl,
      activo: refugio.fechaBaja === null,
    };
  }

  // `participantes` ya viene filtrado por el repository a los activos distintos de quien
  // pregunta, así que el primero ES el otro lado.
  const otro = chat.participantes[0]?.usuario;

  if (!otro) return null;

  return {
    tipo: 'USUARIO',
    id: otro.id,
    nombre: `${otro.nombre} ${otro.apellido}`,
    imagenUrl: otro.imagenUrl,
    activo: otro.fechaBaja === null,
  };
}

function aConversacion(
  membresia: MembresiaConChat,
  usuarioId: number,
  refugioDelUsuario: number | null,
  ultimos: Map<number, UltimoMensajeFila>,
  noLeidos: Map<number, number>,
): FilaOrdenable | null {
  const { chat } = membresia;
  const contacto = resolverContacto(chat, refugioDelUsuario);

  if (!contacto) return null;

  const ultimo = ultimos.get(chat.id);

  // Una sala sin mensajes se ordena por su fecha de creación: es lo último que pasó en ella.
  const orden = ultimo?.fechaAlta ?? chat.fechaAlta;

  return {
    orden,
    conversacion: {
      chatId: chat.id,
      contacto,
      ultimoMensaje: ultimo
        ? {
            contenido: ultimo.contenido,
            fecha: ultimo.fechaAlta.toISOString(),
            esMio: ultimo.usuarioId === usuarioId,
            tieneImagen: ultimo.imagenUrl !== null,
            tieneVideo: ultimo.imagenUrl !== null && tipoDeUrl(ultimo.imagenUrl) === 'VIDEO',
            tipo: ultimo.tipo,
          }
        : null,
      noLeidos: noLeidos.get(chat.id) ?? 0,
      fechaUltimaActividad: orden.toISOString(),
    },
  };
}

export async function listarConversaciones(usuarioId: number): Promise<ListaChatsDto> {
  const [membresias, usuario] = await Promise.all([
    repo.listarChatsActivosDeUsuario(usuarioId),
    repo.buscarRefugioDeUsuario(usuarioId),
  ]);

  // Sin conversaciones el empty state es un estado normal de la pantalla, no un error — y
  // además evita mandar dos queries con una lista de ids vacía.
  if (membresias.length === 0) {
    return { total: 0, chats: [] };
  }

  const chatIds = membresias.map((membresia) => membresia.chatId);

  const [ultimos, conteos] = await Promise.all([
    repo.ultimoMensajePorChat(chatIds),
    repo.contarNoLeidosPorChat(usuarioId, chatIds),
  ]);

  const ultimoPorChat = new Map(ultimos.map((fila) => [fila.chatId, fila]));
  const noLeidosPorChat = new Map(conteos.map((fila) => [fila.chatId, fila.noLeidos]));
  const refugioDelUsuario = usuario?.refugioId ?? null;

  const filas = membresias
    .map((membresia) =>
      aConversacion(membresia, usuarioId, refugioDelUsuario, ultimoPorChat, noLeidosPorChat),
    )
    // Un chat sin contraparte activa es un dato inconsistente, no un caso de negocio: se
    // omite en vez de romper la pantalla entera, igual que en el listado de favoritos.
    .filter((fila): fila is FilaOrdenable => fila !== null);

  filas.sort((a, b) => b.orden.getTime() - a.orden.getTime());

  const chats = filas.map((fila) => fila.conversacion);

  // El total sale de la misma lista ya filtrada, para que el badge de la pestaña no pueda
  // discrepar de lo que se ve en el listado.
  return { total: chats.length, chats };
}

// ─────────────── HU-5.2 · Sala de conversación ───────────────

/**
 * Guard de toda la HU: sin fila activa en `UsuarioChat` no se entra a la sala.
 *
 * Es autorización por participación y no por rol, igual que el listado: quién puede leer una
 * conversación lo define haber sido puesto en ella, no ser adoptante o refugio. Lo usan el
 * historial, el marcado de leídos y `chat:unirse` del socket.
 *
 * 403 y no 404 a propósito: la sala existe, lo que falta es acceso. Devolver 404 para no
 * revelar su existencia sería contraproducente acá — el id sale del propio listado del
 * usuario, así que un 404 confundiría un chat ajeno con uno borrado.
 */
export async function exigirParticipante(usuarioId: number, chatId: number): Promise<void> {
  const membresia = await repo.buscarMembresiaActiva(usuarioId, chatId);

  if (!membresia) {
    throw new AppError('SIN_ACCESO_AL_CHAT', 'No tenés acceso a esta conversación', 403);
  }
}

type SalaConContacto = NonNullable<Awaited<ReturnType<typeof repo.buscarSalaConContacto>>>;

/** Igual que `exigirParticipante` pero trayendo la sala, para no repetir la query. */
async function exigirSala(usuarioId: number, chatId: number): Promise<SalaConContacto> {
  const sala = await repo.buscarSalaConContacto(usuarioId, chatId);

  if (!sala) {
    throw new AppError('SIN_ACCESO_AL_CHAT', 'No tenés acceso a esta conversación', 403);
  }

  return sala;
}

/** Hasta dónde tiene la sala leída y recibida un participante. */
interface MarcaParticipante {
  usuarioId: number;
  ultimaLectura: Date | null;
  ultimaEntrega: Date | null;
}

/** La fila de `mensaje` que este módulo devuelve al cliente. */
interface MensajeFila {
  id: number;
  chatId: number;
  contenido: string;
  imagenUrl: string | null;
  imagenes: string[];
  tipo: TipoMensaje;
  solicitudId: number | null;
  usuarioId: number;
  fechaAlta: Date;
}

/**
 * Estado de entrega de un mensaje según las marcas de la sala.
 *
 * Se mira a TODOS los participantes menos el autor: un mensaje está entregado cuando le
 * llegó a todos los demás y leído cuando todos los demás lo leyeron. `fechaLectura` es la
 * marca del ÚLTIMO en leerlo, que es el momento en que el mensaje pasó a estar leído para la
 * sala entera. En una conversación de dos —el único caso hoy— "todos los demás" es una sola
 * persona y esto se reduce a comparar contra su marca.
 *
 * Sin nadie más en la sala no hay a quién entregarle: queda sin entregar, que es honesto.
 */
function acuseDe(
  mensaje: { usuarioId: number; fechaAlta: Date },
  marcas: MarcaParticipante[],
): { entregado: boolean; leido: boolean; fechaLectura: string | null } {
  const destinatarios = marcas.filter((marca) => marca.usuarioId !== mensaje.usuarioId);

  if (destinatarios.length === 0) {
    return { entregado: false, leido: false, fechaLectura: null };
  }

  const cubre = (marca: Date | null): boolean => marca !== null && marca >= mensaje.fechaAlta;

  const leido = destinatarios.every((destinatario) => cubre(destinatario.ultimaLectura));

  // Leído implica entregado aunque la marca de entrega se haya perdido: no se puede leer
  // algo que no llegó.
  const entregado =
    leido || destinatarios.every((destinatario) => cubre(destinatario.ultimaEntrega));

  const fechaLectura = leido
    ? new Date(
        Math.max(...destinatarios.map((destinatario) => destinatario.ultimaLectura!.getTime())),
      ).toISOString()
    : null;

  return { entregado, leido, fechaLectura };
}

function aMensajeDto(
  mensaje: MensajeFila,
  marcas: MarcaParticipante[],
  solicitud: SolicitudEnChatDto | null,
): MensajeDto {
  return {
    id: mensaje.id,
    chatId: mensaje.chatId,
    contenido: mensaje.contenido,
    imagenUrl: mensaje.imagenUrl,
    imagenes: mensaje.imagenes,
    // Las mismas URLs que `imagenes`, cada una con su tipo. `imagenes` se conserva tal cual
    // para no romper a los clientes que ya la consumen.
    adjuntos: clasificarAdjuntos(mensaje.imagenes),
    usuarioId: mensaje.usuarioId,
    tipo: mensaje.tipo,
    ...acuseDe(mensaje, marcas),
    // La tarjeta sólo viaja en el mensaje que la anuncia, y sólo si es la solicitud de ESTA
    // sala: hoy no hay forma de referenciar otra, y traerla por mensaje sería un N+1.
    solicitud:
      mensaje.tipo === 'SOLICITUD' && solicitud !== null && solicitud.id === mensaje.solicitudId
        ? solicitud
        : null,
    fechaAlta: mensaje.fechaAlta.toISOString(),
  };
}

/** Resumen de la solicitud para la tarjeta embebida y el subtítulo de la cabecera. */
function aSolicitudEnChat(
  solicitud: NonNullable<Awaited<ReturnType<typeof repo.buscarSolicitudParaChat>>>,
): SolicitudEnChatDto {
  const { mascota } = solicitud.publicacion;

  return {
    id: solicitud.id,
    tipo: solicitud.tipoSolicitud.nombre,
    // Sin estado vigente la solicitud está inconsistente; se informa como pendiente en vez
    // de romper la sala entera, igual que el listado omite un chat sin contraparte.
    estado: solicitud.historicoEstados[0]?.estadoSolicitud.nombre ?? 'Pendiente',
    fechaAlta: solicitud.fechaAlta.toISOString(),
    mascota: {
      id: mascota.id,
      nombre: mascota.nombre,
      especie: mascota.raza.especie.nombre,
      fechaNacimiento: mascota.fechaNacimiento?.toISOString() ?? null,
      // La foto de la publicación manda sobre la de la mascota: es la que el adoptante vio.
      imagenUrl: solicitud.publicacion.imagenUrl ?? mascota.imagenUrl,
    },
  };
}

/**
 * Cuántos minutos suele tardar el contacto en responder en esta sala.
 *
 * Se recorre la conversación de atrás para adelante y se mide cada vez que el contacto
 * contesta: del primer mensaje nuestro sin responder hasta su respuesta. Se toma la MEDIANA
 * y no el promedio porque una sola respuesta al otro día —dormir, un fin de semana— corre el
 * promedio a un número que no describe nada.
 *
 * Mirando sólo los últimos mensajes de la sala: es un dato orientativo y la tabla no tiene
 * cota. Con menos de dos respuestas devuelve `null`, y el cliente no muestra la leyenda: es
 * preferible no decir nada a inventar una expectativa con un solo dato.
 */
function minutosDeRespuesta(
  mensajes: { usuarioId: number; fechaAlta: Date }[],
  contactoId: number,
): number | null {
  // El repository los devuelve del más nuevo al más viejo; acá se necesita el orden natural.
  const cronologicos = [...mensajes].reverse();

  const demoras: number[] = [];
  let preguntaPendiente: Date | null = null;

  for (const mensaje of cronologicos) {
    if (mensaje.usuarioId === contactoId) {
      if (preguntaPendiente !== null) {
        demoras.push(mensaje.fechaAlta.getTime() - preguntaPendiente.getTime());
        preguntaPendiente = null;
      }
      continue;
    }

    // Varios mensajes seguidos nuestros cuentan como una sola espera: la que arranca con el
    // primero, que es cuando el contacto podría haber contestado.
    preguntaPendiente ??= mensaje.fechaAlta;
  }

  if (demoras.length < MINIMO_RESPUESTAS) return null;

  demoras.sort((a, b) => a - b);
  const medio = Math.floor(demoras.length / 2);
  const mediana =
    demoras.length % 2 === 0 ? (demoras[medio - 1]! + demoras[medio]!) / 2 : demoras[medio]!;

  // Nunca 0: "responde en 0 minutos" se lee como un error, y por debajo del minuto el dato
  // no aporta nada.
  return Math.max(1, Math.round(mediana / 60_000));
}

/**
 * Cabecera de la sala: contacto resuelto y su presencia.
 *
 * Un chat sin contraparte activa se trata como inexistente en vez de devolver una cabecera a
 * medio pintar. Es el mismo criterio con el que el listado lo omite, sólo que acá el usuario
 * pidió esta sala en particular, así que corresponde decírselo.
 */
export async function obtenerCabecera(usuarioId: number, chatId: number): Promise<CabeceraChatDto> {
  const sala = await exigirSala(usuarioId, chatId);
  const refugio = await repo.buscarRefugioDeUsuario(usuarioId);
  const contacto = resolverContacto(sala.chat, refugio?.refugioId ?? null);

  if (!contacto) {
    throw new AppError('CHAT_SIN_CONTACTO', 'Esta conversación ya no tiene contraparte', 404);
  }

  const [ultimos, ultimaSolicitud] = await Promise.all([
    repo.ultimosMensajesParaRespuesta(chatId, MENSAJES_PARA_RESPUESTA),
    repo.buscarUltimaSolicitudDelChat(chatId),
  ]);

  // La cabecera nombra la solicitud VIGENTE de la sala —la última tarjeta—, no la que la
  // abrió: una conversación con un refugio acumula pedidos y `chat.solicitudId` es sólo el
  // primero.
  const solicitud =
    ultimaSolicitud?.solicitudId == null
      ? null
      : await repo.buscarSolicitudParaChat(ultimaSolicitud.solicitudId);

  // El tiempo de respuesta se mide contra QUIEN CONTESTA, que es una persona aunque la
  // contraparte se muestre como refugio: un refugio no emite mensajes, los emite su gente.
  const quienResponde = sala.chat.participantes[0]?.usuarioId ?? null;

  return {
    chatId: sala.chatId,
    contacto,
    // Un refugio es una institución, no una sesión: sólo las personas se conectan.
    enLinea: contacto.tipo === 'USUARIO' && estaEnLinea(contacto.id),
    minutosRespuesta: quienResponde === null ? null : minutosDeRespuesta(ultimos, quienResponde),
    solicitud: solicitud === null ? null : aSolicitudEnChat(solicitud),
  };
}

/**
 * Una página del historial, de la más reciente a la más vieja.
 *
 * Se pide una fila de más que el límite para saber si quedan mensajes anteriores sin una
 * segunda query de conteo; esa fila extra se descarta y su id no sale nunca al cliente.
 */
export async function listarHistorial(
  usuarioId: number,
  chatId: number,
  query: HistorialQuery,
): Promise<HistorialMensajesDto> {
  await exigirParticipante(usuarioId, chatId);

  // Un cursor de otra sala paginaría desde un punto arbitrario de esta: se corta antes.
  if (query.antesDe !== undefined) {
    const cursor = await repo.buscarMensajeDeChat(chatId, query.antesDe);

    if (!cursor) {
      throw new AppError('CURSOR_INVALIDO', 'No pudimos seguir cargando la conversación', 400);
    }
  }

  const [filas, marcas] = await Promise.all([
    repo.listarMensajes(chatId, query.limite, query.antesDe),
    repo.marcasDeParticipantes(chatId),
  ]);

  const hayMas = filas.length > query.limite;
  const pagina = hayMas ? filas.slice(0, query.limite) : filas;

  // La solicitud se pide sólo si la página trae la tarjeta que la anuncia: la mayoría de las
  // páginas son mensajes de texto y no tienen por qué pagar esa query.
  const solicitudId = pagina.find((fila) => fila.tipo === 'SOLICITUD')?.solicitudId ?? null;
  const solicitud = solicitudId === null ? null : await repo.buscarSolicitudParaChat(solicitudId);

  const resumen = solicitud === null ? null : aSolicitudEnChat(solicitud);

  return {
    mensajes: pagina.map((fila) => aMensajeDto(fila, marcas, resumen)),
    hayMas,
    proximoCursor: hayMas ? (pagina[pagina.length - 1]?.id ?? null) : null,
  };
}

export interface ContextoEnvio {
  usuarioId: number;
  chatId: number;
  /** Fotos ya comprimidas, en el orden en que las eligió quien escribe. */
  archivos?: { buffer: Buffer; mimetype: string }[];
}

/**
 * Alta de mensaje: persiste primero y recién después emite por socket.
 *
 * El orden es el punto de toda la decisión de hacer esto por REST: cuando el cliente recibe
 * el 201 el mensaje YA está en base, con su id y su fecha reales. Si el socket está caído el
 * envío funciona igual —el otro lo ve al refetchear—, porque el tiempo real es una
 * optimización de entrega y no el canal de escritura.
 *
 * Todas las validaciones corren ANTES de tocar el storage: guardar la imagen primero
 * dejaría un archivo huérfano cada vez que el envío se rechaza.
 */
export async function enviarMensaje(
  datos: EnviarMensajeDto,
  contexto: ContextoEnvio,
): Promise<MensajeDto> {
  const sala = await exigirSala(contexto.usuarioId, contexto.chatId);
  const archivos = contexto.archivos ?? [];

  // Un mensaje puede ser sólo texto o sólo foto, pero no nada.
  if (!datos.contenido && archivos.length === 0) {
    throw new AppError('MENSAJE_VACIO', 'Escribí un mensaje o adjuntá una foto', 400);
  }

  // El middleware de upload ya corta por cantidad; esto cubre el caso de que alguien llame
  // al service desde otro lado (un job, un test) sin pasar por la ruta.
  if (archivos.length > LIMITES.mensaje.fotos.maximo) {
    throw new AppError(
      'DEMASIADOS_ARCHIVOS',
      `Podés subir hasta ${LIMITES.mensaje.fotos.maximo} archivos`,
      400,
    );
  }

  // Un video por mensaje y sin mezclar con fotos: la grilla del artboard 37 tiene
  // disposiciones propias para 1, 2, 3 y 4+ miniaturas y un video en el medio obliga a
  // resolver miniatura, visor y validación de un caso que ninguna HU pidió. El middleware
  // no puede hacer cumplir esto: mira un archivo por vez, no el conjunto.
  const videos = archivos.filter((archivo) => esMimeDeVideo(archivo.mimetype));

  if (videos.length > LIMITES.mensaje.videos.maximo) {
    throw new AppError('DEMASIADOS_ARCHIVOS', 'Podés adjuntar un solo video por mensaje', 400);
  }

  if (
    !LIMITES.mensaje.videos.mezclaConFotos &&
    videos.length > 0 &&
    videos.length !== archivos.length
  ) {
    throw new AppError(
      'ADJUNTOS_MEZCLADOS',
      'Mandá el video solo: no se puede combinar con fotos en el mismo mensaje',
      400,
    );
  }

  const refugio = await repo.buscarRefugioDeUsuario(contexto.usuarioId);
  const contacto = resolverContacto(sala.chat, refugio?.refugioId ?? null);

  if (!contacto) {
    throw new AppError('CHAT_SIN_CONTACTO', 'Esta conversación ya no tiene contraparte', 404);
  }

  // Leer una conversación con alguien dado de baja se puede; escribirle no. El listado
  // expone `activo` justamente para que el cliente deshabilite el input antes de llegar acá.
  if (!contacto.activo) {
    throw new AppError(
      'CONTACTO_INACTIVO',
      'No podés escribirle: la cuenta de este contacto fue dada de baja',
      409,
    );
  }

  // En paralelo y en orden: `guardarImagenes` conserva la posición de cada archivo, que es
  // la que el cliente ve en la grilla.
  const imagenes = archivos.length === 0 ? [] : await guardarImagenes(archivos, SUBCARPETA_FOTOS);

  let mensaje;
  try {
    mensaje = await repo.crearMensaje({
      chatId: contexto.chatId,
      usuarioId: contexto.usuarioId,
      contenido: datos.contenido,
      imagenes,
    });
  } catch (err) {
    // No dejar las fotos huérfanas si la escritura en base falló.
    await borrarImagenes(imagenes);
    throw err;
  }

  // Un mensaje recién nacido no puede estar entregado ni leído: sin marcas que consultar.
  const dto = aMensajeDto(mensaje, [], null);

  // Los participantes salen de la sala que ya trajimos: no hace falta otra query. El emisor
  // se incluye a propósito, para que se sincronicen sus otros dispositivos.
  const participantes = [
    contexto.usuarioId,
    ...sala.chat.participantes.map((participante) => participante.usuarioId),
  ];

  emisor.emitirMensajeNuevo(dto, participantes);

  return dto;
}

/**
 * Marca como leída la conversación entera y sincroniza los contadores.
 *
 * "Leer" sigue siendo una operación de SALA y no de mensaje —el cliente no acusa mensaje por
 * mensaje—, pero ahora se guarda como una marca de tiempo propia de quien lee, así que dos
 * participantes pueden ir por lugares distintos de la conversación sin pisarse.
 *
 * El techo es el último mensaje ajeno y no `new Date()`: con el reloj del servidor se
 * estaría marcando como leído un mensaje que entre entre la consulta y la escritura.
 *
 * `noLeidos` vuelve siempre en 0 —se acaba de marcar todo— para que el cliente actualice el
 * ítem del listado de HU-5.1 en memoria, sin refetch. `marcados` es cuántos cambiaron de
 * verdad: 0 al reabrir una sala que ya estaba leída, que es el caso normal.
 *
 * Se emite sólo si algo cambió: reabrir una sala leída no tiene por qué despertar a nadie.
 */
export async function marcarLeidos(usuarioId: number, chatId: number): Promise<LeidosDto> {
  await exigirParticipante(usuarioId, chatId);

  const ultimo = await repo.ultimoMensajeAjeno(chatId, usuarioId);

  if (!ultimo) return { chatId, noLeidos: 0, marcados: 0 };

  const marcados = await repo.acusarHasta(chatId, usuarioId, 'lectura', ultimo.fechaAlta);

  if (marcados > 0) {
    // A la sala: habilita el doble check en la pantalla del emisor.
    emisor.emitirLeido(chatId, usuarioId, ultimo.fechaAlta.toISOString());
    // A los otros dispositivos de quien leyó: les baja el badge.
    emisor.emitirNoLeidos(usuarioId, chatId, 0);
  }

  return { chatId, noLeidos: 0, marcados };
}

/**
 * Acusa que los mensajes de la sala LLEGARON a este usuario, aunque no los haya abierto.
 *
 * Es el segundo tilde. Existe aparte de `marcarLeidos` porque son dos hechos distintos: el
 * cliente llama a éste apenas recibe el evento de mensaje nuevo —esté donde esté, incluso en
 * el listado— y al otro sólo cuando abre la conversación.
 *
 * Va por REST y no por socket para no convertir el socket en un canal de escritura: seguiría
 * necesitando su propia validación y su propio manejo de errores, duplicando lo que el
 * pipeline HTTP ya hace. El precio es una petición por ráfaga de mensajes, que es barata
 * porque escribe una sola fila.
 */
export async function marcarEntregados(usuarioId: number, chatId: number): Promise<EntregadosDto> {
  await exigirParticipante(usuarioId, chatId);

  const ultimo = await repo.ultimoMensajeAjeno(chatId, usuarioId);

  if (!ultimo) return { chatId, marcados: 0, hasta: null };

  const marcados = await repo.acusarHasta(chatId, usuarioId, 'entrega', ultimo.fechaAlta);

  if (marcados > 0) {
    emisor.emitirEntregado(chatId, usuarioId, ultimo.fechaAlta.toISOString());
  }

  return { chatId, marcados, hasta: ultimo.fechaAlta.toISOString() };
}

// ─────────────── La sala que nace de una solicitud (CONSTITUTION §7) ───────────────

/** Texto de la tarjeta embebida. Lo pone la UI; acá va sólo lo que identifica al hecho. */
const CONTENIDO_MENSAJE_SOLICITUD = '';

/**
 * Deja la tarjeta de una solicitud en la conversación con su contraparte, abriéndola si
 * todavía no existe.
 *
 * **La sala es entre las partes, no entre las solicitudes.** Un adoptante que pide una
 * segunda mascota al mismo refugio —o vuelve a intentar con la misma— sigue en la
 * conversación que ya tenía, y la tarjeta nueva aparece ahí. Se abre una sala nueva sólo
 * cuando no hay ninguna viva entre los dos. `chat.solicitudId` queda como la que la ABRIÓ;
 * cada tarjeta lleva la suya en `mensaje.solicitudId`.
 *
 * Es el único lugar donde se crean chats, y por eso concentra las condiciones que
 * `docs/api-chats.md` venía anotando:
 *
 * 1. **CONSTITUTION §7** — sólo hay chat tras una interacción previa. Acá la interacción es
 *    la solicitud misma, que el llamador ya persistió.
 * 2. **Fila de `UsuarioChat` para TODOS** los participantes, incluidos los miembros del
 *    refugio: la autorización del módulo es la membresía, así que sin ellas el refugio no
 *    vería la conversación en GUI-31 ni podría entrar.
 * 3. **`Chat.refugioId`** cuando la contraparte es un refugio: de eso depende qué nombre e
 *    imagen muestra el listado, y es la clave con la que se reencuentra la sala.
 * 4. **Sin salas duplicadas**: se busca la existente antes de crear, y el índice único
 *    parcial sobre `solicitud_id` cubre dos requests concurrentes de la misma solicitud.
 * 5. **`chat_tipo` no se escribe**: sus valores siguen sin definirse en MODELO_DATOS.md.
 *
 * No lanza: si algo falla, la solicitud ya se creó y no tiene por qué caerse por no haber
 * podido abrir la sala. Devuelve el id del chat o `null`.
 */
export async function asegurarChatDeSolicitud(solicitudId: number): Promise<number | null> {
  // Idempotente: un reintento no deja dos tarjetas de la misma solicitud.
  const yaAnunciada = await repo.buscarMensajeDeSolicitud(solicitudId);
  if (yaAnunciada) return yaAnunciada.chatId;

  const solicitud = await repo.buscarSolicitudParaChat(solicitudId);
  if (!solicitud) return null;

  const { mascota } = solicitud.publicacion;
  const refugioId = mascota.refugioId;

  // Del otro lado está el refugio entero o, si la publicó una persona, esa persona.
  const contraparte = refugioId
    ? (await repo.listarMiembrosDeRefugio(refugioId)).map((miembro) => miembro.id)
    : [mascota.usuarioId];

  const participantesIds = [
    ...new Set([solicitud.usuarioId, ...contraparte].filter((id) => id !== undefined)),
  ];

  // Sin contraparte no hay conversación posible: una mascota de refugio sin ningún miembro
  // activo, o alguien solicitando su propia publicación (que el módulo de solicitudes ya
  // rechaza antes de llegar acá).
  if (participantesIds.length < 2) return null;

  const existente = await repo.buscarChatEntre(
    solicitud.usuarioId,
    refugioId ? { refugioId } : { usuarioId: mascota.usuarioId },
  );

  const chatId =
    existente?.id ??
    (
      await repo.crearChatDeSolicitud({
        solicitudId,
        refugioId: refugioId ?? null,
        participantesIds,
        // El alta es del solicitante: es quien disparó la interacción que habilita la sala.
        creadoPor: solicitud.usuarioId,
      })
    ).id;

  // La tarjeta la emite SISTEMA y no el solicitante: no es algo que él haya escrito, y con
  // su autoría se pintaría como una burbuja propia en su pantalla.
  const mensaje = await repo.crearMensaje({
    chatId,
    usuarioId: USUARIO_SISTEMA_ID,
    contenido: CONTENIDO_MENSAJE_SOLICITUD,
    imagenes: [],
    tipo: 'SOLICITUD',
    solicitudId,
  });

  emisor.emitirMensajeNuevo(
    aMensajeDto(mensaje, [], aSolicitudEnChat(solicitud)),
    participantesIds,
  );

  return chatId;
}
