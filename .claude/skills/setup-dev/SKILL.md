---
name: setup-dev
description: Levantar el entorno completo de desarrollo de PetHood desde cero (PostgreSQL en Docker, este backend Express puerto 3000, app mobile Expo, panel web-admin Next.js puerto 3001, seed y login admin): usar ante errores de conexión a la BD, puertos ocupados, ECONNREFUSED, o setup inicial del equipo.
---

# Setup del entorno de desarrollo

Orden de levantado completo. El **backend corre en el puerto 3000** (`.env` → `PORT=3000`) y es
donde apuntan mobile y web-admin (`EXPO_PUBLIC_API_URL` / `NEXT_PUBLIC_API_URL`). El panel
web-admin corre en **3001**.

## 1. Base de datos (PostgreSQL en Docker)

```bash
docker compose up -d        # contenedor pethood-db (desde la raíz de este repo)
docker ps | grep pethood-db # verificar que esté Up
```

Si `docker-compose.override.yml` existe, el contenedor se expone en el **5433** del host (para
convivir con un PostgreSQL nativo en 5432). `DATABASE_URL` en `.env` tiene que apuntar al
puerto que corresponda.

## 2. Backend (Express + Prisma)

```bash
npm install
[ -f .env ] || cp .env.example .env   # verificar PORT=3000 y el puerto de DATABASE_URL
npx prisma migrate dev                # aplica migraciones y genera el cliente
npm run seed                          # catálogos + datos de demo de TODA la app (ver README § Seed)
npm run dev                           # tsx watch, escucha en http://localhost:3000
curl http://localhost:3000/api/v1/health  # {"ok":true,...} = listo
```

`npm run seed` es único e idempotente: cubre usuarios, refugios, mascotas, publicaciones,
favoritos, solicitudes, seguimientos, chats, campañas, reseñas, moderación y animales perdidos.
Cuentas: `adoptante@` (Ana), `refugio@` (Bruno, Patitas), `admin@pethood.test` — contraseña
`Pethood123`.

## 3. App mobile (Expo) — repo hermano del frontend

Requiere **Node 22 LTS** fijado en `.nvmrc`; solo npm (nunca yarn/pnpm/bun):

```bash
cd apps/mobile         # dentro del repo hermano
npm ci
npx expo-doctor        # chequeo de entorno
npx expo start --clear # abrir con Expo Go en el celular o emulador
```

## 4. Panel web-admin (Next.js) — repo hermano del frontend

```bash
cd apps/web-admin      # dentro del repo hermano
npm install
[ -f .env.local ] || cp .env.example .env.local   # NEXT_PUBLIC_API_URL=http://localhost:3000/api/v1
npm run dev            # http://localhost:3001 (el script ya fija -p 3001)
```

## 5. Login en web-admin

Entrar en `http://localhost:3001` con `admin@pethood.test` / `Pethood123` (panel admin) o con
`refugio@pethood.test` / `Pethood123` (dashboard refugio).

## Diagnóstico rápido

| Síntoma | Causa típica |
|---|---|
| `ECONNREFUSED 127.0.0.1:5432` / `5433` | Contenedor DB caído → paso 1, o `DATABASE_URL` apunta al puerto equivocado |
| `EADDRINUSE :3000` | El backend ya está corriendo, o web-admin arrancó sin `-p 3001` |
| `P1001: can't reach database` | DB levantada pero migraciones no aplicadas → paso 2 |
| Web-admin no loguea | Backend apagado, o `NEXT_PUBLIC_API_URL` no apunta a `:3000/api/v1` |
| Expo no arranca | Node ≠ 22 LTS → `node -v`, usar mise/nvm |
