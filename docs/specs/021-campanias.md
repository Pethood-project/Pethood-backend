# Spec 021 — Campañas de donación (HU-12.1 a HU-12.7)

**Estado:** APROBADA
**Sprint:** 13 · **Responsable:** Grupo 09 · **Última actualización:** 2026-09-30

## 1. Objetivo

Que un refugio pueda publicar campañas de recaudación con su alias y/o CBU, que los adoptantes
donen por transferencia bancaria (por fuera del sistema) y avisen que donaron, y que el refugio
confirme o rechace cada donación a mano. La barra de progreso de la campaña refleja sólo lo que
el refugio confirmó (regla transversal 11). Un cron mueve las campañas entre estados por fecha y
por monto alcanzado.

## 2. Alcance

- **Incluye:**
  - HU-12.1: alta de campaña desde el perfil Refugio (pantalla 27), con alias y/o CBU. Nace
    «Inactiva». Tope de 5 campañas vigentes por refugio.
  - HU-12.1: listado «Mis Campañas» del refugio (pantalla 21), con filtros por fecha y estado.
  - HU-12.2: portal «Campañas Solidarias» del adoptante (pantalla 13) y detalle de la campaña con
    alias y CBU para transferir.
  - HU-12.3: el adoptante avisa que donó («Terminar donación») → donación «Pendiente»; el refugio
    la revisa y la aplica («Realizada», suma al progreso) o la rechaza («Cancelada», no suma).
  - HU-12.4: cron diario de transición de estados (usuario SISTEMA).
  - HU-12.5 / HU-12.6 / HU-12.7: cancelar y finalizar a mano; reglas de qué transición vale y
    quién la hace.
  - Ajuste de los dashboards de admin y refugio (specs 009 y 010) para que cuenten sólo
    donaciones «Realizada». Cierra el gap de `Donacion` señalado en spec 009 §3.
- **NO incluye:**
  - Editar una campaña (el botón «Editar» de la pantalla 21 queda sin acción): spec posterior.
  - Confirmación automática contra Mercado Pago y montos con centavos únicos: spike y luego
    **spec 022**. El modelo de esta spec la admite sin cambios (ver §9, decisión 8).
  - Comprobante adjunto a la donación (captura de la transferencia): se evalúa si la spec 022
    no resulta viable.
  - «Mis donaciones» del adoptante (historial y estado de lo que donó): spec posterior.
  - Panel web (GUI-36 en `web-admin`): sigue con datos de ejemplo; esta spec cubre la app mobile.
  - Validar los dígitos verificadores del CBU: sólo se valida el formato (§6).

## 3. Entidades involucradas

`Campaña`, `Estado_Campaña` y `Donacion` ya existen (`MODELO_DATOS.md`). Cambios:

- **`Campaña`**
  - **`campaña_alias`** (texto, nullable): alias bancario o de billetera para transferir.
  - **`campaña_cbu`** (texto, nullable): CBU o CVU, 22 dígitos.
  - Al menos uno de los dos es obligatorio; lo impone el DTO (sin eso no hay forma de donar).
  - `campaña_imagen_url` sigue nullable en base (las campañas del seed no tienen imagen); el
    DTO de alta la exige, como pide HU-12.1.
- **`Estado_Donacion`** (catálogo nuevo, `estado_donacion_id PK`, con auditoría como el resto
  de los catálogos). Valores: **Pendiente**, **Realizada**, **Cancelada**.
- **`Donacion`**
  - FK **`estado_donacion_id`** NOT NULL → `Estado_Donacion`. La migración deja las donaciones
    existentes en «Realizada»: hasta hoy los dashboards las contaban como donadas.
  - **`donacion_motivo_rechazo`** (texto, nullable): `NO_RECIBIDA` o `MONTO_NO_COINCIDE`. Sólo
    en una donación «Cancelada».
  - Quién y cuándo la aplicó o rechazó sale de la auditoría (`donacion_usuario_modificacion`,
    `donacion_fecha_modificacion`). No se agregan columnas para eso.
