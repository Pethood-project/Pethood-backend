import { randomBytes } from 'node:crypto';
import { OAuth2Client } from 'google-auth-library';
import { env } from '../../config/env';
import { AppError } from '../../middlewares/errorHandler';

export interface PerfilGoogle {
  googleId: string;
  email: string;
  nombre: string;
  apellido: string;
  imagenUrl?: string;
}

const ESTADOS_OAUTH_TTL_MS = 10 * 60 * 1000;
// `soloPanel`: el login nació en el panel web, que no crea cuentas (ver `loginConGoogle`).
// `nonce`: lo genera el panel y lo guarda en una cookie; ata el flujo a ese navegador.
interface EstadoPendiente {
  vence: number;
  soloPanel: boolean;
  nonce?: string;
}
const estadosPendientes = new Map<string, EstadoPendiente>();

function exigirClientIdGoogle(): string {
  if (!env.GOOGLE_CLIENT_ID) {
    throw new AppError(
      'GOOGLE_NO_CONFIGURADO',
      'El login con Google todavía no está configurado en el servidor.',
      503,
    );
  }
  return env.GOOGLE_CLIENT_ID;
}

function exigirConfigOAuthWeb(): { clientId: string; clientSecret: string; redirectUri: string } {
  const clientId = exigirClientIdGoogle();
  const clientSecret = env.GOOGLE_CLIENT_SECRET;
  const redirectUri = env.GOOGLE_REDIRECT_URI;

  if (!clientSecret || !redirectUri) {
    throw new AppError(
      'GOOGLE_NO_CONFIGURADO',
      'El login con Google todavía no está configurado en el servidor.',
      503,
    );
  }

  return { clientId, clientSecret, redirectUri };
}

function clienteOAuth(): OAuth2Client {
  const { clientId, clientSecret, redirectUri } = exigirConfigOAuthWeb();
  return new OAuth2Client(clientId, clientSecret, redirectUri);
}

function mapearPerfil(payload: {
  sub?: string;
  email?: string;
  given_name?: string;
  family_name?: string;
  name?: string;
  picture?: string;
  email_verified?: boolean;
}): PerfilGoogle {
  if (!payload.sub || !payload.email) {
    throw new AppError('CREDENCIALES_INVALIDAS', 'No pudimos validar tu cuenta de Google.', 401);
  }

  if (payload.email_verified === false) {
    throw new AppError(
      'CREDENCIALES_INVALIDAS',
      'Tu correo de Google no está verificado. Verificalo e intentalo de nuevo.',
      401,
    );
  }

  const local = payload.email.split('@')[0] ?? 'Usuario';
  const nombre = payload.given_name?.trim() || payload.name?.trim() || local;
  const apellido = payload.family_name?.trim() || 'Google';

  return {
    googleId: payload.sub,
    email: payload.email.toLowerCase(),
    nombre,
    apellido,
    imagenUrl: payload.picture,
  };
}

export function googleEstaConfigurado(): boolean {
  return Boolean(env.GOOGLE_CLIENT_ID);
}

export function crearUrlAutorizacionGoogle(soloPanel = false, nonce?: string): string {
  const client = clienteOAuth();
  const state = randomBytes(24).toString('hex');
  estadosPendientes.set(state, { vence: Date.now() + ESTADOS_OAUTH_TTL_MS, soloPanel, nonce });

  return client.generateAuthUrl({
    access_type: 'online',
    prompt: 'select_account',
    scope: ['openid', 'email', 'profile'],
    state,
  });
}

export function validarStateOAuth(state: string | undefined): {
  soloPanel: boolean;
  nonce?: string;
} {
  if (!state) {
    throw new AppError('VALIDACION', 'Falta el parámetro state de Google.', 400);
  }

  const pendiente = estadosPendientes.get(state);
  estadosPendientes.delete(state);

  if (!pendiente || Date.now() > pendiente.vence) {
    throw new AppError('VALIDACION', 'El login con Google expiró. Volvé a intentarlo.', 400);
  }

  return { soloPanel: pendiente.soloPanel, nonce: pendiente.nonce };
}

export async function verificarIdTokenGoogle(idToken: string): Promise<PerfilGoogle> {
  const clientId = exigirClientIdGoogle();
  const client = new OAuth2Client(clientId);

  try {
    const ticket = await client.verifyIdToken({ idToken, audience: clientId });
    return mapearPerfil(ticket.getPayload() ?? {});
  } catch (error) {
    if (error instanceof AppError) throw error;
    console.error('Google: falló verifyIdToken', error);
    throw new AppError('CREDENCIALES_INVALIDAS', 'No pudimos validar tu cuenta de Google.', 401);
  }
}

export async function intercambiarCodigoGoogle(code: string): Promise<PerfilGoogle> {
  const client = clienteOAuth();

  try {
    const { tokens } = await client.getToken(code);
    if (!tokens.id_token) {
      throw new AppError(
        'CREDENCIALES_INVALIDAS',
        'Google no devolvió un token de identidad.',
        401,
      );
    }
    return verificarIdTokenGoogle(tokens.id_token);
  } catch (error) {
    if (error instanceof AppError) throw error;
    console.error('Google: falló el intercambio del code (getToken)', error);
    throw new AppError('CREDENCIALES_INVALIDAS', 'No pudimos completar el login con Google.', 401);
  }
}
