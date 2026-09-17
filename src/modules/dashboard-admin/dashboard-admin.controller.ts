import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../../middlewares/errorHandler';
import { filaCsv } from '../../shared/csv';
import { entidadExportSchema } from './dashboard-admin.dto';
import * as service from './dashboard-admin.service';

export async function obtener(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res.json(await service.obtenerDashboard());
  } catch (err) {
    next(err);
  }
}

export async function exportar(req: Request, res: Response, next: NextFunction): Promise<void> {
  const resultado = entidadExportSchema.safeParse(req.params.entidad);

  if (!resultado.success) {
    next(new AppError('ENTIDAD_INVALIDA', 'La entidad a exportar no es válida', 400));
    return;
  }

  const { headers, filas } = service.exportarEntidad(resultado.data);

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${resultado.data}.csv"`);

  try {
    res.write(filaCsv(headers));
    for await (const fila of filas()) {
      res.write(filaCsv(fila));
    }
    res.end();
  } catch (err) {
    // El body ya empezó a viajar: no se puede volver a un 500 JSON, solo cortar la conexión.
    console.error('Error exportando CSV:', err);
    res.end();
  }
}
