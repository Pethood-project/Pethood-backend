import type { ArchivoSubida } from './r2';
import { guardarImagen } from './storage';

/**
 * Persiste la foto de perfil y devuelve la URL pública a guardar en `usuario_imagen_url`.
 *
 * Quedó como un alias con nombre: elegir entre R2 y disco local ahora lo hace `storage.ts`
 * para todos los módulos por igual, así que acá sólo queda fijar la subcarpeta. Se conserva
 * la función porque `usuarios.service` la consume (y la mockea en sus tests), y porque
 * `'perfiles'` escrito en un solo lugar es mejor que repetido en cada caller.
 */
export function persistirImagenPerfil(archivo: ArchivoSubida): Promise<string> {
  return guardarImagen(archivo, 'perfiles');
}
