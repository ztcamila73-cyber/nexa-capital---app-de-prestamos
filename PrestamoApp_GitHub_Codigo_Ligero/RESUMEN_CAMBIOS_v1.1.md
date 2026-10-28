# PrestamoApp 1.1 — cambios solicitados

Las tres imágenes recibidas están en `referencias_visuales/diseno_final/` y se usan como referencia de diseño para el código web React/Vite.

| Pantalla | Funcionalidad incorporada |
|---|---|
| Inicio | Separación por negocio, capital total/disponible/prestado y accesos rápidos con iconos SVG. |
| Mis negocios | Crear, cambiar y editar varios negocios en una sola cuenta; cada uno con clientes, capital y préstamos propios. |
| Clientes | Ficha individual y cualquier cantidad de préstamos activos simultáneamente. |
| Nuevo préstamo | Interés porcentual mensual automático o pactado manualmente; forma de pago mensual o abonos; entrega por efectivo, Nequi o transferencia y referencia opcional. |
| Detalle del préstamo | Capital pagado/restante, intereses pagados/pendientes, abonos, anulación con razón, fijación manual de interés por período. |
| Cobros | Selección de cliente y préstamo específico, fecha, múltiples pagos mixtos, capital, interés, medio de recaudo. |
| Capital | Aportes y retiros manuales, con fecha, método, nota e historial. |
| Reportes | Selección mensual, desembolsos, capital recaudado, intereses recaudados, capital pendiente, disponible, movimientos de capital, flujo de caja registrado y canales de pago. |
| Notificaciones | Avisos **dentro de la app** de vencimientos, pagos y errores de respaldo; se pueden marcar como leídos. **No** están implementadas notificaciones push del sistema. |
| Respaldo | Base Firebase; Apps Script gratuito programado + Sheets actualizado + versiones JSON Drive + descarga/restauración manual. La integración necesita configurarse. |

## Límites importantes

- Google Sheets NO queda enlazado solo por descargar el ZIP; se debe instalar el script privado y verificar que creó una copia.
- El respaldo programado cada cuatro horas puede dejar una ventana de cambios sin copia independiente de hasta unas cuatro horas o más si hay incidencias.
- Las ganancias mostradas son **intereses cobrados brutos**. Sin registrar gastos/impuestos ni conciliación de efectivo/Nequi/banco no se debe interpretar la cifra como utilidad neta ni saldo bancario real.
- La política de interés mensual sobre capital pendiente es una regla de negocio parametrizada, no una validación del cumplimiento legal de tasa/intereses. Comprueba las normas aplicables antes de operar.
- React JSX y scripts validados a nivel sintáctico; 15 pruebas de dominio completadas. Aún falta compilar/desplegar y probar extremo a extremo en Firebase y Google Apps Script reales.

## Archivo para empezar

`CONFIGURAR_RESPALDO_GRATIS.md` detalla instalación segura del respaldo, controles y recuperación. Después de instalar dependencias de Node puedes usar `npm test`, `npm run dev`, `npm run build`.
