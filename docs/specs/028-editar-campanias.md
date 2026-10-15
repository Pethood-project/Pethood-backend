# Spec 028 — Editar, pausar y eliminar campañas (sin HU)

**Estado:** APROBADA
**Sprint:** 13 · **Responsable:** Grupo 09 · **Última actualización:** 2026-10-15

## 1. Objetivo

Que el refugio pueda corregir una campaña ya publicada (título, descripción, imagen, meta y
fecha de fin), pausarla un tiempo sin perderla, y eliminar una que creó por error. Reemplaza
«Cancelar» por «Eliminar» y suma el estado «Pausada». No hay HU: las reglas las definió el
equipo el 2026-10-15 (§9).

## 2. Alcance

- **Incluye:**
  - Editar una campaña desde «Mis Campañas» (el botón «Editar» de la pantalla 21, que la spec
    026 dejó deshabilitado).
  - Estado nuevo **Pausada**, con las acciones «Pausar» y «Reactivar».
  - «Finalizar» desde cualquier estado no final (antes, sólo desde Activa).
  - «Eliminar» (baja lógica) en lugar de «Cancelar», sólo para campañas sin donaciones.
  - Sacar el estado «Cancelada»: migración de datos y filtro de «Mis Campañas».
- **NO incluye:**
  - Editar alias, CBU ni fecha de inicio.
  - Avisar a los donantes cuando se edita, pausa o finaliza una campaña.
  - Panel web (`web-admin`): sigue como en la spec 026.

## 3. Entidades involucradas

El esquema no cambia: sólo cambian los datos del catálogo.

- **`Estado_Campaña`:** valores **Inactiva, Activa, Pausada, Finalizada**. La migración
  `20261015120000_campania_estado_pausada` agrega «Pausada», pasa las campañas «Cancelada» a
  «Finalizada» (usuario SISTEMA) y da de baja lógica la fila «Cancelada». Las canceladas
  conservan sus donaciones y siguen en «Mis Campañas».
- **`Campaña`:** «Eliminar» llena `campaña_usuario_baja` y `campaña_fecha_baja`. Una campaña
  dada de baja no aparece en ningún listado ni en el detalle.

## 4. API (contrato backend)

| Método | Ruta | Auth | Descripción |
| --- | --- | --- | --- |
| PATCH | `/api/v1/refugio/campanias/:id` | perfil REFUGIO | Editar (multipart, imagen opcional en `imagen`) |
| DELETE | `/api/v1/refugio/campanias/:id` | perfil REFUGIO | Eliminar (baja lógica) |
| PATCH | `/api/v1/refugio/campanias/:id/estado` | perfil REFUGIO | Finalizar, pausar o reactivar (body `Finalizada` \| `Pausada` \| `Activa`) |

La campaña de «Mis Campañas» suma `tieneDonaciones`. **Contrato completo:**
[`docs/api-campanias.md`](../api-campanias.md).

## 5. Pantallas (frontend mobile)

- **21 · Mis Campañas:** tocar la tarjeta abre el detalle. Las acciones de la tarjeta
  dependen del estado.
  - Inactiva: «Finalizar».
  - Activa: «Pausar», «Finalizar».
  - Pausada: «Reactivar», «Finalizar».
  - Finalizada: sin acciones de gestión.
  - «Eliminar» aparece en cualquier estado si la campaña no tiene donaciones.
  - Pausar, reactivar, finalizar y eliminar piden confirmación con modal (regla transversal 6).
  - El filtro de estados ya no ofrece «Cancelada»: sale del catálogo.
- **Detalle de la campaña (nueva, perfil Refugio):** todos los datos de la campaña, con
  edición en el lugar.
  - Imagen, título, descripción, meta y fecha límite llevan un lápiz que abre ese campo.
  - Fecha de inicio, alias y CBU se muestran sin lápiz.
  - Apenas un valor difiere del guardado aparecen «Cancelar» (descarta todo) y «Guardar
    cambios»; salir con cambios sin guardar pide confirmación.
  - En una Finalizada no hay lápices.
  - Desde ahí también se entra a «Revisar donaciones».
- **Badge «Pausada»** en la tarjeta.

## 6. Reglas de negocio y validaciones

1. **Máquina de estados** (reemplaza la de la spec 026 §6.4):

   | Desde | Hacia | Quién | Cuándo |
   | --- | --- | --- | --- |
   | (alta) | Inactiva | Refugio | Al crearla |
   | Inactiva | Activa | SISTEMA | `fecha_inicio` ≤ hoy |
   | Activa o Pausada | Finalizada | SISTEMA | `fecha_fin` < hoy, o `recaudado` ≥ `objetivo` |
   | Activa | Pausada | Refugio | «Pausar» |
   | Pausada | Activa | Refugio | «Reactivar» |
   | Inactiva, Activa o Pausada | Finalizada | Refugio | «Finalizar» |

   Finalizada es final. Cualquier otra transición → `409 TRANSICION_INVALIDA`.
