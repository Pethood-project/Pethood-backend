/**
 * Moderación y Reportes (Módulo 3, spec 008).
 *
 * El reporte apunta a lo reportado con `tipo` + `objeto_id`, sin FK: por eso cada tipo tiene
 * un resolver (`cargarObjeto`) que dice si existe, cómo se llama, de quién es y en qué estado
 * está. Todas las reglas por tipo (existe, no es propio, etiqueta) salen de ese único punto.
 *
 * Resolver un reporte NO da de baja nada: la acción sobre el objeto (suspender, dar de baja)
 * son los endpoints de admin que ya existen. Solo marca el reporte y avisa al reportante.
 */
import type { TipoReporte } from '@prisma/client';
import { AppError } from '../../middlewares/errorHandler';
import { registrarAuditoria } from '../../shared/logAuditoria';
import { etiquetaUbicacion } from '../../shared/ubicacion';
import { firmarUrlsArchivo } from '../../shared/urlFirmada';
import type { CrearReporteBody, FiltrosReportes, ResolverReporteBody } from './reportes.dto';
import * as repo from './reportes.repository';

/** Máximo de reportes pendientes por usuario (regla 7 transversal: anti-spam). */
const MAX_PENDIENTES = 5;
/** Mensajes de contexto de cada lado del reportado que ve el admin (spec 008). */
export const VENTANA_CONTEXTO_MENSAJES = 10;
const LARGO_ETIQUETA = 60;

type EstadoObjeto = 'ACTIVO' | 'SUSPENDIDO' | 'DE_BAJA';

type Persona = { id: number; nombre: string; apellido: string };

/**
 * Lo que ve el admin del objeto reportado, discriminado por `tipo` (pedido de web-admin,
 * `VistaObjetoReporte` en su `types/admin-reportes.ts`). PUBLICACION, REFUGIO y MENSAJE no
 * llevan vista: web-admin usa sus endpoints propios y `contexto[]`.
 */
export type VistaObjeto =
  | {
      tipo: 'USUARIO';
      nombre: string;
      apellido: string;
      email: string;
      telefono: string | null;
      imagenUrl: string | null;
      verificado: boolean;
      estado: string;
      fechaAlta: string;
      provincia: string | null;
      localidad: string | null;
      refugios: Array<{ id: number; nombre: string }>;
    }
  | {
      tipo: 'RESENA';
      puntuacion: number;
      comentario: string | null;
      fecha: string;
      autor: Persona;
      receptor: { tipo: 'REFUGIO' | 'PERSONA'; id: number; nombre: string };
    }
  | {
      tipo: 'ANIMAL_PERDIDO';
      nombre: string | null;
      estado: string;
      descripcion: string;
      imagenes: string[];
      ubicacion: string | null;
      fechaSuceso: string;
      reportante: Persona;
    }
  | {
      tipo: 'CAMPANIA';
      titulo: string;
      descripcion: string;
      estado: string;
      montoObjetivo: number;
      montoActual: number;
      fechaInicio: string;
      fechaFin: string;
      imagenes: string[];
      refugio: { id: number; nombre: string };
    };

/** Lo que el service necesita saber de cualquier objeto reportable, sea de la tabla que sea. */
interface ObjetoReportado {
  etiqueta: string;
  estado: EstadoObjeto;
  /** Miniatura para la tabla: portada, logo o avatar. `null` si el tipo no tiene. */
  imagenUrl: string | null;
  /** Persona a la que «pertenece» el objeto (autor, dueño, o la persona misma). */
  usuarioId: number | null;
  /** Refugio al que «pertenece»: un miembro no puede reportar lo de su propio refugio. */
  refugioId: number | null;
  chatId?: number;
  vista?: VistaObjeto;
}

const recortar = (texto: string) =>
  texto.length > LARGO_ETIQUETA ? `${texto.slice(0, LARGO_ETIQUETA - 1)}…` : texto;

const nombreCompleto = (p: { nombre: string; apellido: string }) => `${p.nombre} ${p.apellido}`;

function estadoDe(fechaBaja: Date | null, estado?: { nombre: string }): EstadoObjeto {
  if (fechaBaja) return 'DE_BAJA';
  return estado?.nombre === 'Suspendido' ? 'SUSPENDIDO' : 'ACTIVO';
}

const iso = (fecha: Date) => fecha.toISOString();

