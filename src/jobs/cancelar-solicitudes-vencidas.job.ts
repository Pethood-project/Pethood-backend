/**
 * Cierra las solicitudes abiertas que llevan más de `tipoSolicitud.secuenciaDias` días sin
 * cambiar de estado: pasan a `Cerrada` con la causa `VENCIDA_SIN_RESPUESTA`, a nombre de
 * SISTEMA. Una solicitud que se mueve no vence; la que lleva el plazo quieta, sí.
 *
 * El archivo conserva su nombre porque es el que invoca el cron del sistema.
 *
 * Función pura + entrypoint CLI, testeable sin levantar el servidor HTTP
 * (docs/ARQUITECTURA.md). Se invoca desde un cron del sistema (crontab/systemd timer) —
 * no vive embebido en app.ts/server.ts.
 *
 * Ejemplo de crontab (una vez por día a las 3am):
 *   0 3 * * * cd /ruta/al/repo && node dist/jobs/cancelar-solicitudes-vencidas.job.js
 */
import { USUARIO_SISTEMA_ID } from '../shared/auditoria';
import { estaAbierta } from '../shared/requestStates';
import * as repo from '../modules/solicitudes/solicitudes.repository';
import * as notificaciones from '../modules/notificaciones/notificaciones.service';
import {
  cerrarSolicitudes,
  destinatariosPublicador,
} from '../modules/solicitudes/solicitudes.service';

const MS_POR_DIA = 24 * 60 * 60 * 1000;

function vencida(fechaDesdeEstado: Date, secuenciaDias: number, ahora: Date): boolean {
  return fechaDesdeEstado.getTime() + secuenciaDias * MS_POR_DIA <= ahora.getTime();
}

/** Aviso previo: 14 días antes del cierre automático. */
const DIAS_AVISO_PREVIO = 14;

function proximaAVencer(fechaDesdeEstado: Date, secuenciaDias: number, ahora: Date): boolean {
  const faltan = fechaDesdeEstado.getTime() + secuenciaDias * MS_POR_DIA - ahora.getTime();
  return faltan > 0 && faltan <= DIAS_AVISO_PREVIO * MS_POR_DIA;
}

type SolicitudConDetalle = Awaited<ReturnType<typeof repo.listarSinRespuestaConDetalle>>[number];

/**
 * `ahora` es inyectable para poder testear los bordes de la ventana de vencimiento sin
 * depender del reloj real.
 */
export async function cerrarSolicitudesVencidas(ahora = new Date()): Promise<number> {
  const solicitudes = await repo.listarSinRespuestaConDetalle();
  let cerradas = 0;

  for (const solicitud of solicitudes) {
    const vigente = solicitud.historicoEstados[0];
    // `fechaRespuesta: null` solo acota la consulta: la fuente de verdad es el estado vigente.
    if (!vigente || !estaAbierta(vigente.estadoSolicitud.nombre)) continue;

    const { secuenciaDias } = solicitud.tipoSolicitud;

    if (proximaAVencer(vigente.fechaAlta, secuenciaDias, ahora)) {
      const nombreMascota = solicitud.publicacion.mascota.nombre ?? 'la mascota';
      await notificaciones.notificarUnaVez({
        usuarioId: solicitud.usuarioId,
        tipo: 'SOLICITUD_PROXIMA_A_VENCER',
        mensaje: `Tu solicitud por ${nombreMascota} lleva mucho tiempo sin novedades y se va a cerrar sola si sigue así`,
        asuntoMail: `Tu solicitud por ${nombreMascota} está por cerrarse`,
        entidadTipo: 'SOLICITUD',
        entidadId: solicitud.id,
        canal: { mail: true },
        usuarioAlta: USUARIO_SISTEMA_ID,
      });
    }

    if (!vencida(vigente.fechaAlta, secuenciaDias, ahora)) continue;

    // Si una acción humana la resolvió un instante antes que el cron, no hay nada que cerrar:
    // no es un error, es la carrera esperada.
    const [cerrada] = await cerrarSolicitudes(
      [{ id: solicitud.id }],
      'VENCIDA_SIN_RESPUESTA',
      USUARIO_SISTEMA_ID,
    );
    if (cerrada === undefined) continue;

    cerradas++;
    await avisarAlPublicador(solicitud);
  }

  return cerradas;
}

/** Quien publicó se entera de que la solicitud se cerró sola. Best-effort. */
async function avisarAlPublicador(solicitud: SolicitudConDetalle): Promise<void> {
  const mascota = solicitud.publicacion.mascota;
  const nombreMascota = mascota.nombre ?? 'la mascota';

  let destinatarios: number[] = [];
  try {
    destinatarios = await destinatariosPublicador(mascota, solicitud.publicacion.usuarioId);
  } catch (err) {
    console.error('No se pudo resolver a quién avisarle el cierre', solicitud.id, err);
    return;
  }

  await Promise.all(
    destinatarios.map((usuarioId) =>
      notificaciones.notificar({
        usuarioId,
        tipo: 'SOLICITUD_CERRADA_VENCIDA',
        mensaje: `La solicitud por ${nombreMascota} se cerró sola por falta de novedades`,
        asuntoMail: `Una solicitud por ${nombreMascota} se cerró`,
        entidadTipo: 'SOLICITUD',
        entidadId: solicitud.id,
        canal: { mail: true },
        usuarioAlta: USUARIO_SISTEMA_ID,
      }),
    ),
  );
}

if (require.main === module) {
  cerrarSolicitudesVencidas()
    .then((cantidad) => {
      console.log(`✅ cancelar-solicitudes-vencidas: ${cantidad} solicitud(es) cerrada(s).`);
      process.exit(0);
    })
    .catch((err) => {
      console.error('❌ Error en cancelar-solicitudes-vencidas:', err);
      process.exit(1);
    });
}
