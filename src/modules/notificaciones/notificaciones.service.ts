/**
 * Servicio central de notificaciones (spec 004): el punto de entrada único que llama el
 * resto de los módulos. `notificar(...)` persiste SIEMPRE en la bandeja (regla 1) y además,
 * según lo que pida quien llama, encola push y/o mail en segundo plano (BullMQ) y avisa en
 * tiempo real por socket a la app abierta.
 *
 * Mismo patrón de import entre servicios que ya usa `solicitudes.service.ts` con
 * `chats.service.ts`: cualquier módulo puede importar `* as notificaciones` de acá.
 */
import { AppError } from '../../middlewares/errorHandler';
import { USUARIO_SISTEMA_ID } from '../../shared/auditoria';
import { encolarEnvioMail, encolarEnvioPush } from '../../shared/colaNotificaciones';
import * as emisor from '../../websockets/emisor';
import { estaEnLinea } from '../../websockets/presencia';
import type {
  ContadorNoLeidasDto,
  ListaNotificacionesDto,
  NotificacionItemDto,
  RegistrarDispositivoDto,
} from './notificaciones.dto';
import * as repo from './notificaciones.repository';

/** Título de respaldo: el cuerpo (`mensaje`) ya trae el contenido real. */
const TITULO_PUSH = 'PetHood';

/**
 * Título del push según el tipo. Android ya muestra "PetHood" arriba (nombre de la app), así
 * que acá va el asunto corto de la notificación. Un tipo sin entrada usa `TITULO_PUSH`.
 */
const TITULOS_PUSH: Record<string, string> = {
  CONTRASENA_CAMBIADA: 'Contraseña cambiada',
  PERFIL_INCOMPLETO: 'Completá tu perfil',
  SOLICITUD_NUEVA: 'Nueva solicitud',
  SOLICITUD_ACEPTADA: 'Solicitud aceptada',
  SOLICITUD_RECHAZADA: 'Solicitud rechazada',
  ADOPCION_COMPLETADA: 'Adopción completada',
  SOLICITUD_MASCOTA_ADOPTADA_POR_OTRO: 'Mascota adoptada',
  PUBLICACION_PAUSADA_CON_SOLICITUD: 'Publicación no disponible',
  FAVORITO_NO_DISPONIBLE: 'Favorito no disponible',
  MENSAJE_CHAT: 'Nuevo mensaje',
  USUARIO_VALIDADO: 'Cuenta validada',
  VERIFICACION_REVOCADA: 'Verificación revocada',
  CUENTA_SUSPENDIDA: 'Cuenta suspendida',
  REFUGIO_APROBADO: 'Refugio validado',
  REFUGIO_SUSPENDIDO: 'Refugio suspendido',
  TRANSITO_POR_COMENZAR: 'Tránsito por comenzar',
  TRANSITO_POR_VENCER: 'Tránsito por terminar',
  SEGUIMIENTO_NUEVO: 'Seguimiento nuevo',
  SEGUIMIENTO_RECORDATORIO_24H: 'Seguimiento por vencer',
  SEGUIMIENTO_VENCIDO: 'Seguimiento vencido',
  SEGUIMIENTO_DESCUIDO: 'Seguimiento sin enviar',
  SEGUIMIENTO_PREGUNTA_REFUGIO: 'Pregunta del refugio',
  SEGUIMIENTO_RESPONDIDO: 'Seguimiento recibido',
  FAVORITO_DISPONIBLE: 'Favorito disponible',
  FAVORITO_ADOPTADO: 'Mascota adoptada',
  RESENA_RECIBIDA: 'Nueva reseña',
  DONACION_NUEVA: 'Donación por confirmar',
  DONACION_CONFIRMADA: 'Donación confirmada',
  DONACION_RECHAZADA: 'Donación no confirmada',
  CAMPANIA_META_ALCANZADA: 'Campaña completa',
  CAMPANIA_FINALIZADA: 'Campaña finalizada',
  REPORTE_RESUELTO: 'Reporte resuelto',
  MODERACION_BAJA: 'Publicación dada de baja',
  ANIMAL_PERDIDO_RECLAMADO: 'Alguien se contactó',
  SEGUIMIENTO_TERMINADO: 'Seguimiento terminado',
  REPORTE_NUEVO: 'Nuevo reporte',
  MODERACION_BAJA_MASCOTA: 'Mascota dada de baja',
};

