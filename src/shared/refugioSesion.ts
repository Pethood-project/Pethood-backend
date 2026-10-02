/** Estado de un refugio que viaja en la sesión: una baja lógica cuenta como `Inactivo`. */
export interface RefugioConEstado {
  id: number;
  nombre: string;
  fechaBaja: Date | null;
  estado: { nombre: string };
}

export function aRefugioDeSesion(refugio: RefugioConEstado | null) {
  if (!refugio) return null;
  return {
    id: refugio.id,
    nombre: refugio.nombre,
    estado: refugio.fechaBaja ? 'Inactivo' : refugio.estado.nombre,
  };
}
