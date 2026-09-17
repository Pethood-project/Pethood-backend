import { randomUUID } from 'node:crypto';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { env } from '../config/env';
import { AppError } from '../middlewares/errorHandler';

const MIME_A_EXTENSION: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

export interface ArchivoSubida {
  buffer: Buffer;
  mimetype: string;
}

export interface ConfigR2 {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  publicBaseUrl: string;
}

let cliente: S3Client | undefined;

export function r2Habilitado(): boolean {
  return env.R2_ENABLED;
}

export function configR2Desde(valores: {
  R2_ACCOUNT_ID?: string;
  R2_ACCESS_KEY_ID?: string;
  R2_SECRET_ACCESS_KEY?: string;
  R2_BUCKET_NAME?: string;
  R2_PUBLIC_BASE_URL?: string;
}): ConfigR2 | undefined {
  const accountId = valores.R2_ACCOUNT_ID?.trim();
  const accessKeyId = valores.R2_ACCESS_KEY_ID?.trim();
  const secretAccessKey = valores.R2_SECRET_ACCESS_KEY?.trim();
  const bucket = valores.R2_BUCKET_NAME?.trim();
  const publicBaseUrl = valores.R2_PUBLIC_BASE_URL?.trim().replace(/\/$/, '');

  if (!accountId || !accessKeyId || !secretAccessKey || !bucket || !publicBaseUrl) {
    return undefined;
  }

  return { accountId, accessKeyId, secretAccessKey, bucket, publicBaseUrl };
}

function exigirConfigR2(): ConfigR2 {
  const config = configR2Desde(env);
  if (!config) {
    throw new AppError(
      'R2_NO_CONFIGURADO',
      'El almacenamiento de imágenes todavía no está configurado en el servidor.',
      503,
    );
  }
  return config;
}

function clienteR2(config: ConfigR2): S3Client {
  if (!cliente) {
    cliente = new S3Client({
      region: 'auto',
      endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    });
  }
  return cliente;
}

/**
 * Sube una imagen a Cloudflare R2 y devuelve la URL pública.
 * En la base solo se persiste ese link (`usuario_imagen_url`), nunca el archivo.
 */
export async function subirImagenPerfil(archivo: ArchivoSubida): Promise<string> {
  const config = exigirConfigR2();
  const extension = MIME_A_EXTENSION[archivo.mimetype] ?? 'jpg';
  const key = `perfiles/${randomUUID()}.${extension}`;

  await clienteR2(config).send(
    new PutObjectCommand({
      Bucket: config.bucket,
      Key: key,
      Body: archivo.buffer,
      ContentType: archivo.mimetype,
      CacheControl: 'public, max-age=31536000, immutable',
    }),
  );

  return `${config.publicBaseUrl}/${key}`;
}
