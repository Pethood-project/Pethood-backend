/**
 * Avisos de mascotas perdidas y encontradas: alta y portal (spec 020, HU-13.1), reclamo con
 * chat de reencuentro y cierre del caso (spec 024, HU-13.2).
 *
 * **El aviso es de la PERSONA que lo carga**, sea adoptante o miembro de un refugio, y desde
 * cualquiera de sus dos perfiles: el perfil activo (`X-Ambito`) no cambia nada. Es la misma
 * lógica que el chat de reencuentro (HU-13.2), que es entre personas y nunca lleva
 * `refugioId`.
 *
 * Y lo que gestiona quien lo publicó (HU-13.3, desde "Mis publicaciones"): verlo, editarlo y
 * eliminarlo. Quedan afuera el histórico de estados y la reapertura de un caso resuelto.
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
import {
  ESTADO_ANIMAL_PERDIDO_RESUELTO,
  ESTADOS_ANIMAL_PERDIDO_EN_ALTA,
} from '../catalogos/catalogos.service';
import * as chats from '../chats/chats.service';
import { MARCADOR_FOTO_NUEVA } from '../publicaciones/publicaciones.dto';
import type {
  AvisoDto,
  CrearAvisoDto,
  EditarAvisoDto,
  ReclamoDto,
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
    lugar,
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

/**
 * El aviso en condiciones de ser reclamado o cerrado, o un error explicando por qué no.
 *
 * Las dos acciones de HU-13.2 comparten estas tres validaciones: que el aviso exista, que no
 * esté dado de baja y que el caso no esté ya cerrado. Lo que cambia es quién puede hacer
 * cada una, y eso lo chequea cada función.
 */
async function exigirAvisoAbierto(id: number) {
  const aviso = await repo.buscarParaReclamo(id);

  if (!aviso || aviso.fechaBaja) {
    throw new AppError('NO_ENCONTRADO', 'No encontramos ese aviso', 404);
  }

  if (aviso.estadoAnimalPerdido.nombre === ESTADO_ANIMAL_PERDIDO_RESUELTO) {
    throw new AppError('AVISO_RESUELTO', 'Este caso ya está resuelto', 409);
  }

  return aviso;
}

/**
 * HU-13.2: reclamar un aviso abre la sala de reencuentro con quien lo publicó.
 *
 * La sala es por aviso y por reclamante: ver `chats.asegurarChatDeReclamo`, que es donde
 * vive esa regla. Acá quedan las validaciones del aviso, que es la entidad de este módulo.
 *
 * **Idempotente**: el botón "Enviar mensaje" no se esconde después del primer reclamo, así
 * que volver a tocarlo devuelve la misma sala en vez de abrir otra. Por eso responde 200 y
 * no 201 — ver el contrato.
 *
 * El ámbito del pedido NO se mira: el aviso es de la persona y la sala también, así que un
 * miembro de refugio reclama como persona aunque esté mirando la app en vista refugio. Es la
 * misma razón por la que el alta no exige ámbito.
 */
export async function reclamarAviso(id: number, reclamanteId: number): Promise<ReclamoDto> {
  const aviso = await exigirAvisoAbierto(id);

  // El front ya esconde el botón con `esPropio`; esto cubre a quien llame a la API directo.
  // Es 400 y no 403: no es un permiso que le falte, es un pedido que no tiene sentido.
  if (aviso.usuarioReportanteId === reclamanteId) {
    throw new AppError('RECLAMO_PROPIO', 'Este aviso es tuyo: no podés reclamarlo', 400);
  }

  // Una cuenta dada de baja no puede recibir mensajes. El chat ya rechaza escribirle a un
  // contacto inactivo, pero abrir una sala muerta y mandar al usuario ahí es peor que
  // decírselo acá.
  if (aviso.usuarioReportante.fechaBaja) {
    throw new AppError(
      'REPORTANTE_INACTIVO',
      'No podemos abrir la conversación: la cuenta de quien publicó el aviso fue dada de baja',
      409,
    );
  }

  const { chatId, nueva } = await chats.asegurarChatDeReclamo(
    id,
    reclamanteId,
    aviso.usuarioReportanteId,
  );

  await registrarAuditoria({
    usuarioId: reclamanteId,
    accion: 'RECLAMAR',
    entidad: 'AnimalPerdido',
    entidadId: id,
    detalle: `chat=${chatId} nueva=${nueva}`,
  });

  return { chatId, nueva };
}

