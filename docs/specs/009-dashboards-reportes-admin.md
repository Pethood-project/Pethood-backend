# Spec 009 — Dashboards y Reportes (Admin)

**Estado:** APROBADA
**Sprint:** 12 (Fase 12, construida en paralelo sobre datos de prueba — ver ROADMAP.md) · **Responsable:** ncorrea-13 · **Última actualización:** 2026-08-18

## 1. Objetivo

Darle al administrador global una vista agregada del estado de la plataforma (usuarios, refugios, mascotas, publicaciones, solicitudes, campañas) y permitirle exportar esos datos a CSV.

## 2. Alcance

- **Incluye:** HU-14.1 (dashboard estadístico global, rol Administrador), HU-14.3 (exportación CSV, alcance Administrador).
- **NO incluye:** HU-14.2 (dashboard de gestión interna del Refugio — ver spec 010, mismo patrón de agregación pero scopeado a `refugioId`); moderación/verificación de refugios (Módulo 3 — spec 008, ver nota en spec 001); exportación desde el rol Refugio (queda para spec 010).

## 3. Entidades involucradas

Ninguna nueva — son vistas agregadas de solo lectura sobre `Usuario`, `Refugio`, `Mascota`, `Publicacion`, `Solicitud`, `Campania`, `Donacion`, `ReporteProblema` y sus catálogos `Estado*` (ver MODELO_DATOS.md). No se agregan columnas ni tablas.

