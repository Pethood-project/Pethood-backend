import express from 'express';
import cors from 'cors';
import { apiRouter } from './routes';
import { errorHandler } from './middlewares/errorHandler';
import { env } from './config/env';
import { DIRECTORIO_UPLOADS, RUTA_PUBLICA_ARCHIVOS } from './shared/storage';
import { esRutaPrivada, verificarFirma } from './shared/urlFirmada';

export const app = express();

app.set('trust proxy', env.TRUST_PROXY);

app.use(cors());
app.use(express.json());

// Archivos subidos (fotos de mascotas, etc.). Va antes del router para que no lo
// intercepte el 404 de la API.
//
// Las subcarpetas privadas —adjuntos de chat, historia clínica, seguimiento— exigen la firma
// que emiten los DTOs; el resto (mascotas, publicaciones, perfiles) sigue siendo público
// porque se muestra en el feed de adopción. La autorización va en la URL y no en un header
// porque el `<Image>` de React Native no manda `Authorization` — ver `shared/urlFirmada.ts`.
app.use(RUTA_PUBLICA_ARCHIVOS, (req, res, next) => {
  if (!esRutaPrivada(req.path)) {
    next();
    return;
  }

  if (verificarFirma(req.path, req.query.exp, req.query.sig)) {
    next();
    return;
  }

  res.status(403).json({
    error: {
      codigo: 'ARCHIVO_NO_AUTORIZADO',
      mensaje: 'El enlace no es válido o venció. Volvé a abrir la pantalla.',
    },
  });
});

app.use(RUTA_PUBLICA_ARCHIVOS, express.static(DIRECTORIO_UPLOADS));

app.use('/api/v1', apiRouter);

// 404 uniforme
app.use((_req, res) => {
  res.status(404).json({ error: { codigo: 'NO_ENCONTRADO', mensaje: 'Recurso inexistente' } });
});

// Manejo central de errores (siempre al final)
app.use(errorHandler);
