import { AppError } from '../../middlewares/errorHandler';
import { esMascotaDelAmbito, esMascotaPropia, type Ambito } from '../../shared/ambito';
import { registrarAuditoria } from '../../shared/logAuditoria';
import { borrarImagenes, guardarImagenes } from '../../shared/storage';
import { vacunasAplicadas } from '../../shared/vacunas';
import { aFechaISO } from '../../shared/validation/dates';
import { ESTADOS_QUE_HABILITAN_PUBLICACION } from '../catalogos/catalogos.service';
import {
  ESTADO_PUBLICACION,
  MARCADOR_FOTO_NUEVA,
  type AccionEstadoPublicacion,
  type CrearPublicacionDto,
  type EditarPublicacionDto,
  type FeedPublicacionesDto,
  type FiltrosFeedDto,
  type FiltrosMisPublicacionesDto,
  type NombreEstadoPublicacion,
  type PublicacionCreadaDto,
  type PublicacionFeedDto,
  type PublicacionPropiaDto,
} from './publicaciones.dto';
import * as repo from './publicaciones.repository';

const SUBCARPETA_FOTOS = 'publicaciones';

/** Tope anti-spam de publicaciones simultáneas para un adoptante particular. */
const MAXIMO_ACTIVAS_POR_ADOPTANTE = 5;

export interface ContextoCreacion {
  usuarioId: number;
  /** Perfil con el que se publica: la mascota tiene que ser de ese perfil. */
  ambito: Ambito;
  /** En el orden en que se subieron: la primera es la portada. */
  archivos: { buffer: Buffer; mimetype: string }[];
}

export async function crearPublicacion(
  datos: CrearPublicacionDto,
  contexto: ContextoCreacion,
): Promise<PublicacionCreadaDto> {
  const { usuarioId, ambito, archivos } = contexto;
  const usuario = await repo.buscarUsuario(usuarioId);

  if (!usuario) throw new AppError('NO_ENCONTRADO', 'El usuario no existe', 404);
  if (!usuario.verificado) {
    throw new AppError(
      'USUARIO_NO_VERIFICADO',
      'Necesitás verificar tu cuenta para poder publicar',
      403,
    );
  }

  const mascota = await repo.buscarMascota(datos.mascotaId);

  // Desde un perfil no se publica una mascota del otro (ver `shared/ambito.ts`): para esta
  // vista, esa mascota no existe.
  if (!mascota || !esMascotaDelAmbito(mascota, usuario, ambito)) {
    throw new AppError('NO_ENCONTRADO', 'La mascota no existe', 404);
  }
  if (mascota.usuarioId !== usuarioId) {
    throw new AppError('NO_AUTORIZADO', 'Esa mascota no es tuya', 403);
  }

  const estado = mascota.historicoEstados[0]?.estadoMascota;
  if (!estado || !ESTADOS_QUE_HABILITAN_PUBLICACION.includes(estado.nombre)) {
    throw new AppError(
      'ESTADO_NO_PUBLICABLE',
      'Con el estado actual de la mascota no se puede publicar en adopción',
      409,
    );
  }

  // Un aviso finalizado no traba uno nuevo: ya está cerrado.
  if (await repo.buscarEnCursoDeMascota(datos.mascotaId)) {
    throw new AppError('YA_PUBLICADA', 'Esa mascota ya tiene una publicación en curso', 409);
  }

  // La quota aplica a lo que se publica a título personal, no al refugio — también para un
  // miembro de refugio que publica desde su perfil personal.
  if (mascota.refugioId === null) {
    const activas = await repo.contarActivasPersonalesDeUsuario(usuarioId);

    if (activas >= MAXIMO_ACTIVAS_POR_ADOPTANTE) {
      throw new AppError(
        'LIMITE_DE_PUBLICACIONES',
        `Llegaste al máximo de ${MAXIMO_ACTIVAS_POR_ADOPTANTE} publicaciones activas`,
        409,
      );
    }
  }

  // Nace en el estado que le corresponde según la mascota: una "En_Transito" se publica
  // pausada (no entra al feed hasta que vuelva a estar disponible).
  const estadoInicial = await repo.buscarEstadoPublicacionPorNombre(
    estadoPublicacionSegunMascota(estado.nombre),
  );
  if (!estadoInicial) {
    // Catálogo incompleto: es un problema de datos, no algo que el usuario pueda resolver.
    throw new AppError('ERROR_INTERNO', 'No pudimos publicar. Intentalo más tarde', 500);
  }

  // Sin fotos propias se reutiliza la de la mascota, que ya es obligatoria en el alta.
  const imagenes =
    archivos.length > 0
      ? await guardarImagenes(archivos, SUBCARPETA_FOTOS)
      : [mascota.imagenUrl].filter((url): url is string => Boolean(url));

  let creada;
  try {
    // Si la mascota tenía avisos finalizados, el repository los da de baja en la misma
    // transacción: la publicación nueva reemplaza a la vieja.
    creada = await repo.crear(
      {
        // El formulario no pide título: se toma el nombre de la mascota.
        titulo: mascota.nombre ?? 'Mascota en adopción',
        descripcion: datos.descripcion,
        ubicacion: datos.ubicacion,
        requisitos: datos.requisitos,
        personalidad: datos.personalidad,
        desparasitado: datos.desparasitado,
        imagenes,
        mascotaId: mascota.id,
        usuarioId,
        estadoPublicacionId: estadoInicial.id,
      },
      usuarioId,
    );
  } catch (err) {
    // No dejar fotos huérfanas si la escritura en base falló. Las de la mascota no se
    // tocan: son de otra entidad y siguen en uso.
    if (archivos.length > 0) await borrarImagenes(imagenes);
    throw err;
  }

  const { publicacion, retiradas } = creada;

  await registrarAuditoria({
    usuarioId,
    accion: 'CREAR',
    entidad: 'Publicacion',
    entidadId: publicacion.id,
    detalle: `mascota=${mascota.id}`,
  });

  for (const retiradaId of retiradas) {
    await registrarAuditoria({
      usuarioId,
      accion: 'ELIMINAR',
      entidad: 'Publicacion',
      entidadId: retiradaId,
      detalle: `finalizada, reemplazada por publicación ${publicacion.id}`,
    });
  }

  return {
    id: publicacion.id,
    titulo: publicacion.titulo,
    descripcion: publicacion.descripcion,
    ubicacion: publicacion.ubicacion,
    requisitos: publicacion.requisitos,
    personalidad: publicacion.personalidad,
    desparasitado: publicacion.desparasitado,
    imagenes: publicacion.imagenes,
    mascotaId: publicacion.mascotaId,
    usuarioId: publicacion.usuarioId,
  };
}

