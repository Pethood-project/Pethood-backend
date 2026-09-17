import express from 'express';
import cors from 'cors';
import { apiRouter } from './routes';
import { errorHandler } from './middlewares/errorHandler';
import { DIRECTORIO_UPLOADS, RUTA_PUBLICA_ARCHIVOS } from './shared/storage';

export const app = express();

app.use(cors());
app.use(express.json());

// Archivos subidos (fotos de mascotas, etc.). Va antes del router para que no lo
// intercepte el 404 de la API.
app.use(RUTA_PUBLICA_ARCHIVOS, express.static(DIRECTORIO_UPLOADS));

app.use('/api/v1', apiRouter);

// 404 uniforme
app.use((_req, res) => {
  res.status(404).json({ error: { codigo: 'NO_ENCONTRADO', mensaje: 'Recurso inexistente' } });
});

// Manejo central de errores (siempre al final)
app.use(errorHandler);