/** `null` si no existe (o, sin `incluirBajas`, si está dado de baja). */
async function cargarObjeto(
  tipo: TipoReporte,
  id: number,
  incluirBajas: boolean,
): Promise<ObjetoReportado | null> {
  switch (tipo) {
    case 'PUBLICACION': {
      const o = await repo.BUSCAR_OBJETO.PUBLICACION(id, incluirBajas);
      return (
        o && {
          etiqueta: o.titulo,
          estado: estadoDe(o.fechaBaja),
          imagenUrl: o.imagenUrl,
          usuarioId: o.usuarioId,
          refugioId: o.mascota.refugioId,
        }
      );
    }
    case 'USUARIO': {
      const o = await repo.BUSCAR_OBJETO.USUARIO(id, incluirBajas);
      return (
        o && {
          etiqueta: nombreCompleto(o),
          estado: estadoDe(o.fechaBaja, o.estado),
          imagenUrl: o.imagenUrl,
          usuarioId: o.id,
          refugioId: null,
          vista: {
            tipo: 'USUARIO',
            nombre: o.nombre,
            apellido: o.apellido,
            email: o.email,
            telefono: o.telefono,
            imagenUrl: o.imagenUrl,
            verificado: o.verificado,
            estado: o.estado.nombre,
            fechaAlta: iso(o.fechaAlta),
            provincia: o.provincia,
            localidad: o.localidad,
            refugios: o.refugio ? [o.refugio] : [],
          },
        }
      );
    }
    case 'REFUGIO': {
      const o = await repo.BUSCAR_OBJETO.REFUGIO(id, incluirBajas);
      return (
        o && {
          etiqueta: o.nombre,
          estado: estadoDe(o.fechaBaja, o.estado),
          imagenUrl: o.imagenUrl,
          usuarioId: null,
          refugioId: o.id,
        }
      );
    }
    case 'RESENA': {
      const o = await repo.BUSCAR_OBJETO.RESENA(id, incluirBajas);
      if (!o) return null;
      // Una reseña tiene exactamente un receptor: un refugio o una persona.
      const receptor = o.refugioReportado
        ? { tipo: 'REFUGIO' as const, id: o.refugioReportado.id, nombre: o.refugioReportado.nombre }
        : {
            tipo: 'PERSONA' as const,
            id: o.usuarioReportado?.id ?? 0,
            nombre: o.usuarioReportado ? nombreCompleto(o.usuarioReportado) : 'Sin receptor',
          };
      return {
        etiqueta: recortar(o.comentario ?? 'Reseña sin comentario'),
        estado: estadoDe(o.fechaBaja),
        imagenUrl: null,
        usuarioId: o.usuarioAutorId,
        refugioId: null,
        vista: {
          tipo: 'RESENA',
          puntuacion: o.puntuacion,
          comentario: o.comentario,
          fecha: iso(o.fechaAlta),
          autor: o.autor,
          receptor,
        },
      };
    }
    case 'ANIMAL_PERDIDO': {
      const o = await repo.BUSCAR_OBJETO.ANIMAL_PERDIDO(id, incluirBajas);
      return (
        o && {
          etiqueta: recortar(o.nombre ?? o.descripcion),
          estado: estadoDe(o.fechaBaja),
          imagenUrl: o.imagenUrl,
          usuarioId: o.usuarioReportanteId,
          refugioId: null,
          vista: {
            tipo: 'ANIMAL_PERDIDO',
            nombre: o.nombre,
            estado: o.estadoAnimalPerdido.nombre,
            descripcion: o.descripcion,
            imagenes: o.imagenes.length > 0 ? o.imagenes : [o.imagenUrl],
            ubicacion: etiquetaUbicacion({
              calleAltura: o.referencia,
              localidad: o.localidad,
              provincia: o.provincia,
            }),
            // `fechaSuceso` es opcional en el aviso; el contrato la pide siempre: sin ella, la del alta.
            fechaSuceso: iso(o.fechaSuceso ?? o.fechaAlta),
            reportante: o.usuarioReportante,
          },
        }
      );
    }
    case 'CAMPANIA': {
      const o = await repo.BUSCAR_OBJETO.CAMPANIA(id, incluirBajas);
      return (
        o && {
          etiqueta: o.titulo,
          estado: estadoDe(o.fechaBaja),
          imagenUrl: o.imagenUrl,
          usuarioId: null,
          refugioId: o.refugioId,
          vista: {
            tipo: 'CAMPANIA',
            titulo: o.titulo,
            descripcion: o.descripcion,
            estado: o.estadoCampania.nombre,
            montoObjetivo: Number(o.objetivo),
            // ponytail: suma toda donación activa; `Donacion` aún no tiene confirmación del refugio
            // (regla 11). Cuando el Módulo 12 la agregue, sumar solo las confirmadas.
            montoActual: o.donaciones.reduce((suma, d) => suma + Number(d.monto), 0),
            fechaInicio: iso(o.fechaInicio),
            fechaFin: iso(o.fechaFin),
            imagenes: o.imagenUrl ? [o.imagenUrl] : [],
            refugio: o.refugio,
          },
        }
      );
    }
    case 'MENSAJE': {
      const o = await repo.BUSCAR_OBJETO.MENSAJE(id);
      // Los mensajes SOLICITUD los emite el sistema: no se reportan.
      if (!o || o.tipo !== 'TEXTO') return null;
      return {
        etiqueta: recortar(o.contenido || 'Mensaje con imágenes'),
        estado: 'ACTIVO',
        imagenUrl: null,
        usuarioId: o.usuarioId,
        refugioId: null,
        chatId: o.chatId,
      };
    }
  }
}

