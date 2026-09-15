// Favoritos (HU-6.6). Solo sobre mascotas ajenas con publicación activa, que es lo único
// que la API acepta guardar. Los de Ana cubren los distintos badges de estado y llevan
// `fechaAlta` escalonada porque el listado ordena por ella.
import { haceDias, log, prisma } from './comun';
import type { Mascotas } from './mascotas';
import type { Actores } from './usuarios';

interface DefFavorito {
  usuario: 'ana' | 'carla' | 'martin';
  mascota: string;
  guardadoHaceDias: number;
}

const FAVORITOS: DefFavorito[] = [
  { usuario: 'ana', mascota: 'max', guardadoHaceDias: 0 },
  { usuario: 'ana', mascota: 'luna', guardadoHaceDias: 1 },
  { usuario: 'ana', mascota: 'toby', guardadoHaceDias: 3 },
  { usuario: 'ana', mascota: 'rocky', guardadoHaceDias: 8 },
  { usuario: 'ana', mascota: 'mia', guardadoHaceDias: 20 },
  { usuario: 'carla', mascota: 'nala', guardadoHaceDias: 2 },
  { usuario: 'carla', mascota: 'coco', guardadoHaceDias: 9 },
  { usuario: 'martin', mascota: 'pipo', guardadoHaceDias: 5 },
];

export async function seedFavoritos(actores: Actores, mascotas: Mascotas) {
  let nuevos = 0;

  for (const def of FAVORITOS) {
    const usuario = actores[def.usuario];
    const { mascota } = mascotas.get(def.mascota)!;

    const existente = await prisma.favorito.findFirst({
      where: { usuarioId: usuario.id, mascotaId: mascota.id, fechaBaja: null },
    });
    if (existente) continue;

    await prisma.favorito.create({
      data: {
        usuarioId: usuario.id,
        mascotaId: mascota.id,
        usuarioAlta: usuario.id,
        fechaAlta: haceDias(def.guardadoHaceDias),
      },
    });
    nuevos += 1;
  }

  log(`⭐ Favoritos: ${FAVORITOS.length} (${nuevos} nuevos)`);
}
