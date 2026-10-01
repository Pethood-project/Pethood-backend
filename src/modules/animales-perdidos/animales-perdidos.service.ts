/**
 * Avisos de mascotas perdidas y encontradas (spec 020, HU-13.1): alta y portal.
 *
 * **El aviso es de la PERSONA que lo carga**, sea adoptante o miembro de un refugio, y desde
 * cualquiera de sus dos perfiles: el perfil activo (`X-Ambito`) no cambia nada. Es la misma
 * lógica que el chat de reencuentro (HU-13.2), que es entre personas y nunca lleva
 * `refugioId`.
 *
 * Fuera de esta HU, y anotado en la spec: el botón "Abrir chat" (HU-13.2) y el paso a
 * "Resuelto", la edición y la baja del aviso (HU-13.3).
 */
import { AppError } from '../../middlewares/errorHandler';
import { distanciaKm, resolverCoordenadasDeMapsUrl, type Coordenadas } from '../../shared/geo';
import {
  construirMapaUrl,
  construirMapaUrlDeBusqueda,
  geocodificarLugar,
  textoDeLugar,
} from '../../shared/geocoding';
import { registrarAuditoria } from '../../shared/logAuditoria';
import { borrarImagenes, guardarImagenes } from '../../shared/storage';
import { etiquetaUbicacion } from '../../shared/ubicacion';
import { aFechaISO } from '../../shared/validation/dates';
import { ESTADOS_ANIMAL_PERDIDO_EN_ALTA } from '../catalogos/catalogos.service';
import type {
  AvisoDto,
  CrearAvisoDto,
  FiltrosAvisosDto,
  ListaAvisosDto,
  LugarEnMapaDto,
  ProvinciaConLocalidadesDto,
  UbicarLugarDto,
} from './animales-perdidos.dto';
import * as repo from './animales-perdidos.repository';

const SUBCARPETA_FOTOS = 'perdidos';

/** El único estado que exige nombre: quien encuentra un animal no sabe cómo se llama. */
const ESTADO_QUE_EXIGE_NOMBRE = 'Perdido';

export interface ContextoCreacion {
  usuarioId: number;
  /** En el orden de la galería: el primero es la portada. */
  archivos: { buffer: Buffer; mimetype: string }[];
}

/** El lugar geocodificado, si lo hay. Nunca las coordenadas del dispositivo. */
function lugarDe(aviso: repo.AvisoConRelaciones): Coordenadas | null {
  return aviso.lugarLatitud !== null && aviso.lugarLongitud !== null
    ? { latitud: aviso.lugarLatitud, longitud: aviso.lugarLongitud }
    : null;
}

/**
 * Link a Google Maps: con las coordenadas del lugar o, si el geocoder no lo encontró,
 * buscando el texto del lugar. Nunca con las del dispositivo, que dirían dónde estaba quien
 * reportó.
 */
function mapaUrlDe(aviso: repo.AvisoConRelaciones): string | null {
  const lugar = lugarDe(aviso);
  if (lugar) return construirMapaUrl(lugar);
  if (!aviso.localidad) return null;

  return construirMapaUrlDeBusqueda(
    textoDeLugar({
      provincia: aviso.provincia ?? '',
      localidad: aviso.localidad,
      referencia: aviso.referencia,
    }),
  );
}

function aDto(
  aviso: repo.AvisoConRelaciones,
  usuarioId: number,
  usuario: Coordenadas | null = null,
): AvisoDto {
  const lugar = lugarDe(aviso);

  return {
    id: aviso.id,
    nombre: aviso.nombre,
    descripcion: aviso.descripcion,
    imagenUrl: aviso.imagenUrl,
    // Un aviso sin array (null en base) muestra igual su portada en la galería.
    imagenes: aviso.imagenes.length > 0 ? aviso.imagenes : [aviso.imagenUrl],
    // Mismo formato que la dirección del perfil: «referencia, localidad - provincia».
    ubicacion: etiquetaUbicacion({
      calleAltura: aviso.referencia,
      localidad: aviso.localidad,
      provincia: aviso.provincia,
    }),
    provincia: aviso.provincia,
    localidad: aviso.localidad,
    referencia: aviso.referencia,
    distanciaKm: usuario && lugar ? Math.round(distanciaKm(usuario, lugar) * 10) / 10 : null,
    mapaUrl: mapaUrlDe(aviso),
    estado: { id: aviso.estadoAnimalPerdido.id, nombre: aviso.estadoAnimalPerdido.nombre },
    especie: aviso.especie ? { id: aviso.especie.id, nombre: aviso.especie.nombre } : null,
    // Sólo el día, como `fechaNacimiento`: con hora, un día cargado en Argentina podría
    // mostrarse como el anterior en otra zona horaria.
    fechaSuceso: aviso.fechaSuceso ? aFechaISO(aviso.fechaSuceso) : null,
    fechaAlta: aviso.fechaAlta.toISOString(),
    fechaResuelto: aviso.fechaResuelto?.toISOString() ?? null,
    reportante: {
      id: aviso.usuarioReportante.id,
      nombre: aviso.usuarioReportante.nombre,
      apellido: aviso.usuarioReportante.apellido,
      imagenUrl: aviso.usuarioReportante.imagenUrl,
    },
    esPropio: aviso.usuarioReportanteId === usuarioId,
  };
}