type PublicacionConRelaciones = NonNullable<Awaited<ReturnType<typeof repo.buscarActivaPorId>>>;

/** Estado de mascota con el que el aviso queda activo. Mismo valor que usa el feed. */
const ESTADO_MASCOTA_PUBLICACION_ACTIVA = 'Disponible';

/** Estados de mascota que cierran el aviso: ya no hay a quién ofrecer en adopción. */
const ESTADOS_MASCOTA_PUBLICACION_FINALIZADA = ['Adoptado', 'Fallecido'];

/**
 * Qué estado le corresponde a la publicación según el estado de su mascota: Disponible →
 * Activa; Adoptado/Fallecido → Finalizada; el resto (En_Tratamiento, En_Transito) → Pausada.
 * Es el estado con el que nace una publicación, y la misma regla completó el estado de las
 * publicaciones existentes en la migración `estado_publicacion` y la usa el seed. Después
 * del alta la aplica `sincronizarConEstadoMascota`, con sus salvedades.
 */
export function estadoPublicacionSegunMascota(estadoMascota: string): NombreEstadoPublicacion {
  if (estadoMascota === ESTADO_MASCOTA_PUBLICACION_ACTIVA) return ESTADO_PUBLICACION.ACTIVA;
  if (ESTADOS_MASCOTA_PUBLICACION_FINALIZADA.includes(estadoMascota)) {
    return ESTADO_PUBLICACION.FINALIZADA;
  }
  return ESTADO_PUBLICACION.PAUSADA;
}

/**
 * Transición automática: lleva la publicación en curso de la mascota al estado que le toca
 * según el nuevo estado de la mascota. Automáticamente solo se **pausa** o se **finaliza**:
 * nunca se reactiva sola — una mascota que sale de tratamiento deja la publicación pausada
 * hasta que alguien la reactive a mano. Y una finalizada no se toca más.
 *
 * Todo lo que cambie el estado de una mascota tiene que llamarla después de persistirlo —
 * hoy ninguna pantalla lo cambia después del alta (ver DEUDA_TECNICA.md ítem 15).
 */
