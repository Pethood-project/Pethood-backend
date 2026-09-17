/**
 * Autenticación del socket.
 *
 * El JWT no viaja en headers HTTP: en un websocket sólo hay un handshake. Va en
 * `handshake.auth.token`, que es donde socket.io lo espera y —a diferencia de la query
 * string— no termina escrito en los logs de acceso ni en el historial de proxies.
 *
 * Se verifica con el MISMO `verificarToken` que el middleware REST: un solo lugar donde vive
 * la verdad sobre qué token es válido.
 */
import type { Server, Socket } from 'socket.io';
import jwt from 'jsonwebtoken';
import { verificarToken } from '../shared/jwt';
import { EVENTOS } from './eventos';

/** Datos que quedan colgados del socket una vez autenticado. */
export interface DatosSocket {
  usuarioId: number;
  /** Vencimiento del token en epoch-segundos, o `undefined` si el token no lo trae. */
  expiraEn?: number;
}

function tokenDelHandshake(socket: Socket): string | undefined {
  const enAuth = socket.handshake.auth?.token;

  if (typeof enAuth === 'string' && enAuth.length > 0) {
    // Se tolera "Bearer xxx" además del token pelado: es el error de tipeo más probable del
    // cliente, que viene de mandar el mismo string que en REST.
    return enAuth.startsWith('Bearer ') ? enAuth.slice('Bearer '.length) : enAuth;
  }

  return undefined;
}

/**
 * Middleware de conexión. Rechazar acá cierra el socket antes de que exista: el cliente
 * recibe `connect_error` y no llega a emitir nada.
 */
export function autenticarSocket(socket: Socket, next: (err?: Error) => void): void {
  const token = tokenDelHandshake(socket);

  if (!token) {
    next(new Error('NO_AUTENTICADO'));
    return;
  }

  try {
    const payload = verificarToken(token);
    const decodificado = jwt.decode(token);

    const datos: DatosSocket = {
      usuarioId: payload.usuarioId,
      expiraEn:
        typeof decodificado === 'object' && decodificado !== null
          ? (decodificado as jwt.JwtPayload).exp
          : undefined,
    };

    socket.data = datos;
    next();
  } catch {
    next(new Error('NO_AUTENTICADO'));
  }
}

/**
 * Desconecta el socket cuando vence el token que lo autenticó.
 *
 * Sin esto, un socket abierto sería una sesión eterna: el handshake se verifica una sola vez
 * y después nadie vuelve a mirar el `exp`. Eso contradice el esquema stateless con
 * expiración del proyecto (CONSTITUTION §4) — la conexión sobreviviría a la credencial.
 *
 * Se avisa antes de cortar para que el cliente pueda refrescar el token (ya existe
 * `refrescarToken`) y reconectar sin que el usuario vea un error.
 */
export function programarVencimiento(socket: Socket): void {
  const { expiraEn } = socket.data as DatosSocket;

  if (!expiraEn) return;

  const milisegundos = expiraEn * 1000 - Date.now();

  // Un token ya vencido no debería haber pasado la verificación, pero si pasa se corta ya.
  if (milisegundos <= 0) {
    socket.disconnect(true);
    return;
  }

  const temporizador = setTimeout(() => {
    socket.emit(EVENTOS.ERROR, {
      error: { codigo: 'NO_AUTENTICADO', mensaje: 'Tu sesión expiró, volvé a iniciar sesión' },
    });
    socket.disconnect(true);
  }, milisegundos);

  // Sin `unref` un socket con token largo mantendría vivo el proceso al apagarlo.
  temporizador.unref?.();

  socket.on('disconnect', () => clearTimeout(temporizador));
}

/** Aplica la autenticación a todas las conexiones del servidor. */
export function instalarAutenticacion(io: Server): void {
  io.use(autenticarSocket);
}
