/**
 * Con qué identidad actúa el usuario en esta operación: la personal o la de su refugio.
 *
 * Mismo concepto que el switch "vista refugio" del frontend (`useSesion().vistaRefugio`):
 * quien pertenece a un refugio funciona como si tuviera dos cuentas que comparten login,
 * una de adoptante particular y otra de personal del refugio. El cliente manda cuál de las
 * dos está usando en cada pedido (mismo patrón que `AMBITOS_MASCOTAS` en `mascotas.dto.ts`,
 * que resuelve la misma idea para el listado propio); acá se centraliza porque ahora la
 * necesitan varios módulos (favoritos, solicitudes, publicaciones) para decidir si una
 * mascota del refugio cuenta como "propia".
 */
export const AMBITOS = ['PERSONAL', 'REFUGIO'] as const;
export type Ambito = (typeof AMBITOS)[number];

/**
 * Si la mascota es "propia" del actor en el ámbito indicado — o sea, si no tiene sentido
 * que el actor la adopte o la guarde en favoritos.
 *
 * Lo que el actor cargó a título personal SIEMPRE es propio, sin importar el ámbito: nunca
 * tiene sentido solicitar o guardar algo que uno mismo publicó, esté actuando como
 * adoptante o como refugio.
 *
 * Lo del refugio solo cuenta como propio en ámbito REFUGIO. En ámbito PERSONAL el usuario
 * usa el switch para hacer de cuenta que es un adoptante más: un compañero de su propio
 * refugio pudo haber publicado esa mascota, y en esa cuenta "personal" sí puede solicitarla
 * o guardarla, igual que cualquier otro adoptante.
 */
export function esMascotaPropia(
  mascota: { usuarioId: number; refugioId: number | null },
  actor: { id: number; refugioId: number | null },
  ambito: Ambito,
): boolean {
  if (mascota.usuarioId === actor.id) return true;
  return ambito === 'REFUGIO' && mascota.refugioId !== null && mascota.refugioId === actor.refugioId;
}
