import { beforeEach, describe, expect, it, vi } from 'vitest';

const { verifyIdToken, envMock } = vi.hoisted(() => ({
  verifyIdToken: vi.fn(),
  envMock: {} as { GOOGLE_CLIENT_ID?: string; GOOGLE_ANDROID_CLIENT_ID?: string },
}));

vi.mock('google-auth-library', () => ({
  OAuth2Client: class {
    verifyIdToken = verifyIdToken;
  },
}));

vi.mock('../../../../src/config/env', () => ({ env: envMock }));

import { verificarIdTokenGoogle } from '../../../../src/modules/auth/auth.google';

const payload = {
  sub: 'google-123',
  email: 'ana@gmail.com',
  given_name: 'Ana',
  family_name: 'Gomez',
};

describe('verificarIdTokenGoogle', () => {
  beforeEach(() => {
    verifyIdToken.mockReset();
    envMock.GOOGLE_CLIENT_ID = 'web-id';
    envMock.GOOGLE_ANDROID_CLIENT_ID = undefined;
  });

  it('sin client ID de Android valida solo contra el de tipo web', async () => {
    verifyIdToken.mockResolvedValue({ getPayload: () => payload });

    await verificarIdTokenGoogle('token');

    expect(verifyIdToken).toHaveBeenCalledWith({ idToken: 'token', audience: ['web-id'] });
  });

  it('con client ID de Android acepta tokens de las dos audiencias', async () => {
    envMock.GOOGLE_ANDROID_CLIENT_ID = 'android-id';
    verifyIdToken.mockResolvedValue({ getPayload: () => payload });

    const perfil = await verificarIdTokenGoogle('token');

    expect(verifyIdToken).toHaveBeenCalledWith({
      idToken: 'token',
      audience: ['web-id', 'android-id'],
    });
    expect(perfil.googleId).toBe('google-123');
  });

  it('un token que Google rechaza responde 401', async () => {
    verifyIdToken.mockRejectedValue(
      new Error('Wrong recipient, payload audience != requiredAudience'),
    );

    await expect(verificarIdTokenGoogle('token')).rejects.toMatchObject({ httpStatus: 401 });
  });

  it('sin GOOGLE_CLIENT_ID responde 503', async () => {
    envMock.GOOGLE_CLIENT_ID = undefined;

    await expect(verificarIdTokenGoogle('token')).rejects.toMatchObject({ httpStatus: 503 });
  });
});
