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
 * No se escribe en `logAuditoria` en ninguna de las dos HU: leer no es una operación
 * crítica, y enviar un mensaje ya queda registrado de forma permanente en `mensaje`, que es
 * append-only por definición del modelo.
 */
import { AppError } from '../../middlewares/errorHandler';
import { borrarImagen, guardarImagen } from '../../shared/storage';
import { estaEnLinea } from '../../websockets/presencia';
import * as emisor from '../../websockets/emisor';
import type {
  CabeceraChatDto,
  ConversacionDto,
  ContactoChatDto,
  EnviarMensajeDto,
  HistorialMensajesDto,
  HistorialQuery,
  LeidosDto,
  ListaChatsDto,
  MensajeDto,
} from './chats.dto';
import * as repo from './chats.repository';
import type { UltimoMensajeFila } from './chats.repository';

/** Las fotos de chat van con el resto de los archivos subidos, en su propia subcarpeta. */
const SUBCARPETA_FOTOS = 'chats';

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
  const noLeidosPorChat = new Map(conteos.map((fila) => [fila.chatId, fila._count._all]));
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

function aMensajeDto(mensaje: {
  id: number;
  chatId: number;
  contenido: string;
  imagenUrl: string | null;
  usuarioId: number;
  leido: boolean;
  fechaAlta: Date;
}): MensajeDto {
  return {
    id: mensaje.id,
    chatId: mensaje.chatId,
    contenido: mensaje.contenido,
    imagenUrl: mensaje.imagenUrl,
    usuarioId: mensaje.usuarioId,
    leido: mensaje.leido,
    fechaAlta: mensaje.fechaAlta.toISOString(),
  };
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

  return {
    chatId: sala.chatId,
    contacto,
    // Un refugio es una institución, no una sesión: sólo las personas se conectan.
    enLinea: contacto.tipo === 'USUARIO' && estaEnLinea(contacto.id),
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

  const filas = await repo.listarMensajes(chatId, query.limite, query.antesDe);
  const hayMas = filas.length > query.limite;
  const pagina = hayMas ? filas.slice(0, query.limite) : filas;

  return {
    mensajes: pagina.map(aMensajeDto),
    hayMas,
    proximoCursor: hayMas ? (pagina[pagina.length - 1]?.id ?? null) : null,
  };
}

export interface ContextoEnvio {
  usuarioId: number;
  chatId: number;
  archivo?: { buffer: Buffer; mimetype: string };
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

  // Un mensaje puede ser sólo texto o sólo foto, pero no nada.
  if (!datos.contenido && !contexto.archivo) {
    throw new AppError('MENSAJE_VACIO', 'Escribí un mensaje o adjuntá una foto', 400);
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

  const imagenUrl = contexto.archivo
    ? await guardarImagen(contexto.archivo, SUBCARPETA_FOTOS)
    : null;

  let mensaje;
  try {
    mensaje = await repo.crearMensaje({
      chatId: contexto.chatId,
      usuarioId: contexto.usuarioId,
      contenido: datos.contenido,
      imagenUrl,
    });
  } catch (err) {
    // No dejar la foto huérfana si la escritura en base falló.
    if (imagenUrl) await borrarImagen(imagenUrl);
    throw err;
  }

  const dto = aMensajeDto(mensaje);

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
 * `noLeidos` vuelve siempre en 0 —se acaba de marcar todo— para que el cliente actualice el
 * ítem del listado de HU-5.1 en memoria, sin refetch. `marcados` es cuántos cambiaron de
 * verdad: 0 al reabrir una sala que ya estaba leída, que es el caso normal.
 *
 * Se emite sólo si algo cambió: reabrir una sala leída no tiene por qué despertar a nadie.
 */
export async function marcarLeidos(usuarioId: number, chatId: number): Promise<LeidosDto> {
  await exigirParticipante(usuarioId, chatId);

  const marcados = await repo.marcarMensajesLeidos(chatId, usuarioId);

  if (marcados > 0) {
    // A la sala: habilita el doble check en la pantalla del emisor.
    emisor.emitirLeido(chatId, usuarioId);
    // A los otros dispositivos de quien leyó: les baja el badge.
    emisor.emitirNoLeidos(usuarioId, chatId, 0);
  }

  return { chatId, noLeidos: 0, marcados };
}