type NotificacionFila = Awaited<ReturnType<typeof repo.crear>>;

function aItemDto(fila: NotificacionFila): NotificacionItemDto {
  return {
    id: fila.id,
    tipo: fila.tipo,
    mensaje: fila.mensaje,
    leido: fila.leido,
    entidadTipo: fila.entidadTipo,
    entidadId: fila.entidadId,
    fechaAlta: fila.fechaAlta.toISOString(),
  };
}

async function avisarEnVivo(usuarioId: number, item: NotificacionItemDto): Promise<void> {
  emisor.emitirNotificacionNueva(usuarioId, item);
  emisor.emitirContadorNotificaciones(usuarioId, await repo.contarNoLeidas(usuarioId));
}

async function encolarPushParaUsuario(
  usuarioId: number,
  tipo: string,
  cuerpo: string,
  datos: { entidadTipo: string | null; entidadId: number | null },
  silencioso?: boolean,
  tituloPropio?: string,
): Promise<void> {
  const dispositivos = await repo.listarDispositivosActivos(usuarioId);
  if (dispositivos.length === 0) return;

  await encolarEnvioPush({
    badge: await repo.contarNoLeidas(usuarioId),
    tokens: dispositivos.map((d) => d.expoPushToken),
    titulo: tituloPropio ?? TITULOS_PUSH[tipo] ?? TITULO_PUSH,
    cuerpo,
    datos,
    silencioso,
  });
}

export interface NotificarInput {
  usuarioId: number;
  /** Código corto (ej. `SOLICITUD_ACEPTADA`), para filtrar/depurar — no lo ve el usuario. */
  tipo: string;
  /** Texto final, ya en voseo, listo para bandeja y push. */
  mensaje: string;
  /** A qué navegar al tocarla. Sin FK real (ver `MODELO_DATOS.md`). */
  entidadTipo?: string;
  entidadId?: number;
  /** Bandeja siempre se escribe; esto decide los canales EXTRA (regla 2). */
  canal?: { mail?: boolean; push?: boolean };
  /** Asunto del mail, si `canal.mail`. Sin él, se usa `mensaje` (mejor pasarlo siempre que se manda mail). */
  asuntoMail?: string;
  /** Regla 7: no suena de noche (22–08, hora Argentina). Se entrega igual, sin sonido. */
  silenciosoDeNoche?: boolean;
  /** Quién dispara el alta (auditoría). Por defecto, el sistema (jobs, reacciones automáticas). */
  usuarioAlta?: number;
}

/**
 * Best-effort a propósito, mismo criterio que ya usa `chats.asegurarChatDeSolicitud` en
 * `solicitudes.service.ts`: notificar es una CONSECUENCIA de la acción real (crear una
 * solicitud, registrarse, aprobar un refugio...), nunca la acción en sí. Que falle un envío
 * de push, un mail, o incluso el guardado en bandeja, no puede tirar abajo la operación
 * principal — se loguea y se sigue.
 */
