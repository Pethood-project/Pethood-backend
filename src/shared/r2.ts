import { randomUUID } from 'node:crypto';
import { DeleteObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { env } from '../config/env';
import { AppError } from '../middlewares/errorHandler';
import { extensionPara } from './extensiones';

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
 * Sube un archivo a Cloudflare R2 y devuelve la URL pública.
 * En la base solo se persiste ese link, nunca el archivo.
 *
 * `carpeta` es el prefijo de la key (`perfiles`, `chats`, `mascotas`…): el mismo valor que
 * `storage.ts` usa como subcarpeta en disco, para que las dos formas de persistir organicen
 * los archivos igual.
 *
 * El `immutable` del cache vale porque el nombre es un UUID: un archivo nunca se pisa, se
 * sube uno nuevo.
 */
export async function subirArchivo(archivo: ArchivoSubida, carpeta: string): Promise<string> {
  const config = exigirConfigR2();
  const key = `${carpeta}/${randomUUID()}.${extensionPara(archivo.mimetype)}`;

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

/**
 * La foto de perfil, que es el único caller histórico de R2. Se conserva con su nombre para
 * no tocar `auth.service` ni sus tests, que mockean esta función.
 */
export function subirImagenPerfil(archivo: ArchivoSubida): Promise<string> {
  return subirArchivo(archivo, 'perfiles');
}

/**
 * `true` si esa URL es de NUESTRO bucket. Sirve para decidir dónde borrar: después de la
 * migración la base tiene URLs de las dos épocas conviviendo — relativas a disco las viejas,
 * absolutas a R2 las nuevas— y hay que mandar cada una a su lado.
 */
export function esUrlDeR2(url: string): boolean {
  const config = configR2Desde(env);
  return config !== undefined && url.startsWith(`${config.publicBaseUrl}/`);
}

/**
 * Borra un objeto del bucket a partir de su URL pública. **No lanza**: se usa para compensar
 * una escritura en base que falló, y ahí el error que importa es el original, no este.
 */
export async function borrarArchivo(urlPublica: string): Promise<void> {
  const config = configR2Desde(env);
  if (!config || !urlPublica.startsWith(`${config.publicBaseUrl}/`)) return;

  const key = urlPublica.slice(config.publicBaseUrl.length + 1);
  if (!key) return;

  try {
    await clienteR2(config).send(new DeleteObjectCommand({ Bucket: config.bucket, Key: key }));
  } catch {
    // Queda un objeto huérfano en el bucket. Es preferible a tapar el error de arriba.
  }
}