- **Índices:** `campania (refugio_id, estado_campania_id)` para la quota y el listado;
  `donacion (campania_id, estado_donacion_id)` para el progreso y la bandeja de pendientes.

`Estado_Campaña` no cambia: **Inactiva, Activa, Finalizada, Cancelada** (§6, máquina de estados).

## 4. API (contrato backend)

| Método | Ruta | Auth | HU | Descripción |
| --- | --- | --- | --- | --- |
| GET | `/api/v1/campanias` | perfil PERSONAL | 12.2 | Portal: campañas «Activa» de todos los refugios |
| GET | `/api/v1/campanias/:id` | cualquier usuario | 12.2 | Detalle con alias, CBU y progreso |
| POST | `/api/v1/campanias/:id/donaciones` | perfil PERSONAL | 12.3 | «Terminar donación»: registra la donación «Pendiente» |
| GET | `/api/v1/refugio/campanias` | perfil REFUGIO | 12.1 | «Mis Campañas», con filtros |
| POST | `/api/v1/refugio/campanias` | perfil REFUGIO | 12.1 | Alta (multipart, imagen en `imagen`) |
| PATCH | `/api/v1/refugio/campanias/:id/estado` | perfil REFUGIO | 12.5 / 12.6 / 12.7 | Finalizar o cancelar |
| GET | `/api/v1/refugio/campanias/:id/donaciones` | perfil REFUGIO | 12.3 | Donaciones de una campaña (bandeja de revisión) |
| PATCH | `/api/v1/refugio/donaciones/:id/estado` | perfil REFUGIO | 12.3 | Aplicar o rechazar una donación |
| GET | `/api/v1/estados-campania` | cualquier usuario | 12.1 | Catálogo para el filtro por estado |

Los listados que consume la app paginan por cursor (`cursor`, `limite`, respuesta con
`hayMas` y `proximoCursor`), como el resto de la API mobile. El contrato detallado de cada
endpoint (headers, bodies, respuestas, errores) se escribe al implementar en
`docs/api-campanias.md`, como hizo la spec 020, y esta sección queda sólo con la tabla.

### Forma de una campaña en las respuestas

```json
{
  "id": 12,
  "titulo": "Nuevo espacio para cachorros",
  "descripcion": "Fondos para ampliar el área de recuperación.",
  "imagenUrl": "/api/v1/archivos/campanias/abc.webp",
  "objetivo": 2500000,
  "recaudado": 1430000,
  "porcentaje": 57,
  "donantes": 23,
  "fechaInicio": "2026-10-01",
  "fechaFin": "2026-12-31",
  "estado": { "id": 2, "nombre": "Activa" },
  "alias": "refugio.esperanza.mp",
  "cbu": "0000003100012345678901",
  "refugio": { "id": 3, "nombre": "Refugio Esperanza" }
}
```

- `recaudado` = suma de las donaciones «Realizada»; `donantes` = usuarios distintos con al
  menos una donación «Realizada». `porcentaje` se redondea hacia abajo y se topea en 100 para
  la barra (el `recaudado` real puede superar el objetivo).
- En «Mis Campañas» cada campaña suma `pendientes`: cantidad de donaciones «Pendiente», para el
  aviso «Tenés N donaciones para revisar».

### Bodies

- **Alta de campaña** (multipart): `titulo`, `descripcion`, `objetivo`, `fechaInicio`,
  `fechaFin`, `alias`, `cbu`, archivo `imagen`.
- **Donar:** `{ "monto": "5000" }` (acepta coma o punto decimal).
- **Estado de campaña:** `{ "estado": "Finalizada" | "Cancelada" }`.
- **Estado de donación:** `{ "estado": "Realizada" }` o
  `{ "estado": "Cancelada", "motivo": "NO_RECIBIDA" | "MONTO_NO_COINCIDE" }`.

### Errores propios del módulo (`{ error: { codigo, mensaje } }`)

