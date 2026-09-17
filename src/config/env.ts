import 'dotenv/config';
import { z } from 'zod';

const emptyToUndefined = (value: unknown) => (value === '' ? undefined : value);

const toBoolean = (value: unknown): boolean => {
  if (value === true || value === false) return value;
  if (typeof value === 'string') {
    const normalizado = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'on'].includes(normalizado)) return true;
    if (['false', '0', 'no', 'off', ''].includes(normalizado)) return false;
  }
  return false;
};

const envSchema = z.object({
  DATABASE_URL: z.string().url(),
  PORT: z.coerce.number().default(3000),
  JWT_SECRET: z.string().min(16, 'JWT_SECRET debe tener al menos 16 caracteres'),
  JWT_EXPIRES_IN: z.string().default('7d'),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  GOOGLE_CLIENT_ID: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
  GOOGLE_CLIENT_SECRET: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
  GOOGLE_REDIRECT_URI: z.preprocess(emptyToUndefined, z.string().url().optional()),
  FRONTEND_WEB_URL: z.string().url().default('http://localhost:3001'),
  // Cloudflare R2: con R2_ENABLED=false el registro ignora la foto y no usa R2.
  // Con R2_ENABLED=true se exige el resto de keys; la foto se sube y se guarda el link.
  R2_ENABLED: z.preprocess(toBoolean, z.boolean()),
  R2_ACCOUNT_ID: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
  R2_ACCESS_KEY_ID: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
  R2_SECRET_ACCESS_KEY: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
  R2_BUCKET_NAME: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
  R2_PUBLIC_BASE_URL: z.preprocess(emptyToUndefined, z.string().url().optional()),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('❌ Variables de entorno inválidas:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