/** El estado inicial sólo puede ser "Perdido" o "Encontrado", nunca "Resuelto". */
async function resolverEstadoInicial(estadoId: number) {
  const estado = await repo.buscarEstado(estadoId);

  if (!estado) {
    throw new AppError('NO_ENCONTRADO', 'El estado no existe', 404);
  }
  if (!ESTADOS_ANIMAL_PERDIDO_EN_ALTA.includes(estado.nombre)) {
    throw new AppError(
      'ESTADO_INVALIDO',
      'Un aviso nuevo tiene que ser de una mascota perdida o encontrada',
      400,
    );
  }

  return estado;
}

/** HU-13.1: publica el aviso con el usuario autenticado como reportante. */
export async function crearAviso(
  datos: CrearAvisoDto,
  contexto: ContextoCreacion,
): Promise<AvisoDto> {
  // Al menos una foto (la portada es NOT NULL) y bloquea el guardado, como en HU-6.1. El
  // máximo lo corta multer antes de llegar acá.
  if (contexto.archivos.length === 0) {
    throw new AppError('FOTO_REQUERIDA', 'Agregá una foto del animal', 400);
  }

  if (!(await repo.buscarUsuario(contexto.usuarioId))) {
    throw new AppError('NO_ENCONTRADO', 'El usuario no existe', 404);
  }

  const estado = await resolverEstadoInicial(datos.estadoId);

  if (estado.nombre === ESTADO_QUE_EXIGE_NOMBRE && !datos.nombre) {
    throw new AppError('VALIDACION', 'El nombre es obligatorio', 400);
  }

  if (!(await repo.buscarEspecie(datos.especieId))) {
    throw new AppError('NO_ENCONTRADO', 'La especie no existe', 404);
  }

  // El punto del lugar alimenta la distancia, el link a Maps y el filtro por cercanía. Si el
  // usuario ya lo vio en el mapa (el preview, o el link que pegó a mano) viene en el alta; si
  // no, se geocodifica acá. Si el geocoder tampoco lo encuentra, el aviso se publica igual.
  const elegido =
    datos.lugarLatitud !== undefined && datos.lugarLongitud !== undefined
      ? { latitud: datos.lugarLatitud, longitud: datos.lugarLongitud }
      : null;
  const lugar =
    elegido ??
    (await geocodificarLugar({
      provincia: datos.provincia,
      localidad: datos.localidad,
      referencia: datos.referencia,
    }));

  const imagenes = await guardarImagenes(contexto.archivos, SUBCARPETA_FOTOS);

  let aviso: repo.AvisoConRelaciones;
  try {
    aviso = await repo.crear(
      {
        nombre: datos.nombre,
        descripcion: datos.descripcion,
        imagenes,
        provincia: datos.provincia,
        localidad: datos.localidad,
        referencia: datos.referencia,
        lugarLatitud: lugar?.latitud ?? null,
        lugarLongitud: lugar?.longitud ?? null,
        fechaSuceso: datos.fechaSuceso,
        latitud: datos.latitud,
        longitud: datos.longitud,
        especieId: datos.especieId,
        estadoAnimalPerdidoId: estado.id,
      },
      contexto.usuarioId,
    );
  } catch (err) {
    // No dejar fotos huérfanas si la escritura en base falló.
    await borrarImagenes(imagenes);
    throw err;
  }

  await registrarAuditoria({
    usuarioId: contexto.usuarioId,
    accion: 'CREAR',
    entidad: 'AnimalPerdido',
    entidadId: aviso.id,
    detalle: `estado=${estado.nombre} lugar=${elegido ? 'elegido' : lugar ? 'geocodificado' : 'sin-ubicar'}`,
  });

  // La distancia se mide desde el teléfono de quien lo publicó, como la mediría el portal para
  // él: así la tarjeta que el cliente inserta arriba sin recargar trae el mismo dato.
  return aDto(aviso, contexto.usuarioId, { latitud: datos.latitud, longitud: datos.longitud });
}

/**
 * HU-13.1: el portal, paginado por cursor. Sin resultados es una lista vacía con 200: el
 * empty state lo pinta el cliente.
 */
