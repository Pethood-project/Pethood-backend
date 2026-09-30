/**
 * Texto de ubicación a partir de la dirección estructurada.
 *
 * Reemplaza a los viejos campos libres `usuario_ubicacion` y `refugio_direccion`: donde antes
 * se mostraba ese texto, ahora se muestra «calle_altura, localidad - provincia». Degrada si
 * falta alguna parte (p. ej. solo localidad y provincia), y devuelve `null` si no hay nada.
 */
export interface PartesUbicacion {
  calleAltura?: string | null;
  localidad?: string | null;
  provincia?: string | null;
}

export function etiquetaUbicacion(partes: PartesUbicacion): string | null {
  const { calleAltura, localidad, provincia } = partes;

  const zona = [localidad, provincia].filter(Boolean).join(' - ');
  const texto = [calleAltura, zona].filter(Boolean).join(', ');

  return texto.length > 0 ? texto : null;
}