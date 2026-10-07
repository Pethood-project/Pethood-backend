/**
 * Reintentos en segundo plano de la confirmación con Mercado Pago (spec 027 §6.5).
 *
 * Al tocar «Terminar donación» el sistema busca la transferencia en el acto, pero muchas veces
 * se acredita unos segundos o minutos después. En vez de hacer esperar al usuario, se vuelve a
 * buscar esa donación 3 veces cada 30 s, y después al minuto, a los 2 y a los 5 (cada espera
 * contada desde el intento anterior), y se corta en cuanto se confirma. Lo que
 * llegue más tarde (o si el servidor se reinicia en el medio) lo toma el cron, que es el
 * respaldo.
 *
 * No es un cron dentro del servidor: son a lo sumo seis intentos por donación, y los
 * temporizadores no retienen el proceso (`unref`), así que tests y jobs terminan normal.
 */

/**
 * Cuándo se reintenta, contado desde «Terminar donación»: 30 s, 1 min y 1 min 30 s (cada 30 s),
 * y después 2 min 30 s, 4 min 30 s y 9 min 30 s (+1, +2 y +5 minutos).
 */
export const INSTANTES_REINTENTO_MS = [30_000, 60_000, 90_000, 150_000, 270_000, 570_000];

/** Claves con reintentos en curso: para no programar dos veces lo mismo. */
const enCurso = new Set<string>();

/**
 * Programa los reintentos de `intentar` (que devuelve cuántas donaciones confirmó) bajo
 * `clave`. Devuelve `false` si esa clave ya tenía reintentos en curso.
 */
export function programarReintentos(clave: string, intentar: () => Promise<number>): boolean {
  if (enCurso.has(clave)) return false;
  enCurso.add(clave);

  const programar = (indice: number): void => {
    if (indice >= INSTANTES_REINTENTO_MS.length) {
      enCurso.delete(clave);
      return;
    }

    const espera = INSTANTES_REINTENTO_MS[indice]! - (INSTANTES_REINTENTO_MS[indice - 1] ?? 0);
    const temporizador = setTimeout(() => {
      void intentar()
        .catch(() => 0)
        .then((confirmadas) => {
          if (confirmadas > 0) {
            enCurso.delete(clave);
            return;
          }
          programar(indice + 1);
        });
    }, espera);
    temporizador.unref?.();
  };

  programar(0);
  return true;
}
