/**
 * Criterio de las dos alertas del refugio: «solicitudes demoradas» y «publicaciones antiguas».
 *
 * Lo comparten el dashboard (spec 010), que las cuenta y lista, y los filtros especiales de los
 * listados de Solicitudes y Publicaciones, a los que lleva cada panel del dashboard: si el
 * criterio viviera en dos lugares, el número del dashboard y lo que muestra el filtro podrían
 * no coincidir.
 */

/** Solicitud sin resolver todavía. */
export const ESTADOS_SOLICITUD_ABIERTA: readonly string[] = ['Pendiente', 'En_Revision'];

/** A partir de cuántos días sin cambiar de estado una solicitud abierta está demorada. */
export const UMBRAL_DEMORA_SOLICITUD_DIAS = 5;

/**
 * Publicaciones que todavía se gestionan: una Finalizada ya no tiene nada que renovar, así que
 * no cuenta como antigua (decisión del equipo 2026-10-19).
 */
export const ESTADOS_PUBLICACION_GESTIONABLE: readonly string[] = ['Activa', 'Pausada'];

/** A partir de cuántos días publicada una publicación es "demasiado antigua". */
export const UMBRAL_PUBLICACION_ANTIGUA_DIAS = 60;

export function diasDesde(fecha: Date, hoy: Date = new Date()): number {
  return Math.max(0, Math.floor((hoy.getTime() - fecha.getTime()) / 86_400_000));
}

/** `vigente`: el estado actual de la solicitud y desde cuándo está en él. */
export function esSolicitudDemorada(
  vigente: { nombre: string; desde: Date },
  hoy: Date = new Date(),
): boolean {
  return (
    ESTADOS_SOLICITUD_ABIERTA.includes(vigente.nombre) &&
    diasDesde(vigente.desde, hoy) >= UMBRAL_DEMORA_SOLICITUD_DIAS
  );
}

export function esPublicacionAntigua(
  publicacion: { estado: string; fechaAlta: Date },
  hoy: Date = new Date(),
): boolean {
  return (
    ESTADOS_PUBLICACION_GESTIONABLE.includes(publicacion.estado) &&
    diasDesde(publicacion.fechaAlta, hoy) >= UMBRAL_PUBLICACION_ANTIGUA_DIAS
  );
}
