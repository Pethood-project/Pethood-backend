/**
 * Con qué identidad actúa el usuario en esta operación: la personal o la de su refugio.
 *
 * Es el switch "vista refugio" del frontend (`useSesion().vistaRefugio`). La cuenta es una
 * sola (no hay multicuentas), pero quien pertenece a un refugio la usa como si fueran dos
 * perfiles que comparten login, estrictamente separados:
 *
 * - PERSONAL: sus mascotas personales, lo que publicó a título propio, lo que solicitó,
 *   sus favoritos, sus seguimientos como adoptante y sus chats personales. No ve nada
 *   del refugio.
 * - REFUGIO: las mascotas, publicaciones, solicitudes recibidas, seguimientos y chats del
 *   refugio. No adopta ni guarda favoritos, y no ve nada de lo personal.
 *
 * Viaja en la cabecera `X-Ambito` de cada pedido y lo resuelve `autenticar` en
 * `req.ambito`, así ningún módulo lo tiene que parsear por su cuenta. Sin cabecera, un
 * miembro de refugio queda en REFUGIO (la app siempre arranca ahí, y el panel web solo
 * trabaja como refugio) y cualquier otro usuario en PERSONAL.
 */
import { ROL_API } from './roles';

export const AMBITOS = ['PERSONAL', 'REFUGIO'] as const;
export type Ambito = (typeof AMBITOS)[number];

/** Nombre de la cabecera, en minúsculas porque así la expone Express en `req.headers`. */
export const CABECERA_AMBITO = 'x-ambito';

export type ResolucionAmbito =
  { ok: true; ambito: Ambito } | { ok: false; motivo: 'INVALIDO' | 'SIN_REFUGIO' };

/**
 * Traduce la cabecera al ámbito efectivo del pedido. Pedir REFUGIO sin pertenecer a uno es
 * un error y no un PERSONAL silencioso: la app no debería llegar a mandarlo, y degradarlo
 * escondería el bug.
 */
export function resolverAmbito(cabecera: unknown, roles: string[]): ResolucionAmbito {
  const esMiembro = roles.includes(ROL_API.MIEMBRO_REFUGIO);

  if (cabecera === undefined || cabecera === '') {
    return { ok: true, ambito: esMiembro ? 'REFUGIO' : 'PERSONAL' };
  }

  const valor = typeof cabecera === 'string' ? cabecera.trim().toUpperCase() : null;

  if (valor !== 'PERSONAL' && valor !== 'REFUGIO') return { ok: false, motivo: 'INVALIDO' };
  if (valor === 'REFUGIO' && !esMiembro) return { ok: false, motivo: 'SIN_REFUGIO' };

  return { ok: true, ambito: valor };
}

type MascotaConDuenio = { usuarioId: number; refugioId: number | null };
type Actor = { id: number; refugioId: number | null };

/**
 * Si la mascota pertenece al ámbito en el que está parado el actor, o sea, si la puede ver
 * y gestionar desde ese perfil:
 * - REFUGIO: cualquier mascota de su refugio, la haya cargado quien la haya cargado.
 * - PERSONAL: solo las que cargó a título personal (sin refugio).
 */
export function esMascotaDelAmbito(
  mascota: MascotaConDuenio,
  actor: Actor,
  ambito: Ambito,
): boolean {
  if (ambito === 'REFUGIO') {
    return mascota.refugioId !== null && mascota.refugioId === actor.refugioId;
  }
  return mascota.refugioId === null && mascota.usuarioId === actor.id;
}

/**
 * Si la mascota es "propia" del actor — o sea, si no tiene sentido que la adopte o la
 * guarde en favoritos.
 *
 * No depende del ámbito: tanto lo que cargó a título personal como lo de su refugio son
 * propios. Desde el perfil personal lo del refugio ni siquiera se ve (el feed lo excluye),
 * y desde el perfil de refugio no se adopta nada.
 */
export function esMascotaPropia(mascota: MascotaConDuenio, actor: Actor): boolean {
  if (mascota.usuarioId === actor.id) return true;
  return mascota.refugioId !== null && mascota.refugioId === actor.refugioId;
}
