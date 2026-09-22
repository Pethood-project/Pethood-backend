/**
 * Favoritos: alta (HU-7.2), baja y listado (HU-6.6).
 *
 * Las dos operaciones de escritura son IDEMPOTENTES. El swipe de HU-6.5 hace updates
 * optimistas y reintenta ante un error de red, así que el cliente no está pidiendo una
 * transición ("creá esto") sino declarando un estado final ("esta mascota está guardada" /
 * "no lo está"). Devolver 409 o 404 lo obligaría a tratar como error algo que ya es el
 * resultado que quería.
 *
 * No se escribe en `logAuditoria`: un favorito se toca en cada swipe y el log es un
 * archivo append-only pensado para operaciones críticas. Las columnas de auditoría de la
 * propia tabla ya registran quién y cuándo.
 */
import { Prisma } from '@prisma/client';
import { AppError } from '../../middlewares/errorHandler';
import { esMascotaPropia, type Ambito } from '../../shared/ambito';
import { aFechaISO } from '../../shared/validation/dates';
import type { FavoritoAgregadoDto, ListaFavoritosDto, MascotaFavoritaDto } from './favoritos.dto';
import * as repo from './favoritos.repository';

type FavoritoConMascota = Awaited<ReturnType<typeof repo.listarVisiblesDeUsuario>>[number];
type Favorito = Awaited<ReturnType<typeof repo.crear>>;

export interface ResultadoAgregado {
  favorito: FavoritoAgregadoDto;
  /** true cuando ya estaba guardada: el controller responde 200 en vez de 201. */
  yaEstaba: boolean;
}

function aFavoritoDto(favorito: Favorito): FavoritoAgregadoDto {
  return {
    id: favorito.id,
    mascotaId: favorito.mascotaId,
    fechaAgregado: favorito.fechaAlta.toISOString(),
  };
}

function aTarjetaDto(favorito: FavoritoConMascota): MascotaFavoritaDto {
  const { mascota } = favorito;
  const estado = mascota.historicoEstados[0]!.estadoMascota;
  // Una mascota tiene una sola publicación viva a la vez; el `take: 1` del repository ya
  // la acota, acá solo se desarma el arreglo.
  const publicacion = mascota.publicaciones[0];

  return {
    id: mascota.id,
    nombre: mascota.nombre,
    fechaNacimiento: mascota.fechaNacimiento ? aFechaISO(mascota.fechaNacimiento) : null,
    imagenUrl: mascota.imagenUrl,
    especie: { id: mascota.raza.especie.id, nombre: mascota.raza.especie.nombre },
    raza: { id: mascota.raza.id, nombre: mascota.raza.nombre },
    estado: { id: estado.id, nombre: estado.nombre },
    publicacionId: publicacion?.id ?? null,
    solicitudAbiertaId: publicacion?.solicitudes[0]?.id ?? null,
    fechaAgregado: favorito.fechaAlta.toISOString(),
  };
}

/** P2002 = violación de índice único, o sea que otro request ya guardó esta mascota. */
function esDuplicado(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}

export async function agregarFavorito(
  mascotaId: number,
  usuarioId: number,
  ambito: Ambito,
): Promise<ResultadoAgregado> {
  const mascota = await repo.buscarMascotaActiva(mascotaId);

  if (!mascota) {
    throw new AppError('NO_ENCONTRADO', 'La mascota no existe', 404);
  }

  const usuario = await repo.buscarUsuario(usuarioId);

  if (!usuario) {
    throw new AppError('NO_ENCONTRADO', 'El usuario no existe', 404);
  }

  // Guardarse la propia mascota no tiene sentido y ensuciaría el listado de GUI-12. La del
  // refugio solo cuenta como propia en ámbito REFUGIO — ver `shared/ambito.ts`.
  if (esMascotaPropia(mascota, { id: usuario.id, refugioId: usuario.refugioId }, ambito)) {
    throw new AppError('MASCOTA_PROPIA', 'No podés guardar en favoritos una mascota tuya', 403);
  }

  if (!(await repo.buscarPublicacionActiva(mascotaId))) {
    throw new AppError('SIN_PUBLICACION', 'Esa mascota no está publicada en adopción', 409);
  }

  const existente = await repo.buscarActivo(usuarioId, mascotaId);
  if (existente) {
    return { favorito: aFavoritoDto(existente), yaEstaba: true };
  }

  try {
    return { favorito: aFavoritoDto(await repo.crear(usuarioId, mascotaId)), yaEstaba: false };
  } catch (err) {
    if (!esDuplicado(err)) throw err;

    // Otro POST del mismo swipe ganó la carrera entre el findFirst de arriba y este
    // insert. El índice único parcial evitó el duplicado y el estado final es correcto.
    const ganador = await repo.buscarActivo(usuarioId, mascotaId);
    if (!ganador) throw err;

    return { favorito: aFavoritoDto(ganador), yaEstaba: true };
  }
}

/**
 * Baja lógica. Si la mascota no está entre los favoritos del usuario no se hace nada:
 * el estado final que pide el cliente ya se cumple.
 *
 * El favorito se busca siempre acotado al usuario autenticado, así que el de otra persona
 * es indistinguible de uno inexistente: no se puede ni borrar ni sondear su existencia.
 */
export async function quitarFavorito(mascotaId: number, usuarioId: number): Promise<void> {
  const favorito = await repo.buscarActivo(usuarioId, mascotaId);
  if (!favorito) return;

  await repo.darDeBaja(favorito.id, usuarioId);
}

export async function listarFavoritos(usuarioId: number): Promise<ListaFavoritosDto> {
  const favoritos = await repo.listarVisiblesDeUsuario(usuarioId);

  // Una mascota sin estado vigente no se puede pintar (falta el badge). Es un dato
  // inconsistente, no un caso de negocio: se omite en vez de romper la pantalla entera.
  const tarjetas = favoritos
    .filter((favorito) => favorito.mascota.historicoEstados.length > 0)
    .map(aTarjetaDto);

  // El total sale de la misma lista ya filtrada, para que el contador del header no pueda
  // discrepar de lo que se ve en la grilla.
  return { total: tarjetas.length, favoritos: tarjetas };
}