/**
 * HU-13.2: el reportante marca que el animal volvió y el caso se cierra.
 *
 * **Cierra el caso, no la conversación.** REQUISITOS §13 describe HU-13.3 como "cierra el caso
 * y el chat asociado"; esa segunda mitad se descartó por decisión del equipo del 2026-10-01
 * (ver spec 024 §9): desde que el reclamo entra en la conversación que ya existía con esa
 * persona, cerrarla cortaría charlas que no tienen nada que ver con el aviso. Y aunque fuera
 * una sala dedicada, silenciarla justo cuando el caso se resolvió es lo peor para coordinar la
 * entrega real del animal, que no termina cuando alguien toca el botón.
 *
 * Lo que sí hace: el estado pasa a Resuelto y se llena `fecha_resuelto`. El portal lo marca
 * con "Volvió con su dueño", que es el criterio de aceptación de la HU.
 *
 * Sólo el reportante: es su caso. Un reclamante que crea que ya está no cierra nada.
 *
 * Lo que NO hace, y es HU-13.3: reabrir un caso cerrado, pasar de Perdido a Encontrado o
 * guardar el histórico de estados. Por eso "Resuelto" es terminal por ahora.
 */
export async function marcarResuelto(id: number, usuarioId: number): Promise<AvisoDto> {
  const aviso = await exigirAvisoAbierto(id);

  if (aviso.usuarioReportanteId !== usuarioId) {
    throw new AppError('SIN_PERMISO', 'Sólo quien publicó el aviso puede resolverlo', 403);
  }

  const resuelto = await repo.buscarEstadoPorNombre(ESTADO_ANIMAL_PERDIDO_RESUELTO);

  // El catálogo viene sembrado con los tres estados; si falta, es un problema de datos y no
  // algo que el usuario pueda arreglar.
  if (!resuelto) {
    throw new AppError('ESTADO_INVALIDO', 'No pudimos resolver el aviso', 500);
  }

  const actualizado = await repo.marcarResuelto({
    id,
    estadoId: resuelto.id,
    usuarioId,
  });

  await registrarAuditoria({
    usuarioId,
    accion: 'RESOLVER',
    entidad: 'AnimalPerdido',
    entidadId: id,
    detalle: `estado=${resuelto.nombre}`,
  });

  return aDto(actualizado, usuarioId);
}

// ─────────────── HU-13.3 · Lo que gestiona quien publicó el aviso ───────────────

const NO_ENCONTRADO = 'No encontramos ese aviso';

/**
 * Un aviso por id, para abrir su detalle desde la tarjeta del chat (HU-13.2) o desde Mis
 * publicaciones. Con `usuario`, trae la distancia como el portal.
 *
 * Un aviso dado de baja responde `AVISO_ELIMINADO` y no "no existe": la tarjeta del chat sigue
 * mostrándolo (es lo que se habló), así que quien la toca tiene que entender qué pasó.
 */
export async function obtenerAviso(
  id: number,
  usuarioId: number,
  usuario: Coordenadas | null,
): Promise<AvisoDto> {
  const aviso = await repo.buscarPorId(id);

  if (!aviso) {
    throw new AppError('NO_ENCONTRADO', NO_ENCONTRADO, 404);
  }
  if (aviso.fechaBaja) {
    throw new AppError('AVISO_ELIMINADO', 'Se eliminó esta publicación', 404);
  }

  return aDto(aviso, usuarioId, usuario);
}

