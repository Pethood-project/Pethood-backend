# API — Dashboard Admin

Todos los endpoints bajo `/api/v1/admin`. Requieren autenticacion JWT + rol `Administrador`.

---

## `GET /api/v1/admin/dashboard`

KPIs agregados y desgloses para el panel de administracion global. Sin parametros de entrada.

**Respuesta:**

```json
{
  "kpis": {
    "usuariosActivos": 150,
    "mascotasRegistradas": 320,
    "refugiosVerificados": 12,
    "publicacionesActivas": 45,
    "adopcionesConcretadas": 28,
    "campaniasActivas": 5,
    "montoDonadoDeclarado": 125000.50,
    "reportesPendientes": 3
  },
  "usuariosPorRol": {
    "Adoptante": 120,
    "Refugio": 25,
    "Administrador": 5
  },
  "mascotasPorEstado": {
    "Disponible": 100,
    "Adoptado": 80,
    "En_Tratamiento": 30,
    "Fallecido": 5
  },
  "solicitudesPorEstado": [
    { "estado": "Pendiente",  "cantidad": 10, "porcentaje": 25.0 },
    { "estado": "Aprobada",   "cantidad": 28, "porcentaje": 70.0 },
    { "estado": "Rechazada",  "cantidad": 2,  "porcentaje": 5.0 }
  ],
  "publicacionesPorMes": [
    { "mes": "Mar", "publicaciones": 12, "adopciones": 5 },
    { "mes": "Abr", "publicaciones": 8,  "adopciones": 7 },
    { "mes": "May", "publicaciones": 15, "adopciones": 3 },
    { "mes": "Jun", "publicaciones": 10, "adopciones": 6 },
    { "mes": "Jul", "publicaciones": 9,  "adopciones": 4 },
    { "mes": "Ago", "publicaciones": 6,  "adopciones": 3 }
  ]
}
```

**Descripcion de campos:**

| Seccion | Tipo | Descripcion |
|---|---|---|
| `kpis.usuariosActivos` | number | Usuarios sin baja logica |
| `kpis.mascotasRegistradas` | number | Mascotas sin baja logica |
| `kpis.refugiosVerificados` | number | Refugios con `verificado=true` |
| `kpis.publicacionesActivas` | number | Publicaciones con `fechaBaja=null` |
| `kpis.adopcionesConcretadas` | number | Solicitudes con estado "Aprobada" |
| `kpis.campaniasActivas` | number | Campanas con `fechaBaja=null` |
| `kpis.montoDonadoDeclarado` | number | Suma de montos declarados en donaciones |
| `kpis.reportesPendientes` | number | Mascotas perdidas/encontradas sin resolver |
| `usuariosPorRol` | object | Cantidad de usuarios activos por rol |
| `mascotasPorEstado` | object | Cantidad de mascotas activas por estado |
| `solicitudesPorEstado` | array | Conteo y porcentaje (1 decimal) por estado |
| `publicacionesPorMes` | array | Ultimos 6 meses, valores en cero si no hay datos |

---

## `GET /api/v1/admin/dashboard/exportar/:entidad`

Exporta la entidad indicada como CSV para descarga. Streaming interno (500 filas/pagina), sin carga completa en memoria.

**Parametro de URL:**

| Nombre | Tipo | Valores permitidos |
|---|---|---|
| `entidad` | string | `usuarios`, `mascotas`, `publicaciones`, `solicitudes`, `campanias` |

**Respuesta:** `Content-Type: text/csv; charset=utf-8` con `Content-Disposition: attachment; filename="<entidad>.csv"`.

**Columnas CSV por entidad:**

| Entidad | Columnas |
|---|---|
| `usuarios` | id, nombre, apellido, email, dni, verificado, estado, fechaAlta |
| `mascotas` | id, nombre, especie, raza, estado, refugioId, usuarioId, fechaAlta |
| `publicaciones` | id, titulo, mascotaId, usuarioId, ubicacion, fechaAlta |
| `solicitudes` | id, tipo, publicacionId, usuarioId, estado, fechaAlta |
| `campanias` | id, titulo, objetivo, estado, refugioId, fechaInicio, fechaFin |

**Errores:**

| Codigo | Mensaje | HTTP |
|---|---|---|
| `ENTIDAD_INVALIDA` | La entidad no es valida para exportacion | 400 |

---

## `GET /api/v1/admin/dashboard/refugio` [ ]

Dashboard agregado de un refugio especifico (gestion interna). Un refugio ve el suyo; un admin puede consultar cualquiera.

**Query params:**

| Nombre | Tipo | Descripcion |
|---|---|---|
| `refugioId` | integer | ID del refugio a consultar |

**Respuesta:**

```json
{
  "kpis": {
    "mascotasActivas": 15,
    "solicitudesPendientes": 3,
    "adopcionesConcretadas": 12,
    "campaniasActivas": 2,
    "resenasRecibidas": 28,
    "promedioResenas": 4.2
  },
  "solicitudesPorEstado": [
    { "estado": "Pendiente", "cantidad": 3, "porcentaje": 20.0 },
    { "estado": "Aprobada",  "cantidad": 12, "porcentaje": 80.0 }
  ],
  "mascotasPorEstado": [
    { "estado": "Disponible",   "cantidad": 8 },
    { "estado": "En_Transito",  "cantidad": 4 },
    { "estado": "Adoptado",     "cantidad": 3 }
  ],
  "campanasActivas": [
    {
      "id": 1,
      "titulo": "Campana invierno",
      "objetivo": 500000,
      "montoAcumulado": 125000,
      "porcentaje": 25.0
    }
  ],
  "ultimasResenas": [
    {
      "id": 1,
      "puntuacion": 5,
      "comentario": "Muy buen trato",
      "autor": { "id": 5, "nombre": "Juan" },
      "fecha": "2026-08-01T10:00:00.000Z"
    }
  ]
}
```

**Descripcion de campos:**

| Seccion | Tipo | Descripcion |
|---|---|---|
| `kpis.mascotasActivas` | number | Mascotas del refugio sin baja logica |
| `kpis.solicitudesPendientes` | number | Solicitudes en estado "Pendiente" |
| `kpis.adopcionesConcretadas` | number | Solicitudes con estado "Aprobada" |
| `kpis.campaniasActivas` | number | Campanas activas del refugio |
| `kpis.resenasRecibidas` | number | Total de resenas activas |
| `kpis.promedioResenas` | number | Promedio de puntuacion (1 decimal) |
| `solicitudesPorEstado` | array | Conteo por estado |
| `mascotasPorEstado` | array | Conteo por estado |
| `campanasActivas` | array | Campanas con progreso actual |
| `ultimasResenas` | array | Ultimas 5 resenas recibidas |
