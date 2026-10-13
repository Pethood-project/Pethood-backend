/**
 * HU-7.6: cancela automáticamente las solicitudes "Pendiente" que llevan más de
 * `tipoSolicitud.secuenciaDias` días sin respuesta (`usuario_baja = "SISTEMA"`).
 *
 * Función pura + entrypoint CLI, testeable sin levantar el servidor HTTP
 * (docs/ARQUITECTURA.md). Se invoca desde un cron del sistema (crontab/systemd timer) —
 * no vive embebido en app.ts/server.ts. Decisión y razones en
 * docs/specs/003-adopcion-favoritos.md § Notas y decisiones.
 *
 * Ejemplo de crontab (una vez por día a las 3am):
 *   0 3 * * * cd /ruta/al/repo && node dist/jobs/cancelar-solicitudes-vencidas.job.js
 */
import { USUARIO_SISTEMA_ID } from '../shared/auditoria';
import { registrarAuditoria } from '../shared/logAuditoria';
import * as repo from '../modules/solicitudes/solicitudes.repository';
import * as notificaciones from '../modules/notificaciones/notificaciones.service';
import { destinatariosPublicador } from '../modules/solicitudes/solicitudes.service';

const MS_POR_DIA = 24 * 60 * 60 * 1000;

function vencida(fechaDesdePendiente: Date, secuenciaDias: number, ahora: Date): boolean {
  return fechaDesdePendiente.getTime() + secuenciaDias * MS_POR_DIA <= ahora.getTime();
}

/** Aviso previo, spec 004: 14 días antes de la cancelación automática de HU-7.6. */
const DIAS_AVISO_PREVIO = 14;

function proximaAVencer(fechaDesdePendiente: Date, secuenciaDias: number, ahora: Date): boolean {
  const faltan = fechaDesdePendiente.getTime() + secuenciaDias * MS_POR_DIA - ahora.getTime();
  return faltan > 0 && faltan <= DIAS_AVISO_PREVIO * MS_POR_DIA;
}

/**
 * `ahora` es inyectable para poder testear los bordes de la ventana de vencimiento sin
 * depender del reloj real.
 */
export async function cancelarSolicitudesVencidas(ahora = new Date()): Promise<number> {
  const estadoCancelada = await repo.buscarEstadoSolicitudPorNombre('Cancelada');
  if (!estadoCancelada) {
    throw new Error('Falta el estado "Cancelada" en el catálogo EstadoSolicitud');
  }

  const solicitudes = await repo.listarSinRespuestaConDetalle();
  let canceladas = 0;

  for (const solicitud of solicitudes) {
    const vigente = solicitud.historicoEstados[0];
    // "Sin respuesta" también incluye En_Revision: esta es la fuente de verdad real.
    if (vigente?.estadoSolicitud.nombre !== 'Pendiente') continue;

    if (proximaAVencer(vigente.fechaAlta, solicitud.tipoSolicitud.secuenciaDias, ahora)) {
      const nombreMascota = solicitud.publicacion.mascota.nombre ?? 'la mascota';
      await notificaciones.notificarUnaVez({
        usuarioId: solicitud.usuarioId,
        tipo: 'SOLICITUD_PROXIMA_A_VENCER',
        mensaje: `Tu solicitud por ${nombreMascota} sigue sin respuesta y se va a cancelar sola si nadie responde`,
        asuntoMail: `Tu solicitud por ${nombreMascota} está por vencer`,
        entidadTipo: 'SOLICITUD',
        entidadId: solicitud.id,
        canal: { mail: true },
        usuarioAlta: USUARIO_SISTEMA_ID,
      });
    }

    if (!vencida(vigente.fechaAlta, solicitud.tipoSolicitud.secuenciaDias, ahora)) continue;

    const canceladaAhora = await repo.cancelarSiPendiente(
      solicitud.id,
      estadoCancelada.id,
      USUARIO_SISTEMA_ID,
    );
    // Si ya no estaba Pendiente (un refugio la resolvió un instante antes que el cron), no
    // hay nada que cancelar: no es un error, es la carrera esperada.
    if (!canceladaAhora) continue;

    canceladas++;
    await registrarAuditoria({
      usuarioId: USUARIO_SISTEMA_ID,
      accion: 'CANCELAR',
      entidad: 'Solicitud',
      entidadId: solicitud.id,
      detalle: `Pendiente -> Cancelada (vencida, tipo=${solicitud.tipoSolicitud.nombre}, secuenciaDias=${solicitud.tipoSolicitud.secuenciaDias})`,
    });

    await avisarCancelacionPorVencida(solicitud);
  }

  return canceladas;
}

/** Spec 004: "tu solicitud se canceló automáticamente por vencida", a las dos puntas.
 * Best-effort: la solicitud ya se canceló, un aviso que falla no la revierte. */
async function avisarCancelacionPorVencida(
  solicitud: Awaited<ReturnType<typeof repo.listarSinRespuestaConDetalle>>[number],
): Promise<void> {
  const mascota = solicitud.publicacion.mascota;
  const nombreMascota = mascota.nombre ?? 'la mascota';

  await notificaciones.notificar({
    usuarioId: solicitud.usuarioId,
    tipo: 'SOLICITUD_CANCELADA_VENCIDA',
    mensaje: `Tu solicitud por ${nombreMascota} se canceló automáticamente por falta de respuesta`,
    asuntoMail: `Tu solicitud por ${nombreMascota} se canceló`,
    entidadTipo: 'SOLICITUD',
    entidadId: solicitud.id,
    canal: { mail: true },
    usuarioAlta: USUARIO_SISTEMA_ID,
  });

  let destinatarios: number[] = [];
  try {
    destinatarios = await destinatariosPublicador(mascota, solicitud.publicacion.usuarioId);
  } catch (err) {
    console.error('No se pudo resolver a quién avisarle la cancelación', solicitud.id, err);
    return;
  }

  await Promise.all(
    destinatarios.map((usuarioId) =>
      notificaciones.notificar({
        usuarioId,
        tipo: 'SOLICITUD_CANCELADA_VENCIDA',
        mensaje: `La solicitud por ${nombreMascota} se canceló automáticamente por falta de respuesta`,
        asuntoMail: `Una solicitud por ${nombreMascota} se canceló`,
        entidadTipo: 'SOLICITUD',
        entidadId: solicitud.id,
        canal: { mail: true },
        usuarioAlta: USUARIO_SISTEMA_ID,
      }),
    ),
  );
}

if (require.main === module) {
  cancelarSolicitudesVencidas()
    .then((cantidad) => {
      console.log(`✅ cancelar-solicitudes-vencidas: ${cantidad} solicitud(es) cancelada(s).`);
      process.exit(0);
    })
    .catch((err) => {
      console.error('❌ Error en cancelar-solicitudes-vencidas:', err);
      process.exit(1);
    });
}