**`ReporteProblema` — solo lectura, sin módulo propio:** se consulta `resuelto: false` para el KPI `reportesPendientes`. No hay noción de "crítico"/prioridad en el modelo (solo `motivo`, `respuesta`, `resuelto`), y la entidad ni siquiera tiene FK a `Usuario` dibujada (ambigüedad #2, REQUISITOS.md §10). Esto NO abre el módulo de moderación (spec 008) — es una única consulta de agregación, igual que el resto de este endpoint.

**Fuera de esta spec — `distribucionGeografica`:** se evaluó agregar publicaciones/adopciones por departamento, pero `Publicacion.ubicacion` es texto libre (`prisma/schema.prisma:380`, sin FK a Provincia/Localidad) — agrupar por ese campo cuenta variantes/typos como filas distintas. Decisión 2026-08-18: no implementar hasta que exista un catálogo geográfico real en el modelo (ningún módulo lo tiene todavía).

**Gap detectado:** `Donacion` no tiene ningún campo de confirmación en el schema actual (`prisma/schema.prisma:698-715`) — solo `monto`, `campaniaId`, `usuarioId` + auditoría. La regla transversal #11 ("el monto declarado nunca impacta la barra de progreso, solo cuando el refugio confirma manualmente") depende de un estado que hoy no existe en el modelo. Es un problema de Módulo 12 (Campañas), no de este módulo — lo señalo para no asumir una interpretación silenciosa. Mientras no se resuelva, el dashboard reporta el total de `Donacion.monto` como "donado declarado", sin poder aislar "confirmado".

## 4. API (contrato backend)

| Método | Ruta | Auth | Descripción |
|---|---|---|---|
| GET | /api/v1/admin/dashboard | JWT, rol Administrador | Métricas agregadas (counts por estado, totales) |
| GET | /api/v1/admin/dashboard/exportar/:entidad | JWT, rol Administrador | CSV de una entidad (`usuarios`, `mascotas`, `publicaciones`, `solicitudes`, `campanias`), generado por streams |

Ejemplo (shape real, respuesta plana sin envelope — igual que el resto de la API):

```json
GET /api/v1/admin/dashboard
→ 200 {
  "kpis": {
    "usuariosActivos": 120,
    "mascotasRegistradas": 340,
    "refugiosVerificados": 15,
    "publicacionesActivas": 210,
    "adopcionesConcretadas": 150,
    "campaniasActivas": 6,
    "montoDonadoDeclarado": 450000.00,
    "reportesPendientes": 4
  },
  "usuariosPorRol": { "Adoptante": 100, "Refugio": 18, "Administrador": 2 },
  "mascotasPorEstado": { "Disponible": 200, "Adoptado": 100, "En_Tratamiento": 30, "Fallecido": 5, "En_Transito": 5 },
  "solicitudesPorEstado": [
    { "estado": "Pendiente", "cantidad": 40, "porcentaje": 17.4 },
    { "estado": "En_Revision", "cantidad": 10, "porcentaje": 4.3 },
    { "estado": "Aprobada", "cantidad": 150, "porcentaje": 65.2 },
    { "estado": "Rechazada", "cantidad": 30, "porcentaje": 13.0 },
    { "estado": "Cancelada", "cantidad": 5, "porcentaje": 0.0 }
  ],
  "publicacionesPorMes": [
    { "mes": "Mar", "publicaciones": 45, "adopciones": 20 },
    { "mes": "Abr", "publicaciones": 52, "adopciones": 28 },
    { "mes": "May", "publicaciones": 60, "adopciones": 35 },
    { "mes": "Jun", "publicaciones": 38, "adopciones": 19 },
    { "mes": "Jul", "publicaciones": 41, "adopciones": 22 },
    { "mes": "Ago", "publicaciones": 30, "adopciones": 26 }
  ]
}
```

`publicacionesPorMes` son siempre los últimos 6 meses (incluye el actual), meses sin datos van en 0 — no se omiten. `adopcionesConcretadas` = cantidad de `solicitudesPorEstado` con `estado: "Aprobada"` (misma fuente, no un conteo aparte).

```
GET /api/v1/admin/dashboard/exportar/solicitudes
→ 200, Content-Type: text/csv, streamed (nunca se arma el archivo completo en memoria)
```

Errores: `403 { error: { codigo: "ROL_NO_AUTORIZADO", mensaje: "..." } }` si no es Administrador. `400 { error: { codigo: "ENTIDAD_INVALIDA", ... } }` si `:entidad` no está en la lista soportada.

## 5. Pantallas (frontend)

- GUI-39 Dashboard Admin — solo **web-admin**.
- GUI-40 Dashboard Admin Vacío — cuando no hay datos (BD recién sembrada).
- GUI-41 Error de Exportación.

No aplica a mobile.

## 6. Reglas de negocio y validaciones

1. Solo rol Administrador accede (`middlewares/roles.ts`).
2. Los conteos excluyen bajas lógicas (`fechaBaja IS NULL`) salvo que la métrica sea explícitamente histórica.
3. `donacion.monto` se reporta como "declarado", no como "confirmado" (ver gap en sección 3).
4. Export siempre por streams (regla transversal #12 de CLAUDE.md) — usar streaming de Prisma (`cursor` / `findMany` paginado) hacia el stream de respuesta, nunca `findMany()` completo + `join('\n')`.
5. El `service.ts` de este módulo solo lee (ningún endpoint escribe) — sin reglas de auditoría de alta/baja propias.

## 7. Criterios de aceptación

- [ ] Given soy Administrador autenticado, When pido `GET /admin/dashboard`, Then recibo counts consistentes con la BD (verificado contra datos sembrados).
- [ ] Given soy Adoptante o Refugio, When pido `GET /admin/dashboard`, Then recibo 403.
- [ ] Given la BD no tiene datos operativos, When pido el dashboard, Then los counts son 0 (no error) — habilita GUI-40 en frontend.
- [ ] Given pido exportar una entidad soportada, When la descarga corre, Then el CSV tiene headers correctos y una fila por registro no dado de baja, sin cargar el dataset completo en memoria (verificar con dataset grande en test de integración).
- [ ] Given pido exportar una entidad no soportada, When llamo el endpoint, Then recibo 400 `ENTIDAD_INVALIDA`.

## 8. Casos borde y errores

- BD vacía → counts en 0, export con solo headers.
- Entidad de export inexistente/mal tipeada → 400.
- Rol insuficiente → 403, sin filtrar info parcial.
- Dataset de export muy grande → no debe degradar memoria (streaming real, testear con seed extendido).

## 9. Notas y decisiones

- 2026-08-18 (ncorrea-13): se prioriza esta spec sobre el orden estricto del ROADMAP porque Fase 12 admite construirse en paralelo "sobre datos de prueba" mientras el resto avanza (ver ROADMAP.md Fase 12). Los fixtures operativos (Mascota, Publicacion, Solicitud, Campania, Donacion) para probar las agregaciones viven en `prisma/seed-dashboard-admin.ts` (renombrado 2026-08-24, antes `seed-dashboard.ts`, para distinguirlo del análogo de refugio agregado en spec 010), **separado de `prisma/seed.ts` a propósito**: el proyecto lo tocan varias personas y `prisma.seed` (`npx prisma db seed` / `migrate reset`) corre `seed.ts` automáticamente para todo el equipo — no corresponde imponerle datos de una feature en curso a quien está trabajando otra fase. `seed-dashboard-admin.ts` no está enganchado a ningún hook ni script de `package.json`; se corre a mano, después de `npm run seed`:
  ```bash
  npx tsx prisma/seed-dashboard-admin.ts
  ```
- Gap de `Donacion` sin campo de confirmación: pendiente confirmar con el equipo si se resuelve en Módulo 12 (Fase 10) antes o después de esta spec. No se agrega el campo acá para no invadir el alcance de otra spec.
- HU-14.2 (dashboard Refugio) queda fuera deliberadamente — resuelto en spec 010.
