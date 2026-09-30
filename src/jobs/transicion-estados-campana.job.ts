/**
 * HU-12.4: mueve las campañas entre estados por fecha y por monto (usuario SISTEMA):
 * Inactiva → Activa al llegar `fecha_inicio`; Activa → Finalizada al pasar `fecha_fin` o al
 * alcanzar el objetivo con donaciones Realizada.
 *
 * Función pura + entrypoint CLI, testeable sin levantar el servidor HTTP, igual que
 * `cancelar-solicitudes-vencidas.job.ts`. Se invoca desde un cron del sistema.
 *
 * Ejemplo de crontab (una vez por día a las 0:05, apenas cambia la fecha):
 *   5 0 * * * cd /ruta/al/repo && node dist/jobs/transicion-estados-campana.job.js
 */
import {
  ESTADO_CAMPANIA,
  siguienteEstadoAutomatico,
  type NombreEstadoCampania,
} from '../modules/campanias/campanias.estados';
import * as repo from '../modules/campanias/campanias.repository';
import { idsEstadosCampania } from '../modules/campanias/campanias.service';
import { USUARIO_SISTEMA_ID } from '../shared/auditoria';
import { registrarAuditoria } from '../shared/logAuditoria';

/** `ahora` es inyectable para testear los bordes del día sin depender del reloj real. */
export async function transicionarEstadosCampanias(
  ahora = new Date(),
): Promise<{ activadas: number; finalizadas: number }> {
  const estados = await idsEstadosCampania();
  const campanias = await repo.listarVigentesParaCron();
  const resumen = await repo.resumirDonaciones(campanias.map((campania) => campania.id));

  let activadas = 0;
  let finalizadas = 0;

  for (const campania of campanias) {
    const desde = campania.estadoCampania.nombre as NombreEstadoCampania;
    const recaudado = resumen.get(campania.id)?.recaudado ?? 0;
    const hacia = siguienteEstadoAutomatico(
      {
        estado: desde,
        fechaInicio: campania.fechaInicio,
        fechaFin: campania.fechaFin,
        objetivo: Number(campania.objetivo),
        recaudado,
      },
      ahora,
    );
    if (!hacia) continue;

    const cambio = await repo.cambiarEstadoSi(
      campania.id,
      estados[desde],
      estados[hacia],
      USUARIO_SISTEMA_ID,
    );
    // Si un miembro la finalizó o canceló un instante antes, lo suyo es lo que vale: es la
    // carrera esperada, no un error.
    if (!cambio) continue;

    if (hacia === ESTADO_CAMPANIA.ACTIVA) activadas++;
    else finalizadas++;

    await registrarAuditoria({
      usuarioId: USUARIO_SISTEMA_ID,
      accion: 'CAMBIAR_ESTADO',
      entidad: 'Campania',
      entidadId: campania.id,
      detalle: `${desde} -> ${hacia} (cron, recaudado=${recaudado})`,
    });
  }

  return { activadas, finalizadas };
}

if (require.main === module) {
  transicionarEstadosCampanias()
    .then(({ activadas, finalizadas }) => {
      console.log(
        `✅ transicion-estados-campana: ${activadas} activada(s), ${finalizadas} finalizada(s).`,
      );
      process.exit(0);
    })
    .catch((err) => {
      console.error('❌ Error en transicion-estados-campana:', err);
      process.exit(1);
    });
}