| Código | HTTP | Cuándo |
| --- | --- | --- |
| `LIMITE_CAMPANIAS` | 409 | El refugio ya tiene 5 campañas Inactiva/Activa |
| `REFUGIO_NO_HABILITADO` | 403 | El refugio no está verificado o no está «Activo» |
| `CAMPANIA_NO_ENCONTRADA` | 404 | No existe, está dada de baja o es de otro refugio (en rutas de refugio) |
| `CAMPANIA_NO_ACTIVA` | 409 | Se intenta donar a una campaña que no está «Activa» |
| `DONACION_PROPIA` | 403 | Un miembro intenta donar a una campaña de su propio refugio |
| `TRANSICION_INVALIDA` | 409 | Cambio de estado de campaña o donación que la máquina de estados no permite |
| `DONACION_NO_ENCONTRADA` | 404 | No existe o es de otro refugio |

## 5. Pantallas (frontend mobile)

Referencia: prototipo `pethood-frontend/pantallas/PetHood App (standalone).html`.

- **13 · Campañas Solidarias (adoptante):** tarjetas con imagen, refugio, título,
  descripción, «Recaudado: $X · Meta: $Y», barra con «N% completado» y botón «Donar ahora».
  Scroll infinito. Vacío: «No hay campañas activas por ahora». Se entra desde la sección
  Campañas de Inicio, que hoy dice «Muy pronto» (deuda 21 del front).
- **Donar (nueva, no está en el prototipo):** abre al tocar «Donar ahora». Muestra alias y/o
  CBU con botón copiar, campo «Monto que transferiste ($)» y el botón «Terminar donación».
  Aclara que la donación se suma a la campaña cuando el refugio confirma que recibió la
  transferencia. Al confirmar: toast «¡Gracias! El refugio va a confirmar tu donación» y vuelve
  al portal.
- **21 · Mis Campañas (refugio):** tarjetas con badge de estado, título, «$recaudado · Meta»,
  barra, «N% · M donantes», aviso de pendientes y acciones según estado: «Finalizar» (Activa),
  «Cancelar» (Inactiva o Activa), «Revisar donaciones». «Editar» se muestra deshabilitado
  (fuera de alcance). Botón «Nueva». Filtros: fecha (desde obligatoria, hasta opcional) y
  estado (selección múltiple). Vacío: «No tiene campañas creadas».
- **Revisar donaciones (nueva):** lista de donaciones de la campaña con donante, monto y
  fecha, filtrada por estado (`?estado=Pendiente|Realizada|Cancelada`, sin filtro = todas);
  abre en «Pendientes». Se filtra en vez de ordenar por estado porque un orden por estado no
  se sostiene con la paginación por cursor. Botones «Aplicar» y «Rechazar»; rechazar pide el motivo («No se
  recibió la transferencia» / «El monto no coincide»). Ambas acciones con modal de
  confirmación (regla transversal 6).
- **27 · Nueva Campaña:** imagen, título, descripción, meta de recaudación ($), fecha de
  inicio, fecha límite, alias, CBU. Botones «Cancelar» (rojo, vuelve al listado) y «Confirmar»
  (verde, textos literales de HU-12.1; el prototipo dice «Publicar campaña»). Si hay 5
  campañas vigentes, el cartel de límite alcanzado.
- Finalizar y cancelar campaña piden confirmación con modal.

## 6. Reglas de negocio y validaciones

Todas se validan en el backend; el frontend las repite sólo para UX.

1. **Campos de la campaña (HU-12.1):**
   - título obligatorio, 3 a 50 caracteres, trim;
   - descripción obligatoria, hasta 300 caracteres, trim;
   - objetivo sólo números, entre $10.000 y $2.500.000, sin decimales;
   - fecha de inicio ≥ hoy; fecha de fin > fecha de inicio;
   - imagen obligatoria, jpg/png/webp, ≤5 MB, comprimida por el middleware (regla 4);
   - alias: 6 a 20 caracteres, letras, números, `.` y `-` (formato BCRA);
   - CBU/CVU: exactamente 22 dígitos;
   - al menos uno de alias o CBU.
   Las longitudes van en `LIMITES.campania` (`shared/validation/limits.ts`, duplicado a mano
   en el front). «Fecha ≥ hoy» es una regla nueva de `shared/validation/dates.ts`
   (`validarFechaNoPasada`), porque la existente `validarFechaFutura` excluye hoy.
