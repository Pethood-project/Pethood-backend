/**
 * Nombres de eventos y de salas, en un solo lugar.
 *
 * Están acá y no sueltos como strings porque el contrato de `docs/api-chat-sala.md` los fija
 * literalmente: el frontend escucha estos nombres exactos y un typo del lado del server no
 * falla ruidosamente, simplemente no llega nada.
 */

export const EVENTOS = {
  /** cliente → server. Entrar a la sala. Responde por ack. */
  UNIRSE: 'chat:unirse',
  /** cliente → server. Salir de la sala (no implica desconectarse). */
  SALIR: 'chat:salir',
  /** server → cliente. Un mensaje nuevo, con la misma forma que el del historial. */
  MENSAJE_NUEVO: 'chat:mensaje-nuevo',
  /** server → sala. Alguien leyó la conversación: habilita el doble check del emisor. */
  LEIDO: 'chat:leido',
  /** server → sala personal. Contador de la pestaña Chat (HU-5.1) en otros dispositivos. */
  NO_LEIDOS: 'chat:no-leidos',
  /** server → sala. El contacto se conectó o se desconectó. */
  PRESENCIA: 'chat:presencia',
  /** server → cliente. Error no solicitado (ej. token vencido con el socket abierto). */
  ERROR: 'chat:error',
} as const;

/**
 * Sala de una conversación. Sólo se une quien tiene la pantalla abierta, y sólo después de
 * verificar que sea participante activo.
 */
export function salaChat(chatId: number): string {
  return `chat:${chatId}`;
}

/**
 * Sala personal: TODOS los sockets de un usuario, unidos apenas se autentican.
 *
 * Es lo que permite avisarle a alguien que llegó un mensaje aunque no tenga esa
 * conversación abierta —para el badge del listado— y sincronizar sus otros dispositivos.
 */
export function salaUsuario(usuarioId: number): string {
  return `usuario:${usuarioId}`;
}
