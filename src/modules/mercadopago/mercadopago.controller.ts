import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../../middlewares/errorHandler';
import * as service from './mercadopago.service';

export async function estado(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res.json(await service.obtenerEstado(req.usuario!.usuarioId));
  } catch (err) {
    next(err);
  }
}

export async function iniciar(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res.json(await service.iniciarVinculacion(req.usuario!.usuarioId));
  } catch (err) {
    next(err);
  }
}

export async function desvincular(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    await service.desvincular(req.usuario!.usuarioId);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
}

/** Página mínima para el navegador del teléfono: textos fijos, nada que venga del pedido. */
function pagina(titulo: string, mensaje: string): string {
  return `<!doctype html><html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>PetHood</title>
<style>body{font-family:system-ui,sans-serif;background:#FFF5ED;color:#2e2b25;display:flex;
min-height:100vh;align-items:center;justify-content:center;margin:0;padding:24px;text-align:center}
h1{color:#FF8A3D;font-size:22px}</style></head>
<body><main><h1>${titulo}</h1><p>${mensaje}</p></main></body></html>`;
}

/** Retorno de Mercado Pago (spec 027 §4). Responde HTML: lo abre el navegador, no la app. */
export async function callback(req: Request, res: Response): Promise<void> {
  const { code, state } = req.query;
  try {
    await service.completarVinculacion(
      typeof code === 'string' ? code : undefined,
      typeof state === 'string' ? state : undefined,
    );
    res
      .type('html')
      .send(pagina('¡Listo!', 'Listo, ya vinculaste Mercado Pago. Podés volver a PetHood.'));
  } catch (err) {
    const mensaje =
      err instanceof AppError
        ? err.mensaje
        : 'No pudimos vincular Mercado Pago. Volvé a intentarlo desde la app.';
    res
      .status(err instanceof AppError ? err.httpStatus : 500)
      .type('html')
      .send(pagina('No se pudo vincular', mensaje));
  }
}