export async function notificar(input: NotificarInput): Promise<void> {
  try {
    const fila = await repo.crear({
      usuarioId: input.usuarioId,
      tipo: input.tipo,
      mensaje: input.mensaje,
      entidadTipo: input.entidadTipo,
      entidadId: input.entidadId,
      usuarioAlta: input.usuarioAlta ?? USUARIO_SISTEMA_ID,
    });

    const item = aItemDto(fila);
    await avisarEnVivo(input.usuarioId, item);

    const canal = input.canal;
    if (!canal) return;

    // Regla 3: con la app abierta, no se manda push — la bandeja ya se actualizó en vivo arriba.
    if (canal.push && !estaEnLinea(input.usuarioId)) {
      await encolarPushParaUsuario(
        input.usuarioId,
        input.tipo,
        input.mensaje,
        { entidadTipo: item.entidadTipo, entidadId: item.entidadId },
        input.silenciosoDeNoche,
      );
    }

    if (canal.mail) {
      const usuario = await repo.buscarEmailUsuario(input.usuarioId);
      if (usuario?.email) {
        await encolarEnvioMail({
          to: usuario.email,
          asunto: input.asuntoMail ?? input.mensaje,
          texto: input.mensaje,
        });
      }
    }
  } catch (err) {
    console.error(`No se pudo notificar (tipo=${input.tipo}, usuarioId=${input.usuarioId}):`, err);
  }
}

/**
 * Variante para los jobs programados (spec 004, entregable 4): igual que `notificar`, pero
 * no manda nada si YA se mandó antes esta misma notificación puntual (mismo `tipo` +
 * `entidadTipo` + `entidadId` + usuario). Necesita las dos para saber de qué evento se trata.
 *
 * Así los jobs pueden correr las veces que hagan falta (cada hora, cada día) sin duplicar el
 * recordatorio de 24h ni el aviso de "seguimiento nuevo" en cada corrida.
 */
export async function notificarUnaVez(
  input: NotificarInput & { entidadTipo: string; entidadId: number },
): Promise<void> {
  try {
    const yaExiste = await repo.existioAlguna(
      input.usuarioId,
      input.tipo,
      input.entidadTipo,
      input.entidadId,
    );
    if (yaExiste) return;

    await notificar(input);
  } catch (err) {
    console.error(`No se pudo notificar (tipo=${input.tipo}, usuarioId=${input.usuarioId}):`, err);
  }
}

/**
 * Mail directo, SIN pasar por la bandeja (regla 1 es la excepción, no la norma, acá): para
 * contenido de un solo uso y sensible como un código de recuperación de contraseña, que no
 * tiene sentido que quede guardado ni mostrado en la app.
 */
export async function enviarMailDirecto(mail: {
  to: string;
  asunto: string;
  texto: string;
}): Promise<void> {
  try {
    await encolarEnvioMail(mail);
  } catch (err) {
    console.error(`No se pudo encolar el mail directo a ${mail.to}:`, err);
  }
}

/**
 * Solo el push, para los avisos cuya fila de bandeja ya escribió otro repository (reporte
 * resuelto, baja por moderación). Mismo criterio que `notificar`: sin push si la app está
 * abierta, y nunca tira.
 */
export async function notificarSoloPush(input: {
  usuarioId: number;
  tipo: string;
  mensaje: string;
  entidadTipo?: string;
  entidadId?: number;
}): Promise<void> {
  try {
    if (estaEnLinea(input.usuarioId)) return;

    await encolarPushParaUsuario(input.usuarioId, input.tipo, input.mensaje, {
      entidadTipo: input.entidadTipo ?? null,
      entidadId: input.entidadId ?? null,
    });
  } catch (err) {
    console.error(
      `No se pudo mandar el push (tipo=${input.tipo}, usuarioId=${input.usuarioId}):`,
      err,
    );
  }
}

export interface NotificarMensajeChatInput {
  destinatarioId: number;
  chatId: number;
  /** Ya armado por `chats.service.ts` ("Tenés 3 mensajes nuevos de X") — ver regla 4. */
  mensaje: string;
  /** Lo que muestra el push: nombre de quien escribe y su mensaje (ya recortado). */
  push?: { titulo: string; cuerpo: string };
}

/**
 * Caso especial de chat (regla 4): en vez de una fila por mensaje, se hace upsert sobre la
 * notificación agrupada sin leer de esa sala. `chats.service.ts` ya filtró antes de llamar
 * acá a quien tiene la conversación abierta — a esta altura, siempre corresponde avisar.
 */
