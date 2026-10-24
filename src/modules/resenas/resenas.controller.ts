import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../../middlewares/errorHandler';
import { parsearId } from '../../shared/validation/numbers';
import { historialResenasQuerySchema, type CrearResenaDto } from './resenas.dto';
import * as service from './resenas.service';

/** Los ids de las FK viajan en la URL, así que no los cubre ningún schema de body. */
function idDeRuta(req: Request, campo: string): number {
  const id = parsearId(req.params[campo]);

  if (id === null) {
    throw new AppError('VALIDACION', 'El id no es válido', 400);
  }

  return id;
}

/**
 * Valida `limite` y `cursor` de la query. `null` si no vino ninguno de los dos: ahí el
 * historial se devuelve completo y sin paginar.
 */
function paginaDeQuery(req: Request): { limite: number; cursor?: number } | null {
  if (req.query.limite === undefined && req.query.cursor === undefined) return null;

  const resultado = historialResenasQuerySchema.safeParse(req.query);

  if (!resultado.success) {
    throw new AppError('VALIDACION', resultado.error.issues[0]?.message ?? 'Datos inválidos', 400);
  }

  return resultado.data;
}

/** HU-10.1: el usuario registra la reseña de una transacción concretada. */
export async function crear(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const datos = req.body as CrearResenaDto;
    res.status(201).json(await service.crearResena(datos, req.usuario!.usuarioId));
  } catch (err) {
    next(err);
  }
}

/**
 * HU-10.5: historial y promedio de una persona. Con `limite` o `cursor` en la query responde
 * una página por cursor; sin ellos, todas (comportamiento previo, que usa web-admin).
 */
export async function deUsuario(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const usuarioId = idDeRuta(req, 'usuarioId');
    const pagina = paginaDeQuery(req);

    res.json(
      pagina
        ? await service.listarPaginaDeUsuario(usuarioId, pagina.limite, pagina.cursor)
        : await service.listarDeUsuario(usuarioId),
    );
  } catch (err) {
    next(err);
  }
}

/** HU-10.5: historial y promedio de un refugio, con la misma paginación opcional. */
export async function deRefugio(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const refugioId = idDeRuta(req, 'refugioId');
    const pagina = paginaDeQuery(req);

    res.json(
      pagina
        ? await service.listarPaginaDeRefugio(refugioId, pagina.limite, pagina.cursor)
        : await service.listarDeRefugio(refugioId),
    );
  } catch (err) {
    next(err);
  }
}

/** Transacciones concretadas que el usuario todavía no reseñó, según el perfil activo. */
export async function elegibles(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res.json(await service.listarElegibles(req.usuario!.usuarioId));
  } catch (err) {
    next(err);
  }
}

/** HU-10.6: baja lógica de una reseña (solo administradores). */
export async function darDeBaja(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    await service.darDeBaja(idDeRuta(req, 'id'), req.usuario!.usuarioId);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}