const noEncontrado = () => new AppError('NO_ENCONTRADO', 'Lo que querés reportar no existe', 404);

/** HU-3.1, 3.2 y 3.3. */
export async function crearReporte(usuarioId: number, datos: CrearReporteBody) {
  const actor = await repo.buscarUsuario(usuarioId);
  if (!actor) throw new AppError('NO_ENCONTRADO', 'El usuario no existe', 404);

  const objeto = await cargarObjeto(datos.tipo, datos.objetoId, false);
  if (!objeto) throw noEncontrado();

  // Un mensaje de un chat ajeno no se puede ni confirmar que existe.
  if (objeto.chatId !== undefined && !(await repo.esParticipanteDelChat(actor.id, objeto.chatId))) {
    throw noEncontrado();
  }

  const esPropio =
    objeto.usuarioId === actor.id ||
    (objeto.refugioId !== null && objeto.refugioId === actor.refugioId);
  if (esPropio) {
    throw new AppError('REPORTE_PROPIO', 'No podés reportar algo tuyo', 403);
  }

  if (await repo.buscarPendienteDuplicado(actor.id, datos.tipo, datos.objetoId)) {
    throw new AppError('REPORTE_DUPLICADO', 'Ya reportaste esto y está pendiente de revisión', 409);
  }

  if ((await repo.contarPendientesDelUsuario(actor.id)) >= MAX_PENDIENTES) {
    throw new AppError(
      'LIMITE_REPORTES',
      `Tenés ${MAX_PENDIENTES} reportes pendientes. Esperá a que se resuelvan para enviar otro`,
      409,
    );
  }

  try {
    const reporte = await repo.crear({ usuarioId: actor.id, ...datos });
    return {
      id: reporte.id,
      tipo: reporte.tipo,
      objetoId: reporte.objetoId,
      motivo: reporte.motivo,
      resuelto: false,
      fechaAlta: reporte.fechaAlta,
    };
  } catch (err) {
    // Dos reportes simultáneos del mismo par: el índice único parcial deja pasar uno.
    if (repo.esViolacionDeUnicidad(err)) {
      throw new AppError(
        'REPORTE_DUPLICADO',
        'Ya reportaste esto y está pendiente de revisión',
        409,
      );
    }
    throw err;
  }
}

type Reporte = NonNullable<Awaited<ReturnType<typeof repo.buscarReporte>>>;
type Personas = Map<number, { id: number; nombre: string; apellido: string }>;

async function cargarPersonas(ids: Array<number | null>): Promise<Personas> {
  const unicos = [...new Set(ids.filter((id): id is number => id !== null))];
  const personas = await repo.listarPersonas(unicos);
  return new Map(personas.map((p) => [p.id, p]));
}

const aPersona = (personas: Personas, id: number | null) => {
  const p = id === null ? undefined : personas.get(id);
  return p ? { id: p.id, nombre: p.nombre, apellido: p.apellido } : null;
};

type Conteos = Awaited<ReturnType<typeof repo.contarPorObjeto>>;