/** Los avisos del usuario, en cualquier estado, para "Mis publicaciones". */
export async function listarMisAvisos(usuarioId: number): Promise<AvisoDto[]> {
  const avisos = await repo.listarDeReportante(usuarioId);
  return avisos.map((aviso) => aDto(aviso, usuarioId));
}

/** El aviso vivo y de quien lo pide, o el error que corresponde. */
async function exigirAvisoPropio(id: number, usuarioId: number, accion: string) {
  const aviso = await repo.buscarPorId(id);

  if (!aviso || aviso.fechaBaja) {
    throw new AppError('NO_ENCONTRADO', NO_ENCONTRADO, 404);
  }
  if (aviso.usuarioReportanteId !== usuarioId) {
    throw new AppError('SIN_PERMISO', `Sólo quien publicó el aviso puede ${accion}`, 403);
  }

  return aviso;
}

/**
 * El estado que queda después de editar. Entre Perdido y Encontrado se puede cambiar (quien lo
 * cargó pudo equivocarse); a Resuelto no, que tiene su propio botón y su confirmación; y uno
 * Resuelto no cambia, porque el caso está cerrado.
 */
async function resolverEstadoEditado(
  actual: { id: number; nombre: string },
  estadoId: number,
): Promise<{ id: number; nombre: string }> {
  if (actual.nombre === ESTADO_ANIMAL_PERDIDO_RESUELTO) {
    if (estadoId !== actual.id) {
      throw new AppError(
        'AVISO_RESUELTO',
        'Este caso ya está resuelto: no se puede cambiar su estado',
        409,
      );
    }
    return actual;
  }

  const estado = await repo.buscarEstado(estadoId);

  if (!estado) {
    throw new AppError('NO_ENCONTRADO', 'El estado no existe', 404);
  }
  if (!ESTADOS_ANIMAL_PERDIDO_EN_ALTA.includes(estado.nombre)) {
    throw new AppError(
      'ESTADO_INVALIDO',
      'El aviso tiene que ser de una mascota perdida o encontrada. Para cerrar el caso, marcalo como resuelto.',
      400,
    );
  }

  return estado;
}

/**
 * La galería que manda el cliente sólo puede reordenar fotos que el aviso ya tiene y ubicar las
 * nuevas: nunca apuntar a un archivo ajeno. Misma regla que la edición de una publicación.
 */
function validarGaleria(orden: string[], cantidadNuevas: number, permitidas: string[]): void {
  const marcas = orden.filter((item) => item === MARCADOR_FOTO_NUEVA).length;

  if (marcas !== cantidadNuevas) {
    throw new AppError('VALIDACION', 'Las fotos nuevas no coinciden con la galería enviada', 400);
  }

  const existentes = orden.filter((item) => item !== MARCADOR_FOTO_NUEVA);

  if (existentes.some((url) => !permitidas.includes(url))) {
    throw new AppError('VALIDACION', 'Una de las fotos no pertenece al aviso', 400);
  }
  if (new Set(existentes).size !== existentes.length) {
    throw new AppError('VALIDACION', 'La galería tiene fotos repetidas', 400);
  }
  if (orden.length === 0) {
    throw new AppError('FOTO_REQUERIDA', 'Agregá una foto del animal', 400);
  }
}

export interface ContextoEdicion {
  usuarioId: number;
  /** Las fotos nuevas, en el orden de sus marcas en `imagenes`. */
  archivos: { buffer: Buffer; mimetype: string }[];
}

/**
 * HU-13.3: quien publicó el aviso lo edita. Reemplaza todo lo que carga el formulario, con las
 * mismas reglas que el alta. Las coordenadas del teléfono no se tocan.
 *
 * El pin del lugar: el que mande el cliente (lo vio en el mapa); si no manda ninguno y el lugar
 * cambió, se vuelve a geocodificar; si no cambió, queda el que tenía.
 *
 * Las fotos que se sacaron se borran del almacenamiento recién después de guardar.
 */
