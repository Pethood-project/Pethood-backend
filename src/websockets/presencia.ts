/**
 * Registro de presencia: quién está conectado ahora mismo.
 *
 * Vive EN MEMORIA a propósito. La alternativa —persistir una "última conexión" en Usuario—
 * es una columna nueva, o sea un cambio de estructura, y esta HU no toca el modelo. El
 * precio es que la presencia se pierde al reiniciar el proceso, lo cual es correcto: si el
 * server se cayó, nadie está conectado.
 *
 * ⚠️ Vale para UNA instancia. Al escalar horizontalmente cada proceso conocería sólo a sus
 * propios sockets, y haría falta el adapter de Redis de Socket.io para compartir el mapa.
 * Está anotado en docs/api-chat-sala.md.
 *
 * Es un Set de sockets y no un contador porque una desconexión sucia puede reportarse dos
 * veces: sumar y restar dejaría el contador en negativo, mientras que borrar dos veces el
 * mismo id es idempotente. Y hace falta el conjunto igual, porque un usuario con la app en
 * el celular y la web abierta tiene dos sockets y sigue en línea hasta que caen los dos.
 */

const socketsPorUsuario = new Map<number, Set<string>>();

/** Registra un socket. Devuelve `true` si el usuario ACABA de pasar a estar en línea. */
export function registrarConexion(usuarioId: number, socketId: string): boolean {
  const sockets = socketsPorUsuario.get(usuarioId);

  if (!sockets) {
    socketsPorUsuario.set(usuarioId, new Set([socketId]));
    return true;
  }

  sockets.add(socketId);
  return false;
}

/** Da de baja un socket. Devuelve `true` si era el último y el usuario quedó desconectado. */
export function registrarDesconexion(usuarioId: number, socketId: string): boolean {
  const sockets = socketsPorUsuario.get(usuarioId);

  if (!sockets) return false;

  sockets.delete(socketId);

  if (sockets.size > 0) return false;

  socketsPorUsuario.delete(usuarioId);
  return true;
}

export function estaEnLinea(usuarioId: number): boolean {
  return socketsPorUsuario.has(usuarioId);
}

/** Sólo para tests: deja el registro como recién arrancado. */
export function limpiarPresencia(): void {
  socketsPorUsuario.clear();
}
