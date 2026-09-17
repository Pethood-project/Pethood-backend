import { r2Habilitado, subirImagenPerfil, type ArchivoSubida } from './r2';
import { guardarImagen } from './storage';

/**
 * Persiste la foto de perfil y devuelve la URL pública a guardar en `usuario_imagen_url`.
 * Si R2 está habilitado sube al bucket; si no, cae a disco local (`uploads/perfiles`).
 */
export async function persistirImagenPerfil(archivo: ArchivoSubida): Promise<string> {
  if (r2Habilitado()) {
    return subirImagenPerfil(archivo);
  }
  return guardarImagen(archivo, 'perfiles');
}
