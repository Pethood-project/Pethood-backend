/**
 * Spec 027 §6.5 y §6.8: cada 5 minutos, renueva los tokens de Mercado Pago que vencen pronto y
 * reintenta confirmar las donaciones Pendientes de refugios vinculados (usuario SISTEMA).
 *
 * Función pura + entrypoint CLI, como los otros jobs. Crontab:
 *   *\/5 * * * * cd /ruta/al/repo && node dist/jobs/conciliar-donaciones-mp.job.js
 */
import * as campaniasRepo from '../modules/campanias/campanias.repository';
import { conciliarGrupo } from '../modules/campanias/campanias.service';
import { VENTANA_DESPUES_MS } from '../modules/campanias/campanias.conciliacion';
import * as mpService from '../modules/mercadopago/mercadopago.service';

export async function conciliarDonacionesMp(
  ahora = new Date(),
): Promise<{ renovados: number; confirmadas: number }> {
  if (!mpService.disponible()) return { renovados: 0, confirmadas: 0 };

  const renovados = await mpService.renovarTokensPorVencer(ahora);
  const grupos = await campaniasRepo.gruposConciliables(
    new Date(ahora.getTime() - VENTANA_DESPUES_MS),
  );

  let confirmadas = 0;
  for (const grupo of grupos) {
    try {
      // Sin apuro: el tope de 5 s es para el pedido del usuario; acá se espera más.
      confirmadas += await conciliarGrupo(grupo, ahora, 15000);
    } catch {
      // Un grupo con problemas no frena a los demás.
    }
  }

  return { renovados, confirmadas };
}

if (require.main === module) {
  conciliarDonacionesMp()
    .then(({ renovados, confirmadas }) => {
      console.log(
        `✅ conciliar-donaciones-mp: ${confirmadas} confirmada(s), ${renovados} token(s) renovado(s).`,
      );
      process.exit(0);
    })
    .catch((err) => {
      console.error('❌ Error en conciliar-donaciones-mp:', err);
      process.exit(1);
    });
}
