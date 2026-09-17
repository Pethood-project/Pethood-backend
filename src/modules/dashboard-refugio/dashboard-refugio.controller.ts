import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../../middlewares/errorHandler';
import { filaCsv } from '../../shared/csv';
import { entidadExportRefugioSchema, periodoDashboardSchema } from './dashboard-refugio.dto';
import * as service from './dashboard-refugio.service';

function parsearPeriodo(req: Request) {
  const resultado = periodoDashboardSchema.safeParse(req.query);

  if (!resultado.success) {
    throw new AppError(
      'PERIODO_INVALIDO',
      resultado.error.issues[0]?.message ?? 'El período solicitado no es válido',
      400,
    );
  }

  return resultado.data;
}

export async function obtener(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const periodo = parsearPeriodo(req);
    res.json(await service.obtenerDashboard(req.usuario!.usuarioId, periodo));
  } catch (err) {
    next(err);
  }
}

export async function exportar(req: Request, res: Response, next: NextFunction): Promise<void> {
  const resultadoEntidad = entidadExportRefugioSchema.safeParse(req.params.entidad);

  if (!resultadoEntidad.success) {
    next(new AppError('ENTIDAD_INVALIDA', 'La entidad a exportar no es válida', 400));
    return;
  }

  try {
    const periodo = parsearPeriodo(req);
    const { headers, filas } = await service.prepararExportEntidad(
      req.usuario!.usuarioId,
      resultadoEntidad.data,
      periodo,
    );

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${resultadoEntidad.data}-refugio-${periodo.desde}_a_${periodo.hasta}.csv"`,
    );

    res.write(filaCsv(headers));
    for await (const fila of filas()) {
      res.write(filaCsv(fila));
    }
    res.end();
  } catch (err) {
    if (res.headersSent) {
      // El body ya empezó a viajar: no se puede volver a un 500 JSON, solo cortar la conexión.
      console.error('Error exportando CSV de dashboard-refugio:', err);
      res.end();
      return;
    }
    next(err);
  }
}