2. **Pausada:** no aparece en el portal y no recibe donaciones (`409 CAMPANIA_NO_ACTIVA`). El
   refugio sigue revisando las pendientes y Mercado Pago las sigue confirmando. Si aplicar una
   la lleva a la meta, se finaliza en el acto. **Cuenta para el tope de 5** (spec 026 §6.3),
   porque se puede reactivar.
3. **Reactivar** una Pausada que ya venció o llegó a la meta la finaliza en la misma operación,
   con la regla del cron. Quedan registrados los dos pasos.
4. **Editar:** sólo en Inactiva, Activa o Pausada (`409 CAMPANIA_NO_EDITABLE`).
   - Título y descripción con las reglas del alta (spec 026 §6.1).
   - Imagen: jpg/png/webp, ≤5 MB, comprimida. La anterior se borra cuando la nueva queda guardada.
   - Meta: límites del alta y **no menor a lo recaudado** (sólo donaciones Realizada):
     `409 OBJETIVO_MENOR_A_RECAUDADO`. Si queda igual a lo recaudado, la campaña llegó a su meta
     y se finaliza en el acto.
   - Fecha de fin: **posterior a hoy** (no vale hoy) y posterior a la fecha de inicio.
   - Alias, CBU y fecha de inicio: no se modifican (`400`, «El alias no se puede modificar»).
   - Sin ningún cambio: `400 SIN_CAMBIOS`.
   - La escritura es condicional al estado: si el cron u otro miembro la finalizó en el medio,
     `409 CAMPANIA_NO_EDITABLE` y se borra la imagen recién subida.
5. **Eliminar:** baja lógica, en cualquier estado, sólo si la campaña no tiene **ninguna**
   donación, en ningún estado (pendiente, aplicada o rechazada). La condición va dentro del
   mismo UPDATE, así una donación que entra en ese instante no queda colgada de una campaña
   eliminada. Con donaciones: `409 CAMPANIA_CON_DONACIONES`. La imagen no se borra.
6. **Auditoría:** editar (`EDITAR`, con los campos que cambiaron), cambiar de estado y eliminar
   (`ELIMINAR`) escriben `LogAuditoria`.

## 7. Criterios de aceptación

- [ ] Editar título, descripción, imagen, meta y fecha de fin de una Inactiva, Activa o Pausada
      devuelve la campaña actualizada; una Finalizada → 409.
- [ ] Una meta menor a lo recaudado → 409; igual a lo recaudado finaliza la campaña.
- [ ] Una fecha de fin de hoy o anterior → 400.
- [ ] Mandar alias, CBU o fecha de inicio → 400.
- [ ] Pausar una Activa la saca del portal y donar responde 409.
- [ ] Reactivar una Pausada vigente la deja Activa; una vencida queda Finalizada.
- [ ] Finalizar funciona desde Inactiva, Activa y Pausada.
- [ ] Eliminar una campaña sin donaciones la saca de «Mis Campañas» y el detalle responde 404;
      con alguna donación → 409.
- [ ] El cron finaliza una Pausada vencida.
- [ ] Tras la migración no queda ninguna campaña «Cancelada» y el filtro no la ofrece.

## 8. Casos borde y errores

- **Carrera editar ↔ cron:** el UPDATE es condicional al estado; quien llega segundo recibe
  409 (o, si es el cron, la saltea).
- **Carrera eliminar ↔ donar:** la condición «sin donaciones» va en el UPDATE. Si la donación
  entró primero, eliminar responde 409. Si entró después, la campaña ya no existe y donar responde 404.
- **Bajar la meta mientras se aplica una donación:** si con eso el recaudado alcanza la meta, la
  campaña se finaliza por la regla de siempre.
- **Campañas del seed sin imagen:** al editarlas con imagen no hay anterior que borrar.

## 9. Notas y decisiones

1. **2026-10-15 (equipo):** nombre (título) e imagen se modifican en cualquier momento;
   alias y CBU no. La meta se puede modificar siempre que no sea menor a lo juntado. La fecha
   de fin sólo si la nueva es posterior a hoy.
2. **2026-10-15 (equipo):** también se edita la descripción; la fecha de inicio no.
3. **2026-10-15 (equipo):** «Cancelar» pasa a ser «Eliminar», sólo sin ninguna donación.
   Las campañas canceladas existentes pasan a Finalizada.
4. **2026-10-15 (equipo):** estado «Pausada». Sólo se pausa una Activa; desde Pausada se
   reactiva o se finaliza. El cron finaliza una Pausada vencida, igual que una Activa.
5. «Cualquier momento» para editar se interpreta como «mientras la campaña no cerró»:
   editar una Finalizada no cambia nada para los donantes.
6. Eliminar es baja lógica (`CONSTITUTION.md`: nunca DELETE físico).