export async function sincronizarConEstadoMascota(
  mascotaId: number,
  estadoMascota: string,
  usuarioId: number,
): Promise<void> {
  const publicacion = await repo.buscarEnCursoDeMascota(mascotaId);
  if (!publicacion) return;

  const actual = publicacion.historicoEstados[0]?.estadoPublicacion.nombre;
  const destino = estadoPublicacionSegunMascota(estadoMascota);

  if (destino === ESTADO_PUBLICACION.ACTIVA) return;
  if (actual === destino || actual === ESTADO_PUBLICACION.FINALIZADA) return;

  const estado = await repo.buscarEstadoPublicacionPorNombre(destino);
  if (!estado) {
    throw new AppError('ERROR_INTERNO', 'No pudimos actualizar la publicación', 500);
  }

  await repo.cambiarEstado(publicacion.id, estado.id, usuarioId);
  await registrarAuditoria({
    usuarioId,
    accion: 'CAMBIAR_ESTADO',
    entidad: 'Publicacion',
    entidadId: publicacion.id,
    detalle: `estado=${destino} (automático, mascota=${estadoMascota})`,
  });
}

type Actor = { id: number; refugioId: number | null };

/**
 * Quién puede editar una publicación y cambiarle el estado, desde el perfil activo:
 * - PERSONAL: quien la publicó, sobre una mascota personal.
 * - REFUGIO: cualquier miembro del refugio dueño de la mascota, la haya publicado quien sea.
 *
 * Es el único lugar donde se decide: cuando existan roles dentro del refugio y haya
 * miembros que no puedan hacerlo, se restringe acá (DEUDA_TECNICA.md ítem 18).
 */
export function puedeEditarPublicacion(
  publicacion: { usuarioId: number; mascota: { usuarioId: number; refugioId: number | null } },
  actor: Actor,
  ambito: Ambito,
): boolean {
  if (!esMascotaDelAmbito(publicacion.mascota, actor, ambito)) return false;
  return ambito === 'REFUGIO' || publicacion.usuarioId === actor.id;
}

/**
 * La publicación con su estado vigente, si el usuario la puede gestionar desde el perfil
 * activo. Si no, 403: la publicación es pública (cualquiera abre la ficha), así que no se
 * disimula que existe.
 */
async function buscarEditable(publicacionId: number, usuarioId: number, ambito: Ambito) {
  const publicacion = await repo.buscarActivaPorId(publicacionId);
  const estado = publicacion ? estadoVigente(publicacion) : null;

  // Sin estado vigente es un dato inconsistente: mismo criterio que la ficha.
  if (!publicacion || !estado) {
    throw new AppError('NO_ENCONTRADO', 'Esa publicación ya no está disponible', 404);
  }

  const usuario = await repo.buscarUsuario(usuarioId);
  if (!usuario) throw new AppError('NO_ENCONTRADO', 'El usuario no existe', 404);

  if (!puedeEditarPublicacion(publicacion, usuario, ambito)) {
    throw new AppError('NO_AUTORIZADO', 'No podés modificar esta publicación', 403);
  }

  return { publicacion, estado };
}

export interface ContextoEdicion {
  usuarioId: number;
  ambito: Ambito;
  /** Las fotos nuevas, en el orden de sus marcas en `imagenes`. */
  archivos: { buffer: Buffer; mimetype: string }[];
}

/**
 * Edita los datos de una publicación (todo menos la mascota), con las mismas reglas que al
 * crearla. Una finalizada no se edita: el aviso está cerrado.
 *
 * Las fotos que se quitaron se borran del almacenamiento recién después de guardar, y la de
 * la mascota nunca: es de otra entidad y sigue en uso.
 */
