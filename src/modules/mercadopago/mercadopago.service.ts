/**
 * Conexión de cada refugio con su cuenta de Mercado Pago (spec 027): vincular por OAuth con
 * PKCE, desvincular, dar el token vigente para conciliar y renovarlo antes de que venza.
 */
import { env } from '../../config/env';
import { AppError } from '../../middlewares/errorHandler';
import { USUARIO_SISTEMA_ID } from '../../shared/auditoria';
import { cifrar, descifrar } from '../../shared/cifrado';
import { registrarAuditoria } from '../../shared/logAuditoria';
import * as cliente from './mercadopago.cliente';
import { firmarEstado, generarPkce, leerEstado, secretoDelState } from './mercadopago.oauth';
import * as repo from './mercadopago.repository';

/** Renovar los tokens que vencen antes de esto (duran 180 días). */
const MARGEN_RENOVACION_MS = 30 * 24 * 60 * 60 * 1000;

export interface EstadoConexionDto {
  disponible: boolean;
  estado: 'NO_VINCULADA' | 'VINCULADA' | 'REVINCULAR';
  fechaVinculacion: string | null;
}

function config() {
  const { MP_CLIENT_ID, MP_CLIENT_SECRET, MP_REDIRECT_URI, MP_CLAVE_CIFRADO } = env;
  if (!MP_CLIENT_ID || !MP_CLIENT_SECRET || !MP_REDIRECT_URI || !MP_CLAVE_CIFRADO) return null;
  return {
    clientId: MP_CLIENT_ID,
    clientSecret: MP_CLIENT_SECRET,
    redirectUri: MP_REDIRECT_URI,
    clave: MP_CLAVE_CIFRADO,
  };
}

/** Sin configuración el módulo queda apagado y todo sigue manual (spec 027 §3). */
export function disponible(): boolean {
  return config() !== null;
}

function exigirConfig() {
  const c = config();
  if (!c) {
    throw new AppError('MP_NO_DISPONIBLE', 'La conexión con Mercado Pago no está disponible.', 503);
  }
  return c;
}

async function refugioDe(usuarioId: number): Promise<number> {
  const usuario = await repo.buscarRefugioDeUsuario(usuarioId);
  if (!usuario?.refugioId) {
    throw new AppError('SIN_REFUGIO', 'Tu usuario no está asociado a ningún refugio', 403);
  }
  return usuario.refugioId;
}

export async function obtenerEstado(usuarioId: number): Promise<EstadoConexionDto> {
  const refugioId = await refugioDe(usuarioId);
  const conexion = await repo.buscarConexion(refugioId);

  return {
    disponible: disponible(),
    estado: conexion ? (conexion.estado as 'VINCULADA' | 'REVINCULAR') : 'NO_VINCULADA',
    fechaVinculacion: conexion?.fechaAlta.toISOString() ?? null,
  };
}

export async function iniciarVinculacion(usuarioId: number): Promise<{ url: string }> {
  const c = exigirConfig();
  const refugioId = await refugioDe(usuarioId);
  const { verificador, desafio } = generarPkce();
  const state = firmarEstado(
    { refugioId, usuarioId, verificador },
    secretoDelState(c.clave),
    c.clave,
  );

  return {
    url: cliente.urlAutorizacion({
      clientId: c.clientId,
      redirectUri: c.redirectUri,
      state,
      codeChallenge: desafio,
    }),
  };
}

function vinculacionInvalida(): AppError {
  return new AppError(
    'VINCULACION_INVALIDA',
    'El enlace de vinculación venció o no es válido. Volvé a intentarlo desde la app.',
    400,
  );
}

/** El callback: el refugio sale del `state` firmado, nunca de un parámetro suelto. */
export async function completarVinculacion(
  code: string | undefined,
  state: string | undefined,
): Promise<void> {
  const c = exigirConfig();
  if (!code || !state) throw vinculacionInvalida();

  let estado;
  try {
    estado = leerEstado(state, secretoDelState(c.clave), c.clave);
  } catch {
    throw vinculacionInvalida();
  }

  let tokens: cliente.TokensMp;
  try {
    tokens = await cliente.canjearCodigo({
      clientId: c.clientId,
      clientSecret: c.clientSecret,
      code,
      redirectUri: c.redirectUri,
      codeVerifier: estado.verificador,
    });
  } catch {
    throw vinculacionInvalida();
  }

  await repo.guardarConexion(
    estado.refugioId,
    {
      mpUserId: tokens.mpUserId,
      accessToken: cifrar(tokens.accessToken, c.clave),
      refreshToken: cifrar(tokens.refreshToken, c.clave),
      vence: tokens.vence,
    },
    estado.usuarioId,
  );

  await registrarAuditoria({
    usuarioId: estado.usuarioId,
    accion: 'VINCULAR',
    entidad: 'ConexionMercadoPago',
    entidadId: estado.refugioId,
    detalle: `mpUserId=${tokens.mpUserId}`,
  });
}

export async function desvincular(usuarioId: number): Promise<void> {
  const refugioId = await refugioDe(usuarioId);
  if (!(await repo.darDeBaja(refugioId, usuarioId))) return;

  await registrarAuditoria({
    usuarioId,
    accion: 'DESVINCULAR',
    entidad: 'ConexionMercadoPago',
    entidadId: refugioId,
  });
}

/** Token vigente para conciliar, o `null` si el refugio no puede confirmar solo. */
export async function tokenDeRefugio(refugioId: number): Promise<string | null> {
  const c = config();
  if (!c) return null;

  const conexion = await repo.buscarConexion(refugioId);
  if (!conexion || conexion.estado !== repo.ESTADO_CONEXION.VINCULADA) return null;

  return descifrar(conexion.accessToken, c.clave);
}

/** Mercado Pago rechazó el token: hay que volver a vincular, y mientras tanto todo es manual. */
export async function marcarTokenInvalido(refugioId: number): Promise<void> {
  const conexion = await repo.buscarConexion(refugioId);
  if (!conexion) return;
  await repo.marcarRevincular(conexion.id, USUARIO_SISTEMA_ID);
}

export async function renovarTokensPorVencer(ahora = new Date()): Promise<number> {
  const c = config();
  if (!c) return 0;

  let renovados = 0;
  for (const conexion of await repo.listarPorVencer(
    new Date(ahora.getTime() + MARGEN_RENOVACION_MS),
  )) {
    let tokens: cliente.TokensMp;
    try {
      tokens = await cliente.renovarToken({
        clientId: c.clientId,
        clientSecret: c.clientSecret,
        refreshToken: descifrar(conexion.refreshToken, c.clave),
      });
    } catch (err) {
      // Sólo si Mercado Pago rechazó el refresh hay que revincular. Una caída o un timeout se
      // reintentan en la próxima corrida: hay 30 días de margen antes de que venza.
      if (err instanceof cliente.TokenMercadoPagoInvalido) {
        await repo.marcarRevincular(conexion.id, USUARIO_SISTEMA_ID);
      }
      continue;
    }

    try {
      await repo.actualizarTokens(
        conexion.id,
        {
          accessToken: cifrar(tokens.accessToken, c.clave),
          refreshToken: cifrar(tokens.refreshToken, c.clave),
          vence: tokens.vence,
        },
        USUARIO_SISTEMA_ID,
      );
      renovados++;
    } catch {
      // El refresh viejo ya no sirve (Mercado Pago lo rota) y el nuevo no se guardó.
      await repo.marcarRevincular(conexion.id, USUARIO_SISTEMA_ID);
    }
  }
  return renovados;
}