2. **Quién crea y gestiona:** un miembro del refugio, parado en el perfil Refugio. El refugio
   tiene que estar verificado y en estado «Activo» para crear campañas. Cualquier miembro puede
   gestionar cualquier campaña de su refugio (igual que las publicaciones, deuda 18).
3. **Quota (regla transversal 7):** máximo 5 campañas del refugio en «Inactiva» o «Activa».
   Contar sólo las «Activa» dejaría crear campañas Inactivas sin límite. Mensaje:
   «Alcanzaste el límite de 5 campañas activas. Finalizá o cancelá una para crear otra».
4. **Máquina de estados de la campaña (HU-12.4 a 12.7):**

   | Desde | Hacia | Quién | Cuándo |
   | --- | --- | --- | --- |
   | (alta) | Inactiva | Refugio | Al crearla |
   | Inactiva | Activa | SISTEMA | `fecha_inicio` ≤ hoy |
   | Activa | Finalizada | SISTEMA | `fecha_fin` < hoy, o `recaudado` ≥ `objetivo` |
   | Activa | Finalizada | Refugio | Botón «Finalizar» |
   | Inactiva o Activa | Cancelada | Refugio | Botón «Cancelar» (dar de baja) |

   Finalizada y Cancelada son finales. Cualquier otra transición → `TRANSICION_INVALIDA`.
   Cancelar es la baja de HU-12.5: cambia el estado y **no** llena `fecha_baja`, para que la
   campaña siga apareciendo en el filtro «Cancelada».
5. **Una campaña que empieza hoy** nace «Inactiva» (literal de HU-12.1) y en la misma
   operación se le aplica la regla del cron, así que queda «Activa» sin esperar a la corrida
   del día siguiente. Quedan registrados los dos pasos.
6. **Donar (HU-12.2 / 12.3):** sólo desde el perfil Personal y sólo a campañas «Activa». Un
   miembro no puede donar a una campaña de su propio refugio (`DONACION_PROPIA`), igual que no
   adopta mascotas propias. Monto entre $1 y $2.500.000, hasta 2 decimales. Nace «Pendiente» y
   **no suma** al progreso.
7. **Revisar donaciones (HU-12.3):** Pendiente → Realizada (suma) o Pendiente → Cancelada con
   motivo obligatorio (no suma). Realizada y Cancelada son finales. Se pueden revisar aunque
   la campaña ya esté Finalizada o Cancelada: la plata pudo haberse transferido antes del
   cierre. Aplicar una donación que lleva `recaudado` ≥ `objetivo` en una campaña «Activa» la
   finaliza en la misma operación (misma regla que el cron, sin esperar un día). Son dos
   escrituras condicionales: si la segunda fallara, la completa el cron, que aplica la misma
   regla.
8. **Cron (regla transversal 10):** `src/jobs/transicion-estados-campana.job.ts`, función
   pura con `ahora` inyectable más entrypoint CLI, igual que `cancelar-solicitudes-vencidas`.
   Una corrida activa y después finaliza, así una campaña Inactiva con la fecha de fin vencida
   (por ejemplo, si el cron no corrió) termina en «Finalizada». Cada cambio usa
   `USUARIO_SISTEMA_ID` y escribe `LogAuditoria`. Cada transición es condicional al estado
   leído, así una carrera con un refugio que finaliza a mano no es un error.
9. **Auditoría:** alta, cambio de estado de campaña y aplicar/rechazar donación escriben
   `LogAuditoria`.
10. **Dashboards:** `montoDonado` (spec 009) y `donaciones`/`donacionesPorMes` (spec 010)
    pasan a contar sólo donaciones «Realizada». La exportación CSV de donaciones del refugio
    suma la columna `estado`.

## 7. Criterios de aceptación

- [ ] Un miembro de un refugio verificado y activo crea una campaña válida y queda «Inactiva»
      (o «Activa» si empieza hoy).