export async function editarPublicacion(
  publicacionId: number,
  datos: EditarPublicacionDto,
  contexto: ContextoEdicion,
): Promise<PublicacionFeedDto> {
  const { usuarioId, ambito, archivos } = contexto;
  const { publicacion, estado } = await buscarEditable(publicacionId, usuarioId, ambito);

  if (estado.nombre === ESTADO_PUBLICACION.FINALIZADA) {
    throw new AppError(
      'PUBLICACION_FINALIZADA',
      'La publicación está finalizada y ya no se puede editar',
      409,
    );
  }

  const fotoMascota = publicacion.mascota.imagenUrl;
  validarOrdenDeImagenes(datos.imagenes, archivos.length, [
    ...imagenesDe(publicacion),
    ...(fotoMascota ? [fotoMascota] : []),
  ]);

  const nuevas = archivos.length > 0 ? await guardarImagenes(archivos, SUBCARPETA_FOTOS) : [];
  let siguienteNueva = 0;
  const ordenadas = datos.imagenes.map((item) =>
    item === MARCADOR_FOTO_NUEVA ? nuevas[siguienteNueva++]! : item,
  );
  // Sin fotos propias vuelve a heredar la de la mascota, como al crear.
  const imagenes =
    ordenadas.length > 0 ? ordenadas : [fotoMascota].filter((url): url is string => Boolean(url));

  try {
    await repo.actualizar(
      publicacion.id,
      {
        descripcion: datos.descripcion,
        ubicacion: datos.ubicacion,
        requisitos: datos.requisitos,
        personalidad: datos.personalidad,
        desparasitado: datos.desparasitado,
        imagenes,
      },
      usuarioId,
    );
  } catch (err) {
    if (nuevas.length > 0) await borrarImagenes(nuevas);
    throw err;
  }

  const quitadas = publicacion.imagenes.filter(
    (url) => !imagenes.includes(url) && url !== fotoMascota,
  );
  if (quitadas.length > 0) await borrarImagenes(quitadas);

  await registrarAuditoria({
    usuarioId,
    accion: 'MODIFICAR',
    entidad: 'Publicacion',
    entidadId: publicacion.id,
  });

  return obtenerPublicacion(publicacion.id, usuarioId, ambito);
}

/**
 * La galería que manda el cliente solo puede reordenar fotos que la publicación ya muestra
 * (o la de la mascota) y ubicar las nuevas: nunca apuntar a un archivo ajeno.
 */
function validarOrdenDeImagenes(
  orden: string[],
  cantidadNuevas: number,
  permitidas: string[],
): void {
  const marcas = orden.filter((item) => item === MARCADOR_FOTO_NUEVA).length;

  if (marcas !== cantidadNuevas) {
    throw new AppError('VALIDACION', 'Las fotos nuevas no coinciden con la galería enviada', 400);
  }

  const existentes = orden.filter((item) => item !== MARCADOR_FOTO_NUEVA);

  if (existentes.some((url) => !permitidas.includes(url))) {
    throw new AppError('VALIDACION', 'Una de las fotos no pertenece a la publicación', 400);
  }
  if (new Set(existentes).size !== existentes.length) {
    throw new AppError('VALIDACION', 'La galería tiene fotos repetidas', 400);
  }
}

/** De qué estado sale y a cuál va cada acción manual. */
export const TRANSICIONES: Record<
  AccionEstadoPublicacion,
  { desde: string[]; hacia: NombreEstadoPublicacion; error: string }
> = {
  PAUSAR: {
    desde: [ESTADO_PUBLICACION.ACTIVA],
    hacia: ESTADO_PUBLICACION.PAUSADA,
    error: 'Solo se puede pausar una publicación activa',
  },
  REACTIVAR: {
    desde: [ESTADO_PUBLICACION.PAUSADA],
    hacia: ESTADO_PUBLICACION.ACTIVA,
    error: 'Solo se puede reactivar una publicación pausada',
  },
  FINALIZAR: {
    desde: [ESTADO_PUBLICACION.ACTIVA, ESTADO_PUBLICACION.PAUSADA],
    hacia: ESTADO_PUBLICACION.FINALIZADA,
    error: 'La publicación ya está finalizada',
  },
};

/**
 * Pausar, reactivar o finalizar a mano. Reactivar además exige que la mascota esté
 * disponible (si no, quedaría "Activa" pero fuera del feed) y vuelve a chequear la quota
 * de publicaciones activas, que las pausadas no ocupan.
 */
