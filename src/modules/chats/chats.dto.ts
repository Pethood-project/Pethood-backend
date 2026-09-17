/**
 * Entrada y salida del módulo de chat: listado de conversaciones (HU-5.1) y sala de
 * conversación (HU-5.2).
 *
 * El listado no tiene schemas de entrada —no recibe body ni query params— pero la sala sí:
 * el historial pagina por cursor y el envío recibe texto y/o imagen. Si HU-5.3 (búsqueda
 * por nombre de contacto) agrega un query param, su schema se compone acá.
 */
import { z } from 'zod';
import { LIMITES } from '../../shared/validation/limits';
import { idSchema, textoOpcionalNoNuloSchema } from '../../shared/validation/schemas';

/**
 * El otro lado de la conversación, YA RESUELTO por el backend.
 *
 * El cliente no tiene que averiguar cuál de los dos participantes es "el otro" ni si es una
 * persona o un refugio: recibe nombre e imagen listos para pintar la fila.
 */
export interface ContactoChatDto {
  /**
   * DERIVADO por el backend, no es `chat_tipo`: sale de si el chat tiene refugio y de si
   * quien mira pertenece a ese refugio. `chat_tipo` no se lee — sus valores no están
   * definidos en MODELO_DATOS.md.
   */
  tipo: 'USUARIO' | 'REFUGIO';
  /** Id del Usuario o del Refugio según `tipo`. NO es el id del chat. */
  id: number;
  /** "Nombre Apellido" si es un usuario, la razón social si es un refugio. */
  nombre: string;
  imagenUrl: string | null;
  /**
   * `false` si la cuenta del contacto está dada de baja. El chat se muestra igual: el
   * placeholder ("cuenta dada de baja", grisado, input deshabilitado) lo decide el cliente,
   * el backend manda el hecho y no el texto.
   */
  activo: boolean;
}

/** Vista previa del último mensaje. `null` si la sala todavía no tiene ninguno. */
export interface UltimoMensajeDto {
  /** Sin truncar: el recorte visual es del cliente. */
  contenido: string;
  /** ISO 8601 crudo. El "hace 5 min" lo formatea el cliente. */
  fecha: string;
  /** Para el prefijo "Vos: ..." sin que el cliente compare ids. */
  esMio: boolean;
  /** Un mensaje puede ser sólo foto: sin esto el preview quedaría vacío. */
  tieneImagen: boolean;
}

/**
 * Una fila de la lista de chats (GUI-08 / GUI-31).
 *
 * La forma está pensada para que sea también el payload de un evento de websocket
 * "llegó un mensaje nuevo" (HU-5.2): es autocontenida, `chatId` es un identificador estable
 * y `noLeidos` es un número absoluto, no un delta. Así el cliente reemplaza el ítem entero
 * y reordena en memoria, sin refetch del listado.
 */
export interface ConversacionDto {
  chatId: number;
  contacto: ContactoChatDto;
  ultimoMensaje: UltimoMensajeDto | null;
  /** Mensajes del chat que el usuario autenticado no emitió y todavía no leyó. */
  noLeidos: number;
  /**
   * Clave de orden, NUNCA null: fecha del último mensaje o, si la sala está vacía, fecha de
   * creación del chat. Viaja aparte de `ultimoMensaje.fecha` para que el cliente pueda
   * reordenar sin ramificar por el caso vacío.
   */
  fechaUltimaActividad: string;
}

/**
 * `total` alimenta el badge de la pestaña Chat.
 *
 * Hoy es siempre `chats.length` porque el listado no pagina — viaja como campo aparte, igual
 * que en Favoritos, para que agregar paginación no cambie la forma del contrato y el
 * contador pueda seguir siendo el total real y no el de la página.
 */
export interface ListaChatsDto {
  total: number;
  chats: ConversacionDto[];
}

// ─────────────── HU-5.2 · Sala de conversación (GUI-14) ───────────────