export async function listarAvisos(
  filtros: FiltrosAvisosDto,
  usuarioId: number,
): Promise<ListaAvisosDto> {
  // Un cursor que no existe paginaría desde ningún lado y el cliente creería que ya no hay
  // más avisos: se corta antes, igual que en el historial del chat.
  if (filtros.cursor !== undefined && !(await repo.existeAviso(filtros.cursor))) {
    throw new AppError('CURSOR_INVALIDO', 'No pudimos seguir cargando los avisos', 400);
  }

  const usuario: Coordenadas | null =
    filtros.latitud !== undefined && filtros.longitud !== undefined
      ? { latitud: filtros.latitud, longitud: filtros.longitud }
      : null;

  // Con radio, primero los avisos cercanos (SQL a mano) y después el listado con cursor
  // restringido a esos ids.
  const idsCercanos =
    usuario && filtros.radioKm !== undefined
      ? await repo.idsEnRadio(usuario.latitud, usuario.longitud, filtros.radioKm)
      : undefined;

  const filas = await repo.listar(
    {
      fechaDesde: filtros.fechaDesde,
      fechaHasta: filtros.fechaHasta,
      estados: filtros.estados,
      especies: filtros.especies,
      provincias: filtros.provincias,
      localidades: filtros.localidades,
      idsCercanos,
    },
    filtros.limite,
    filtros.cursor,
  );

  const hayMas = filas.length > filtros.limite;
  const pagina = hayMas ? filas.slice(0, filtros.limite) : filas;

  return {
    avisos: pagina.map((aviso) => aDto(aviso, usuarioId, usuario)),
    hayMas,
    proximoCursor: hayMas ? pagina[pagina.length - 1]!.id : null,
  };
}

/**
 * Preview del lugar en el mapa para el formulario de alta: lo geocodifica sin publicar nada,
 * así el usuario abre el link y verifica el pin antes de publicar, como con la dirección del
 * perfil. El punto que devuelve es el que el cliente manda después en el alta.
 */
export async function ubicarLugar(lugar: UbicarLugarDto): Promise<LugarEnMapaDto> {
  const coordenadas = await geocodificarLugar(lugar);

  if (!coordenadas) {
    throw new AppError(
      'LUGAR_NO_UBICADO',
      'No pudimos ubicar ese lugar en el mapa. Podés pegar el link de Google Maps a mano.',
      422,
    );
  }

  return { mapaUrl: construirMapaUrl(coordenadas), ...coordenadas };
}

/**
 * El "corregir a mano" del formulario de alta: lee el punto de un link de Google Maps,
 * incluidos los cortos (`maps.app.goo.gl`), igual que la edición manual del perfil. No guarda
 * nada: el cliente manda ese punto en el alta.
 */
export async function leerLinkMapa(mapaUrl: string): Promise<LugarEnMapaDto> {
  const coordenadas = await resolverCoordenadasDeMapsUrl(mapaUrl);

  if (!coordenadas) {
    throw new AppError(
      'LINK_MAPA_INVALIDO',
      'No pudimos leer la ubicación de ese link. Pegá el link de Google Maps del lugar.',
      422,
    );
  }

  return { mapaUrl: construirMapaUrl(coordenadas), ...coordenadas };
}

/**
 * Opciones del filtro por lugar: cada provincia que tiene avisos visibles, con sus localidades
 * que tienen avisos, las dos en orden alfabético. Así el filtro nunca ofrece una localidad sin
 * resultados (con el catálogo completo, sólo Mendoza tiene unas 200).
 */
export async function listarUbicaciones(): Promise<ProvinciaConLocalidadesDto[]> {
  const porProvincia = new Map<string, Set<string>>();

  for (const { provincia, localidad } of await repo.listarUbicaciones()) {
    if (!provincia || !localidad) continue;

    const localidades = porProvincia.get(provincia) ?? new Set<string>();
    localidades.add(localidad);
    porProvincia.set(provincia, localidades);
  }

  const alfabetico = (a: string, b: string): number => a.localeCompare(b, 'es');

  return [...porProvincia.entries()]
    .sort(([a], [b]) => alfabetico(a, b))
    .map(([provincia, localidades]) => ({
      provincia,
      localidades: [...localidades].sort(alfabetico),
    }));
}

/** Baja de un aviso por el admin (spec 008, deuda #28): el motivo le llega a quien lo publicó. */
export async function darDeBajaPorAdmin(adminId: number, id: number, motivo: string) {
  const aviso = await repo.buscarParaModeracion(id);

  if (!aviso) {
    throw new AppError('NO_ENCONTRADO', 'No encontramos ese aviso', 404);
  }
  if (aviso.fechaBaja) {
    throw new AppError('AVISO_DE_BAJA', 'El aviso ya está dado de baja', 409);
  }

  const nombre = aviso.nombre ?? aviso.descripcion.slice(0, 40);
  await repo.darDeBajaPorModeracion({
    id,
    adminId,
    duenoId: aviso.usuarioReportanteId,
    mensajeAviso: `Un administrador dio de baja tu aviso «${nombre}». Motivo: ${motivo}`,
  });
  await registrarAuditoria({
    usuarioId: adminId,
    accion: 'BAJA_MODERACION',
    entidad: 'AnimalPerdido',
    entidadId: id,
    detalle: `motivo=${motivo}`,
  });
}