async function aItem(reporte: Reporte, personas: Personas, conteos: Conteos) {
  const objeto = await cargarObjeto(reporte.tipo, reporte.objetoId, true);
  const conteo = conteos.get(`${reporte.tipo}:${reporte.objetoId}`);

  return {
    id: reporte.id,
    tipo: reporte.tipo,
    motivo: reporte.motivo,
    resuelto: reporte.resuelto,
    reportante: aPersona(personas, reporte.usuarioAlta),
    objeto: {
      id: reporte.objetoId,
      etiqueta: objeto?.etiqueta ?? null,
      imagenUrl: objeto?.imagenUrl ?? null,
      // Cuántas veces se reportó este mismo objeto: sirve para priorizar a los reincidentes.
      reportesPendientes: conteo?.pendientes ?? 0,
      reportesTotales: conteo?.totales ?? 0,
    },
    fechaAlta: reporte.fechaAlta,
  };
}

/** HU-3.6. */
export async function listar(filtros: FiltrosReportes) {
  const { items, total } = await repo.listar(filtros);
  const personas = await cargarPersonas(items.map((r) => r.usuarioAlta));
  const conteos = await repo.contarPorObjeto(
    items.map((r) => ({ tipo: r.tipo, objetoId: r.objetoId })),
  );
  // ponytail: una consulta por ítem para el objeto; pagina de a 50 como máximo.
  const filas = await Promise.all(items.map((r) => aItem(r, personas, conteos)));

  return { items: filas, total, page: filtros.page, limit: filtros.limit };
}

/** La ventana de mensajes, con las fotos firmadas: la carpeta de chats es privada. */
async function contextoDeMensaje(chatId: number, mensajeId: number) {
  const mensajes = await repo.ventanaDeMensajes(chatId, mensajeId, VENTANA_CONTEXTO_MENSAJES);
  return mensajes.map((m) => ({ ...m, imagenes: firmarUrlsArchivo(m.imagenes) }));
}

/** HU-3.6: detalle con el objeto reportado, su estado actual y la vista según el tipo. */
export async function obtener(id: number) {
  const reporte = await repo.buscarReporte(id);
  if (!reporte) throw new AppError('NO_ENCONTRADO', 'El reporte no existe', 404);

  const objeto = await cargarObjeto(reporte.tipo, reporte.objetoId, true);
  const personas = await cargarPersonas([reporte.usuarioAlta, reporte.usuarioModificacion]);
  const conteos = await repo.contarPorObjeto([{ tipo: reporte.tipo, objetoId: reporte.objetoId }]);
  const item = await aItem(reporte, personas, conteos);

  return {
    ...item,
    respuesta: reporte.respuesta,
    fechaResolucion: reporte.resuelto ? reporte.fechaModificacion : null,
    resueltoPor: reporte.resuelto ? aPersona(personas, reporte.usuarioModificacion) : null,
    objeto: {
      ...item.objeto,
      estado: objeto?.estado ?? null,
      ...(objeto?.vista && { vista: objeto.vista }),
      // Solo el mensaje reportado y sus vecinos, nunca la conversación entera (spec 008).
      ...(objeto?.chatId !== undefined && {
        contexto: await contextoDeMensaje(objeto.chatId, reporte.objetoId),
      }),
    },
  };
}

/** HU-3.7. Marca el reporte y avisa al reportante; no actúa sobre el objeto. */
export async function resolver(adminId: number, id: number, body: ResolverReporteBody) {
  const reporte = await repo.buscarReporte(id);
  if (!reporte) throw new AppError('NO_ENCONTRADO', 'El reporte no existe', 404);
  if (reporte.resuelto) {
    throw new AppError('REPORTE_YA_RESUELTO', 'El reporte ya fue resuelto', 409);
  }

  await repo.resolver({
    id,
    adminId,
    respuesta: body.respuesta,
    reportanteId: reporte.usuarioAlta,
    mensajeAviso: `Un administrador resolvió tu reporte. Respuesta: ${body.respuesta}`,
  });
  await registrarAuditoria({
    usuarioId: adminId,
    accion: 'RESOLVER_REPORTE',
    entidad: 'ReporteProblema',
    entidadId: id,
    detalle: `tipo=${reporte.tipo} objetoId=${reporte.objetoId}`,
  });

  return obtener(id);
}

/** Reportes de una publicación, para su detalle de admin. */
export async function deObjeto(tipo: TipoReporte, objetoId: number) {
  const reportes = await repo.listarDeObjeto(tipo, objetoId);
  const personas = await cargarPersonas(reportes.map((r) => r.usuarioAlta));

  return reportes.map((r) => ({
    id: r.id,
    motivo: r.motivo,
    resuelto: r.resuelto,
    respuesta: r.respuesta,
    reportante: aPersona(personas, r.usuarioAlta),
    fechaAlta: r.fechaAlta,
  }));
}
