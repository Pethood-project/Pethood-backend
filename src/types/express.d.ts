import type { Ambito } from '../shared/ambito';
import type { PayloadToken } from '../shared/jwt';

declare global {
  namespace Express {
    interface Request {
      usuario?: PayloadToken;
      /** Perfil con el que actúa en este pedido (ver `shared/ambito.ts`). Lo setea `autenticar`. */
      ambito?: Ambito;
    }
  }
}

export {};
