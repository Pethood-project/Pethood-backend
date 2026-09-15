/**
 * Interruptores temporales de producto. El código del flujo se queda; apagar uno
 * saltea esa regla hasta que se vuelva a prender.
 *
 * `EXIGIR_VERIFICACION_PARA_SOLICITAR`: HU-7.1 pide cuenta verificada (DNI + selfie)
 * para solicitar. Hoy está apagada porque esa pantalla todavía no está lista.
 */
export const FLAGS = {
  EXIGIR_VERIFICACION_PARA_SOLICITAR: false,
};