/**
 * Un mensaje, con la MISMA forma en el historial REST y en el evento `chat:mensaje-nuevo`
 * del socket. Es deliberado: el cliente usa un solo tipo y un solo mapper, y puede mezclar
 * en una lista mensajes que llegaron por caminos distintos.
 *
 * No lleva `esMio` calculado por el backend: viaja `usuarioId` y el cliente lo compara con
 * su sesión. Es un dato, no una vista — a diferencia del `esMio` del preview de HU-5.1, que
 * existe para no obligar al listado a conocer al emisor de cada última línea.
 */
export interface MensajeDto {
  id: number;
  /** Redundante dentro del historial, imprescindible en el evento de socket. */
  chatId: number;
  /** Cadena vacía en un mensaje de solo foto. Sin truncar. */
  contenido: string;
  /** Ruta relativa (`/api/v1/archivos/chats/...`) o null si el mensaje es solo texto. */
  imagenUrl: string | null;
  /** Id del emisor. El cliente decide de qué lado de la burbuja va. */
  usuarioId: number;
  leido: boolean;
  /** ISO 8601 crudo. La hora la formatea el cliente. */
  fechaAlta: string;
}

/**
 * Una página del historial, de la más reciente a la más vieja.
 *
 * El orden DESCENDENTE es el que consume una lista invertida (`FlatList inverted`), el que
 * devuelve el índice sin ordenar aparte y el que hace que el cursor signifique "seguir
 * hacia atrás". El cliente NO tiene que dar vuelta la página.
 */
export interface HistorialMensajesDto {
  mensajes: MensajeDto[];
  /** `true` si quedan mensajes más viejos que pedir con `antesDe`. */
  hayMas: boolean;
  /**
   * Id a mandar como `antesDe` para traer la página siguiente (o sea, la anterior en el
   * tiempo). `null` cuando ya se llegó al principio de la conversación.
   */
  proximoCursor: number | null;
}

/**
 * Cabecera de la sala (GUI-14): con esto la pantalla se pinta sola.
 *
 * Existe porque abrir el chat desde una notificación push (HU-4.3) o por deep link no pasa
 * por el listado, así que no hay de dónde sacar nombre ni foto del contacto.
 */
export interface CabeceraChatDto {
  chatId: number;
  contacto: ContactoChatDto;
  /**
   * Presencia en vivo del contacto, tomada del registro en memoria de websockets. Es un
   * snapshot del momento del pedido: a partir de ahí lo actualiza `chat:presencia`.
   */
  enLinea: boolean;
}

/**
 * Resultado de marcar la sala como leída.
 *
 * `noLeidos: 0` es constante por definición —se acaba de marcar todo— pero viaja igual para
 * que el cliente actualice el ítem del listado de HU-5.1 en memoria sin refetch ni cuentas
 * propias. `marcados` es cuántos cambiaron de estado en esta llamada: 0 si ya estaba todo
 * leído, que es el caso normal al reabrir una sala.
 */
export interface LeidosDto {
  chatId: number;
  noLeidos: number;
  marcados: number;
}

/**
 * Query del historial. Ausencia de `antesDe` = primera página (la más reciente).
 *
 * El cursor es un id de mensaje y no un offset: mientras el usuario scrollea hacia arriba
 * pueden entrar mensajes nuevos, y con offset esa ventana se corre y termina duplicando o
 * salteando filas.
 */
export const historialQuerySchema = z.object({
  antesDe: idSchema('El cursor').optional(),
  limite: z.coerce
    .number()
    .int()
    .positive()
    .max(LIMITES.mensaje.pagina.maximo)
    .optional()
    .default(LIMITES.mensaje.pagina.porDefecto),
});

export type HistorialQuery = z.infer<typeof historialQuerySchema>;

/**
 * Body del envío. El texto es opcional porque un mensaje puede ser solo foto; que venga al
 * menos uno de los dos lo valida el service, que es el único que ve el archivo.
 */
export const enviarMensajeSchema = z.object({
  contenido: textoOpcionalNoNuloSchema({
    max: LIMITES.mensaje.contenido.max,
    etiqueta: 'El mensaje',
  }),
});

export type EnviarMensajeDto = z.infer<typeof enviarMensajeSchema>;