export async function editarAviso(
  id: number,
  datos: EditarAvisoDto,
  contexto: ContextoEdicion,
): Promise<AvisoDto> {
  const { usuarioId, archivos } = contexto;
  const aviso = await exigirAvisoPropio(id, usuarioId, 'editarlo');
  const estado = await resolverEstadoEditado(aviso.estadoAnimalPerdido, datos.estadoId);

  if (estado.nombre === ESTADO_QUE_EXIGE_NOMBRE && !datos.nombre) {
    throw new AppError('VALIDACION', 'El nombre es obligatorio', 400);
  }

  if (!(await repo.buscarEspecie(datos.especieId))) {
    throw new AppError('NO_ENCONTRADO', 'La especie no existe', 404);
  }

  const actuales = aviso.imagenes.length > 0 ? aviso.imagenes : [aviso.imagenUrl];
  validarGaleria(datos.imagenes, archivos.length, actuales);

  const elegido =
    datos.lugarLatitud !== undefined && datos.lugarLongitud !== undefined
      ? { latitud: datos.lugarLatitud, longitud: datos.lugarLongitud }
      : null;
  const cambioElLugar =
    datos.provincia !== aviso.provincia ||
    datos.localidad !== aviso.localidad ||
    datos.referencia !== aviso.referencia;
  const lugar =
    elegido ??
    (cambioElLugar
      ? await geocodificarLugar({
          provincia: datos.provincia,
          localidad: datos.localidad,
          referencia: datos.referencia,
        })
      : lugarDe(aviso));

  const nuevas = archivos.length > 0 ? await guardarImagenes(archivos, SUBCARPETA_FOTOS) : [];
  let siguienteNueva = 0;
  const imagenes = datos.imagenes.map((item) =>
    item === MARCADOR_FOTO_NUEVA ? nuevas[siguienteNueva++]! : item,
  );

  let actualizado: repo.AvisoConRelaciones;
  try {
    actualizado = await repo.actualizar(
      id,
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
        especieId: datos.especieId,
        estadoAnimalPerdidoId: estado.id,
      },
      usuarioId,
    );
  } catch (err) {
    if (nuevas.length > 0) await borrarImagenes(nuevas);
    throw err;
  }

  const quitadas = actuales.filter((url) => !imagenes.includes(url));
  if (quitadas.length > 0) await borrarImagenes(quitadas);

  await registrarAuditoria({
    usuarioId,
    accion: 'MODIFICAR',
    entidad: 'AnimalPerdido',
    entidadId: id,
    detalle: `estado=${estado.nombre} lugar=${elegido ? 'elegido' : cambioElLugar ? (lugar ? 'geocodificado' : 'sin-ubicar') : 'sin-cambios'}`,
  });

  return aDto(actualizado, usuarioId);
}

/**
 * HU-13.3: quien publicó el aviso lo elimina (baja lógica). Sale del portal y de Mis
 * publicaciones.
 *
 * **Uno resuelto no se elimina**: es el registro de que la mascota volvió, y la leyenda "Volvió
 * con su dueño" es lo que la HU pide mostrar.
 *
 * Las conversaciones donde se reclamó no cambian: la tarjeta del aviso queda en el chat, con su
 * foto (por eso las fotos no se borran), y al tocarla el detalle responde `AVISO_ELIMINADO`.
 */
export async function eliminarAviso(id: number, usuarioId: number): Promise<void> {
  const aviso = await exigirAvisoPropio(id, usuarioId, 'eliminarlo');

  if (aviso.estadoAnimalPerdido.nombre === ESTADO_ANIMAL_PERDIDO_RESUELTO) {
    throw new AppError(
      'AVISO_RESUELTO',
      'No podés eliminar un aviso resuelto: queda como registro de que la mascota volvió con su dueño.',
      409,
    );
  }

  await repo.darDeBajaPorReportante(id, usuarioId);

  await registrarAuditoria({
    usuarioId,
    accion: 'ELIMINAR',
    entidad: 'AnimalPerdido',
    entidadId: id,
  });
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