- [ ] Con 5 campañas Inactiva/Activa, el alta responde 409 `LIMITE_CAMPANIAS`.
- [ ] Cada validación del §6.1 rechaza con 400 y un mensaje en voseo, incluido «ni alias ni CBU».
- [ ] «Mis Campañas» lista sólo las del refugio, más reciente primero; filtra por intervalo de
      `fecha_inicio` y por estados; sin campañas, el front muestra «No tiene campañas creadas».
- [ ] El portal del adoptante muestra sólo campañas «Activa», con recaudado, meta y porcentaje.
- [ ] Donar a una campaña «Activa» crea una donación «Pendiente» y el `recaudado` no cambia.
- [ ] Donar a una campaña no «Activa» → 409; desde el perfil Refugio → 403; a la del propio
      refugio → 403.
- [ ] Aplicar una donación la pasa a «Realizada» y el `recaudado` sube su monto.
- [ ] Rechazar sin motivo → 400; con motivo, queda «Cancelada» y el `recaudado` no cambia.
- [ ] Aplicar la donación que completa el objetivo finaliza la campaña.
- [ ] Finalizar una Activa y cancelar una Inactiva o Activa funcionan; cualquier otra
      transición → 409.
- [ ] El cron activa las campañas cuya fecha de inicio llegó y finaliza las vencidas o
      completas, con usuario SISTEMA y `LogAuditoria`.
- [ ] Los dashboards de admin y refugio no cuentan donaciones «Pendiente» ni «Cancelada».
- [ ] Ninguna ruta de refugio deja ver o tocar campañas o donaciones de otro refugio (404).

## 8. Casos borde y errores

- **Refugio suspendido con campañas vivas:** no puede crear nuevas; las existentes siguen su
  ciclo. Si hay que frenarlas, el admin o el refugio las cancela.
- **Carrera entre dos miembros** que aplican y rechazan la misma donación: la actualización
  es condicional a «Pendiente»; el segundo recibe `TRANSICION_INVALIDA`.
- **Carrera entre el cron y el botón «Finalizar»:** mismo mecanismo; quien llega segundo no
  cambia nada (el cron lo saltea en silencio).
- **Recaudado que supera el objetivo:** permitido (se aplican pendientes después de
  finalizar); la barra se topea en 100%.
- **Donaciones spam** (un adoptante declara muchas donaciones falsas): no hay quota en los
  requisitos. El refugio las rechaza; se anota como deuda por si hace falta un tope.
- **Imagen inválida o >5 MB:** 400 del middleware de subida, como en el resto de la API.

## 9. Notas y decisiones

1. **2026-09-30 (equipo):** alias y CBU son por campaña, y se pueden cargar los dos.
2. **2026-09-30 (equipo):** la donación se declara después de transferir («Terminar
   donación») y queda en espera hasta que un miembro del refugio la aplica o la rechaza. El
   estado en espera se llama «Pendiente».
3. **2026-09-30 (equipo):** se usan los estados de campaña que ya estaban en el catálogo y en
   las HU (Inactiva, Activa, Finalizada, Cancelada). Resuelve la ambigüedad 3 de
   `REQUISITOS.md` §10: HU-12.7 es de estados de **campaña**, no de `Estado_Mascota`.
4. **HU-12.7** figura sólo con el título en el repo. Se interpreta como la máquina de estados
   del §6.4. Si el documento fuente dice algo más, se ajusta esta spec.
5. La quota cuenta Inactiva + Activa (§6.3).
6. Cancelar no llena `fecha_baja` (§6.4).
7. Las rutas de gestión van bajo `/refugio/...` y exigen el perfil Refugio, como
   `perfil-refugio` y `dashboard-refugio`. El portal y la donación van bajo `/campanias` y
   exigen el perfil Personal: desde el perfil Refugio no se dona.
8. **Preparado para la spec 022 (Mercado Pago):** la confirmación automática sería otro
   camino hacia «Realizada» con `usuario_modificacion = SISTEMA`; el monto ya admite centavos
   (`Decimal(12,2)`), que es lo que necesita el matching por centavos únicos. La regla 11 dice
   «cuando el refugio confirma manualmente»: si se automatiza, hay que registrar el cambio de
   requisito como decisión del equipo.
