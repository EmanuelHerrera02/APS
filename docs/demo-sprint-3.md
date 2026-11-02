# Integración y recorrido de demo — Sprint 3

**Revisión:** 2026-11-01  
**Alcance:** US6, US15, US12, US13, US14, US16 y US19.

## Integración verificada

- Backend compilado desde una copia temporal del proyecto para evitar la colisión de archivos de `backend/target` con otro proceso local.
- Migraciones US6 y US15 aplicadas a la base aislada `aeronet-us8-http-db`.
- Pruebas HTTP integradas: US6 7/7, US12 5/5, US13 5/5, US14 3/3 y US16 7/7.
- US15: 6/6 comprobaciones con servidor SMTP falso, incluyendo reintento, contenido del aviso, entrega y exclusión de cambios de precio.
- US19: 200/200 búsquedas y 200/200 reservas; p95 de búsqueda 1301 ms, p95 de reserva 2058 ms; 0 solicitudes fallidas, 0 errores de servidor y sin sobreventa. El informe completo está en [`../tests/load/results/us19-1793565900451.json`](../tests/load/results/us19-1793565900451.json).

Las pruebas de carga desactivaron los workers de correo y documentos para medir el camino de búsqueda y reserva sin esos procesos de fondo. Las pruebas funcionales usaron un SMTP falso para validar notificaciones y reintentos, sin enviar correo real.

### Correcciones posteriores a la revisión del 2026-11-02 (pendientes de ejecutar)

- **US6:** un cambio de período o de días de operación que deja fuera salidas con pasajes emitidos ahora se rechaza con HTTP 409 (antes cancelaba esas salidas y dejaba las compras confirmadas sin vuelo). Nueva comprobación `US6-08`; la prueba pasa a tener 8 comprobaciones.
- **US16:** la deshabilitación y la reactivación se auditan como `user.disabled` y `user.enabled`, separadas de `user.updated`, con los campos modificados en `detalles`. `US16-07` verifica los tres eventos.
- **US19:** el escenario de carga agrega el inicio del pago a la compra web y una fase de 200 compras confirmadas en mostrador por 150 plazas, para probar la sobreventa con competencia real. Se debe ejecutar con los workers activos; ver [`../tests/load/README.md`](../tests/load/README.md).

Los resultados de arriba corresponden a la versión anterior de las pruebas. Hay que volver a ejecutar US6, US16 y US19 antes de la demo.

## Preparación de la demo

1. Iniciar una base aislada con el esquema y datos de prueba del repositorio (`db/01_schema.sql` a `db/03_seed.sql`) y aplicar las migraciones necesarias de Sprint 3 en orden: `db/migrations/20261101_us6_edicion_cancelacion_vuelos.sql` y `db/migrations/20261101_us15_notificaciones_cambios_cancelaciones.sql`.
2. Iniciar el backend apuntando a esa base y el frontend según [`ejecucion-local.md`](ejecucion-local.md). Configurar las cuentas de demostración ADMIN y MOSTRADOR mediante el mecanismo local de cuentas de desarrollo; no usar cuentas ni datos de clientes reales.
3. Iniciar sesión como administrador y tener a mano un vuelo de prueba con una salida futura. Usar un vuelo separado con una compra confirmada y otra compra pendiente para mostrar las restricciones de capacidad y cancelación.
4. Preparar una cuenta de pasajero con compra confirmada y un buzón SMTP de prueba para observar los avisos.

## Recorrido propuesto

1. **Administración de vuelos (US6):** editar horario/precio; mostrar que el importe ya comprado no cambia, que la capacidad no puede quedar debajo de los pasajes vendidos y que no se puede achicar el período dejando afuera una salida con pasajes vendidos. Cancelar una salida con motivo y observar el registro de auditoría.
2. **Avisos al pasajero (US15):** mostrar el correo de cambio con horario anterior/nuevo y el aviso de cancelación con motivo. Hacer notar que un cambio de precio no genera aviso.
3. **Mostrador (US12 y US13):** buscar vuelos, vender en efectivo y con tarjeta de terminal, consultar una compra y reenviar pasajes/factura al correo elegido.
4. **Reportes (US14):** filtrar por vuelo, clase y rango de fechas; contrastar capacidad, vendidos, reservas, disponibles, ocupación y recaudación; descargar CSV. Confirmar que un usuario de mostrador no accede.
5. **Cuentas internas (US16):** crear una cuenta de mostrador, cambiar perfil/datos y deshabilitar una cuenta de prueba; mostrar auditoría y revocación de sesión.
6. **Rendimiento (US19):** presentar el informe JSON de carga y los percentiles p95 junto con el conteo de errores y disponibilidad.

## Evidencia reproducible

Los flujos funcionales se ejecutan con los scripts `tests/http/us6-modificacion-cancelacion.mjs`, `us15-cambios-cancelaciones.mjs`, `us12-venta-mostrador.mjs`, `us13-consulta-reenvio.mjs`, `us14-reportes-ocupacion.mjs` y `us16-cuentas-internas.mjs`. El escenario de carga y sus instrucciones están en [`../tests/load/README.md`](../tests/load/README.md).