export async function cambiarEstadoPublicacion(
  publicacionId: number,
  accion: AccionEstadoPublicacion,
  usuarioId: number,
  ambito: Ambito,
): Promise<PublicacionFeedDto> {
  const { publicacion, estado } = await buscarEditable(publicacionId, usuarioId, ambito);
  const transicion = TRANSICIONES[accion];

  if (!transicion.desde.includes(estado.nombre)) {
    throw new AppError('TRANSICION_INVALIDA', transicion.error, 409);
  }

  if (accion === 'REACTIVAR') {
    const estadoMascota = publicacion.mascota.historicoEstados[0]?.estadoMascota.nombre;

    if (estadoMascota !== ESTADO_MASCOTA_PUBLICACION_ACTIVA) {
      throw new AppError(
        'MASCOTA_NO_DISPONIBLE',
        'Para reactivar la publicación, la mascota tiene que estar disponible',
        409,
      );
    }

    if (publicacion.mascota.refugioId === null) {
      const activas = await repo.contarActivasPersonalesDeUsuario(publicacion.usuarioId);

      if (activas >= MAXIMO_ACTIVAS_POR_ADOPTANTE) {
        throw new AppError(
          'LIMITE_DE_PUBLICACIONES',
          `Llegaste al máximo de ${MAXIMO_ACTIVAS_POR_ADOPTANTE} publicaciones activas`,
          409,
        );
      }
    }
  }

  const destino = await repo.buscarEstadoPublicacionPorNombre(transicion.hacia);
  if (!destino) {
    throw new AppError('ERROR_INTERNO', 'No pudimos actualizar la publicación', 500);
  }

  await repo.cambiarEstado(publicacion.id, destino.id, usuarioId);
  await registrarAuditoria({
    usuarioId,
    accion: 'CAMBIAR_ESTADO',
    entidad: 'Publicacion',
    entidadId: publicacion.id,
    detalle: `estado=${transicion.hacia} (manual)`,
  });

  return obtenerPublicacion(publicacion.id, usuarioId, ambito);
}

/** Estado vigente del aviso. Sin fila vigente el dato es inconsistente: se trata como ausente. */
function estadoVigente(publicacion: PublicacionConRelaciones) {
  const estado = publicacion.historicoEstados[0]?.estadoPublicacion;
  return estado ? { id: estado.id, nombre: estado.nombre } : null;
}

/** Galería de la publicación, o la foto de la mascota si no subió propias. */
function imagenesDe(publicacion: PublicacionConRelaciones): string[] {
  return publicacion.imagenes.length > 0
    ? publicacion.imagenes
    : [publicacion.mascota.imagenUrl].filter((url): url is string => Boolean(url));
}

/** Requiere estado vigente de la mascota y de la publicación: quien llama ya lo filtró. */
function aFeedDto(
  publicacion: PublicacionConRelaciones,
  enFavoritos: boolean,
  esPropia: boolean,
  puedeEditar: boolean,
): PublicacionFeedDto {
  const { mascota } = publicacion;
  const estado = mascota.historicoEstados[0]!.estadoMascota;

  return {
    id: publicacion.id,
    titulo: publicacion.titulo,
    descripcion: publicacion.descripcion,
    ubicacion: publicacion.ubicacion,
    requisitos: publicacion.requisitos,
    personalidad: publicacion.personalidad,
    desparasitado: publicacion.desparasitado,
    // Las vacunas no son de la publicación sino de la mascota: salen de su historia clínica.
    vacunas: vacunasAplicadas(mascota.historiaClinica, mascota.raza.especie.nombre),
    // Una publicación sin fotos propias reusa la de la mascota, que es obligatoria en el
    // alta: así la galería nunca queda vacía.
    imagenes: imagenesDe(publicacion),
    fechaPublicacion: publicacion.fechaAlta.toISOString(),
    estado: estadoVigente(publicacion)!,
    mascota: {
      id: mascota.id,
      nombre: mascota.nombre,
      fechaNacimiento: mascota.fechaNacimiento ? aFechaISO(mascota.fechaNacimiento) : null,
      genero: mascota.genero,
      tamanio: mascota.tamanio,
      peso: mascota.peso === null ? null : Number(mascota.peso),
      castrado: mascota.castrado,
      descripcion: mascota.descripcion,
      imagenUrl: mascota.imagenUrl,
      especie: { id: mascota.raza.especie.id, nombre: mascota.raza.especie.nombre },
      raza: { id: mascota.raza.id, nombre: mascota.raza.nombre },
      estado: { id: estado.id, nombre: estado.nombre },
    },
    refugio: mascota.refugio,
    publicadoPor: mascota.refugio ? null : publicacion.usuario,
    enFavoritos,
    esPropia,
    puedeEditar,
  };
}

/**
 * Feed de adopción: una página de publicaciones vigentes que el usuario todavía no guardó,
 * más el total que matchea los filtros para que el cliente sepa si le quedan por traer.
 *
 * El descarte no se persiste: es temporal y vive en la pantalla, así que una mascota
 * rechazada vuelve a aparecer si el usuario recarga el feed.
 */
