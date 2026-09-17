# Specs — flujo spec-driven

Cada módulo tiene una spec numerada que se escribe y aprueba ANTES de codificar. La spec es el contrato entre backend y frontend: si no está en la spec, no se implementa; si hace falta cambiarla, se cambia la spec primero (en el mismo PR).

## Ciclo de vida de una spec

`BORRADOR → EN REVISIÓN → APROBADA → IMPLEMENTADA`

1. **Borrador:** un integrante la redacta con `SPEC_TEMPLATE.md`, basándose en REQUISITOS.md, MODELO_DATOS.md y las historias de usuario de la carpeta.
2. **Revisión:** el equipo la revisa en la weekly (o por PR).
3. **Aprobada:** se puede empezar a codificar. Backend y frontend trabajan en paralelo contra los contratos de API definidos.
4. **Implementada:** el módulo pasó la DoD (ver CONSTITUTION.md).

## Índice

| Nº | Spec | Sprint | Estado |
|---|---|---|---|
| 001 | Gestión de Perfiles y Autenticación | 1 | BORRADOR |
| 002 | Publicación de Mascotas | 2 | pendiente |
| 003 | Adopción y Favoritos | 3 | BORRADOR |
| 004 | Chat y Notificaciones | 4 | pendiente |
| 005 | Historia Clínica (HU-8.1 a HU-8.4) | 5 | APROBADA |
| 006 | Hogares de Tránsito y Reputación | 6 | pendiente |
| 007 | Campañas, Padrinazgos y Perdidos | 7 | pendiente |
| 008 | Panel Admin y Moderación | 8 | pendiente |
| 009 | Dashboards y Reportes (Admin) | 12 | APROBADA |
| 010 | Dashboard de Refugio | 12 | APROBADA |
| 011 | Seguimiento Post-Adopción (HU-9.1, HU-9.2) | 7 | APROBADA |