export async function notificarMensajeChat(input: NotificarMensajeChatInput): Promise<void> {
  try {
    const existente = await repo.buscarChatAgrupadaSinLeer(input.destinatarioId, input.chatId);

    const fila = existente
      ? await repo.actualizarMensaje(existente.id, input.mensaje, USUARIO_SISTEMA_ID)
      : await repo.crear({
          usuarioId: input.destinatarioId,
          tipo: 'MENSAJE_CHAT',
          mensaje: input.mensaje,
          entidadTipo: 'CHAT',
          entidadId: input.chatId,
          usuarioAlta: USUARIO_SISTEMA_ID,
        });

    const item = aItemDto(fila);
    await avisarEnVivo(input.destinatarioId, item);

    if (!estaEnLinea(input.destinatarioId)) {
      await encolarPushParaUsuario(
        input.destinatarioId,
        'MENSAJE_CHAT',
        input.push?.cuerpo ?? input.mensaje,
        { entidadTipo: item.entidadTipo, entidadId: item.entidadId },
        undefined,
        input.push?.titulo,
      );
    }
  } catch (err) {
    console.error(`No se pudo notificar el mensaje de chat ${input.chatId}:`, err);
  }
}

// ─────────────── Bandeja ───────────────

export async function listarBandeja(
  usuarioId: number,
  limite: number,
  cursor?: number,
): Promise<ListaNotificacionesDto> {
  if (cursor !== undefined && !(await repo.existeVisible(usuarioId, cursor))) {
    return { notificaciones: [], hayMas: false, proximoCursor: null };
  }

  const filas = await repo.listarDeUsuario(usuarioId, limite, cursor);
  const hayMas = filas.length > limite;
  const pagina = hayMas ? filas.slice(0, limite) : filas;

  return {
    notificaciones: pagina.map(aItemDto),
    hayMas,
    proximoCursor: hayMas ? pagina[pagina.length - 1]!.id : null,
  };
}

export async function contarNoLeidas(usuarioId: number): Promise<ContadorNoLeidasDto> {
  return { contador: await repo.contarNoLeidas(usuarioId) };
}

async function exigirPropia(usuarioId: number, notificacionId: number) {
  const fila = await repo.buscarPropia(usuarioId, notificacionId);

  if (!fila) {
    // 404 y no 403 a propósito (regla 8): no hay que confirmar que existe una de otro usuario.
    throw new AppError('NO_ENCONTRADA', 'No encontramos esa notificación', 404);
  }

  return fila;
}

export async function marcarLeida(usuarioId: number, notificacionId: number): Promise<void> {
  await exigirPropia(usuarioId, notificacionId);
  await repo.marcarLeida(notificacionId, usuarioId);
  emisor.emitirContadorNotificaciones(usuarioId, await repo.contarNoLeidas(usuarioId));
}

export async function marcarTodasLeidas(usuarioId: number): Promise<void> {
  await repo.marcarTodasLeidas(usuarioId);
  emisor.emitirContadorNotificaciones(usuarioId, 0);
}

export async function eliminar(usuarioId: number, notificacionId: number): Promise<void> {
  await exigirPropia(usuarioId, notificacionId);
  await repo.darDeBaja(notificacionId, usuarioId);
  emisor.emitirContadorNotificaciones(usuarioId, await repo.contarNoLeidas(usuarioId));
}

// ─────────────── Dispositivos push ───────────────

export async function registrarDispositivo(
  usuarioId: number,
  dto: RegistrarDispositivoDto,
): Promise<void> {
  await repo.registrarDispositivo(usuarioId, dto.expoPushToken, dto.plataforma);
}

export async function eliminarDispositivo(usuarioId: number, expoPushToken: string): Promise<void> {
  await repo.darDeBajaDispositivo(usuarioId, expoPushToken);
}