export async function listarFeed(
  usuarioId: number,
  filtros: FiltrosFeedDto,
): Promise<FeedPublicacionesDto> {
  const usuario = await repo.buscarUsuario(usuarioId);

  if (!usuario) {
    throw new AppError('NO_ENCONTRADO', 'El usuario no existe', 404);
  }

  const [publicaciones, total] = await Promise.all([
    repo.listarFeed(usuarioId, filtros, usuario.refugioId),
    repo.contarFeed(usuarioId, filtros, usuario.refugioId),
  ]);

  // El feed ya excluye las propias y las guardadas, así que acá `enFavoritos`, `esPropia` y
  // `puedeEditar` son siempre false. Se deja explícito para que la tarjeta y la ficha lean
  // los mismos campos.
  return {
    total,
    publicaciones: publicaciones.map((pub) => aFeedDto(pub, false, false, false)),
  };
}

/** Ficha completa de una publicación, con el estado de favorito y de propiedad ya resueltos. */
export async function obtenerPublicacion(
  publicacionId: number,
  usuarioId: number,
  ambito: Ambito,
): Promise<PublicacionFeedDto> {
  const publicacion = await repo.buscarActivaPorId(publicacionId);

  if (!publicacion) {
    throw new AppError('NO_ENCONTRADO', 'Esa publicación ya no está disponible', 404);
  }

  if (publicacion.mascota.historicoEstados.length === 0 || !estadoVigente(publicacion)) {
    // Dato inconsistente, no un caso de negocio: sin estado vigente no se puede pintar.
    throw new AppError('NO_ENCONTRADO', 'Esa publicación ya no está disponible', 404);
  }

  const usuario = await repo.buscarUsuario(usuarioId);

  if (!usuario) {
    throw new AppError('NO_ENCONTRADO', 'El usuario no existe', 404);
  }

  const favoritas = await repo.filtrarFavoritas(usuarioId, [publicacion.mascotaId]);
  const actor = { id: usuario.id, refugioId: usuario.refugioId };

  return aFeedDto(
    publicacion,
    favoritas.has(publicacion.mascotaId),
    esMascotaPropia(publicacion.mascota, actor),
    puedeEditarPublicacion(publicacion, actor, ambito),
  );
}

/**
 * "Mis publicaciones": las del perfil con el que se consulta (ver `shared/ambito.ts`). Desde
 * el personal, las de sus mascotas personales; desde el de refugio, todas las del refugio,
 * las haya publicado el miembro que sea.
 */
export async function listarMisPublicaciones(
  usuarioId: number,
  ambito: Ambito,
  filtros: FiltrosMisPublicacionesDto = { estados: [] },
): Promise<PublicacionPropiaDto[]> {
  let filtro: { usuarioId: number } | { refugioId: number } = { usuarioId };

  if (ambito === 'REFUGIO') {
    const usuario = await repo.buscarUsuario(usuarioId);

    if (!usuario) throw new AppError('NO_ENCONTRADO', 'El usuario no existe', 404);
    if (!usuario.refugioId) {
      throw new AppError('SIN_REFUGIO', 'Tu usuario no está asociado a ningún refugio', 403);
    }

    filtro = { refugioId: usuario.refugioId };
  }

  // Sin estados elegidos, todas; con uno o más, solo las que están en alguno de ellos.
  const publicaciones = await repo.listarDeAmbito(filtro, filtros.estados);

  return publicaciones.flatMap((publicacion) => {
    // Sin estado vigente no se puede decir en qué estado está el aviso: dato inconsistente,
    // mismo criterio que la ficha.
    const estado = estadoVigente(publicacion);
    if (!estado) return [];

    const { mascota } = publicacion;

    return [
      {
        id: publicacion.id,
        imagenUrl: imagenesDe(publicacion)[0] ?? null,
        fechaPublicacion: publicacion.fechaAlta.toISOString(),
        estado,
        mascota: {
          id: mascota.id,
          nombre: mascota.nombre,
          fechaNacimiento: mascota.fechaNacimiento ? aFechaISO(mascota.fechaNacimiento) : null,
          especie: { id: mascota.raza.especie.id, nombre: mascota.raza.especie.nombre },
        },
      },
    ];
  });
}

/**
 * Id de la publicación de una mascota (la en curso o, si no tiene, la última finalizada).
 * Lo consume `mascotas.service` para la ficha de detalle (HU-6.4): el botón "Ver
 * publicación asociada" solo aparece con un id, no con un booleano, porque de ahí sale
 * directo el link a la ficha.
 */
export async function obtenerPublicacionActivaIdDeMascota(
  mascotaId: number,
): Promise<number | null> {
  const publicacion = await repo.buscarUltimaDeMascota(mascotaId);
  return publicacion?.id ?? null;
}

export { MAXIMO_ACTIVAS_POR_ADOPTANTE };
