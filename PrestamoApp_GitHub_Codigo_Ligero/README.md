# Publicar y actualizar desde GitHub

**Lee primero [`GUIA_GITHUB_VERCEL.md`](GUIA_GITHUB_VERCEL.md).** El repositorio guarda versiones del código y se puede conectar a Vercel para desplegar automáticamente cada cambio en `main`. El respaldo financiero de clientes y pagos se configura **por separado**.

---

# PrestamoApp — versión 1.1: cobros flexibles, informes y respaldo gratuito

**Empieza por `CONFIGURAR_RESPALDO_GRATIS.md`.** Esta actualización mantiene el diseño móvil de PrestamoApp y agrega registro de entrega/recibo de dinero por **efectivo, Nequi o transferencia**; interés mensual **automático sobre capital pendiente** o **fijado manualmente por período y con motivo**; varios préstamos activos por cliente; pagos ilimitados que pueden combinar capital/intereses; y reportes mensuales con capital desembolsado, recuperado, intereses cobrados, saldo en la calle, disponibilidad teórica y cobros por medio.

**Opción principal sin Blaze:** Firebase Realtime Database (Spark, sujeto a cuota) + `apps-script/Codigo.gs` ejecutado cada 4 horas por Google Apps Script + Google Sheets + JSON independientes en Google Drive. La conexión real se instala y verifica siguiendo la guía gratuita; no está activada de fábrica. El respaldo JSON manual y su restauración siguen disponibles. La alternativa antigua con Firebase Functions requiere configurar `VITE_ENABLE_PAID_BACKUPS=true` para que aparezca en la interfaz.

**Pruebas:** `npm test` incluye 15 pruebas de lógica financiera. Se comprobó la sintaxis del código, pero **no** se realizó un despliegue, compilación completa de Vite ni una prueba real de Apps Script/Firebase contra tus cuentas. Se recomienda usar datos de ensayo antes de operar.

---

# PrestamoApp — código web móvil (versión inicial)

Aplicación web de administración de préstamos con diseño inspirado en iOS: blanco, azul, tarjetas suaves, botones redondeados e íconos SVG. Incluye **un proyecto frontend React/Vite** y **backend Firebase Functions** para copias diarias, conexión con Google Sheets y recuperación.

> **IMPORTANTE:** El código es una base funcional para instalar, configurar y someter a pruebas. **No está desplegado ni conectado a tus cuentas**. No introduzcas clientes ni cifras reales hasta verificar autenticación, permisos, respaldos, restauración, conciliación y exactitud de saldos con transacciones de prueba. El modo demostración guarda datos en este dispositivo y NO es una solución de respaldo fiable.

## 1. Funciones implementadas

- Portada y autenticación por **correo y contraseña**, recuperación de contraseña, sin inicio de sesión Google.
- **Varios negocios** dentro de una cuenta. Cada negocio separa clientes, préstamos, capital, pagos y reportes.
- Capital inicial editable con registro de corrección, aportes adicionales y retiros limitados al dinero disponible.
- **Capital total = capital inicial + aportes - retiros**. **Dinero disponible = capital total - principal pendiente de todos los préstamos activos**. Los intereses cobrados se registran separadamente, sin mezclarlos con capital invertido.
- Clientes con nombre, teléfono, notas, ficha individual y varios préstamos por persona (cada préstamo independiente).
- Préstamos con principal, tasa mensual, fecha de desembolso, primer vencimiento, modalidad mensual o abonos manuales ilimitados y notas.
- Pago individual dirigido a **un cliente y un préstamo específico**. Puede tener capital, intereses o ambos. Si se paga capital se recalcula el próximo interés mensual sobre principal pendiente; el interés ya causado permanece en su saldo.
- Causación del primer interés al registrar el préstamo y de nuevos intereses en fechas mensuales posteriores, con cálculo automático al abrir la app o en la función diaria.
- Historial de pagos, anulación con motivo y reversión de saldos con control del capital que ya se pudo prestar de nuevo; operación registrada en bitácora.
- Reportes mensuales, cobros, préstamos vigentes, capital e intereses por cobrar.
- Descarga manual JSON y restauración con doble confirmación.
- Copias automáticas **todos los días a las 02:00 de Colombia** con Cloud Scheduler + Firebase Functions (después del despliegue).
- Historial de snapshots JSON GZIP independientes por cuenta en Cloud Storage (con hash SHA-256 para verificarlos).
- Enlace **Google Sheets OAuth** con permiso `drive.file`, archivo del usuario llamado `PrestamoApp - Respaldo`, reutilizado para futuras copias (nunca se necesita crear uno cada día). Pestañas: Resumen, Clientes, Préstamos, Pagos, Capital y DATOS_JSON (respaldo comprimido recuperable).
- **Restauración desde Cloud Storage o Google Sheets** desde la sección Respaldo, con verificación de checksum y copia preventiva anterior a la restauración.
- Los tokens OAuth de renovación se cifran con AES-256-GCM y solo viven en Firestore, con acceso exclusivo del backend.

## 2. Empezar con el diseño de demostración

Necesitas Node.js 22+.

```bash
npm install
npm run dev
```

Abre la URL de Vite en el navegador del celular (para la red local, usa la dirección IP mostrada). Sin variables `VITE_FIREBASE_*`, se inicia como **DEMO LOCAL**. Se incluyen datos de ejemplo y el aviso de que no hay respaldo remoto. Los cambios se guardan en el almacenamiento de ese navegador únicamente.

Para ejecutar las pruebas financieras:

```bash
npm test
```

Para compilar la web:

```bash
npm run build
```

## 3. Activar base de datos real y autenticación

1. Crea un **proyecto Firebase propio** (idealmente separado de cualquier otro negocio); habilita Authentication → proveedor **Correo/Contraseña**.
2. Habilita **Realtime Database**, **Firestore** (para metadatos de respaldo) y **Cloud Storage** (para copias). Configura la ubicación pensando en latencia y legislación aplicable.
3. Crea la aplicación **Web** en Firebase y copia los datos de configuración a un archivo `.env` en la raíz, usando `.env.example`. La URL de Realtime Database debe estar completa y corresponder al proyecto correcto.
4. Instala Firebase CLI y autentícate: `npm install -g firebase-tools`, luego `firebase login`.
5. Asocia este directorio con tu proyecto mediante `firebase use --add` o cambia el proyecto al desplegar: `firebase deploy --project TU_ID --only database,firestore,storage,hosting`.
6. En Firebase Authentication, agrega tus dominios de hosting autorizados.

**También puedes publicar el frontend en Vercel:** configura el repositorio de este proyecto con framework Vite, agrega allí las variables `VITE_FIREBASE_*` y publica usando `vercel.json`. Las Firebase Functions y sus secretos **siguen alojados en Firebase**; en `functions/.env`, `APP_ORIGIN` será tu dominio de Vercel y Google OAuth deberá apuntar al mismo backend. Esto permite usar la interfaz en Vercel y el almacenamiento seguro en Firebase.

Las reglas `database.rules.json` permiten que el usuario autenticado lea y escriba **únicamente los datos de su propio UID**. Las reglas de Firestore y Storage bloquean acceso directo: los respaldos se manejan con el SDK de administrador de las funciones.

## 4. Copias automáticas + Google Sheets (requiere configuración separada)

**La ejecución programada en segundo plano requiere un proyecto Firebase en plan Blaze (facturación activada)** y los servicios Google Cloud correspondientes. Puede generar cargos por funciones, almacenamiento y otros servicios. No se debe suponer que todo este sistema es gratis.

1. En Google Cloud Console, dentro del mismo proyecto, habilita **Google Sheets API** y configura la **pantalla de consentimiento OAuth**. Selecciona los usuarios autorizados y el alcance `https://www.googleapis.com/auth/drive.file`.
2. Crea un cliente **OAuth 2.0 de tipo aplicación web** con URI de redirección autorizada:

   `https://us-central1-TU-PROYECTO.cloudfunctions.net/googleOAuthCallback`

3. Copia `functions/.env.example` a `functions/.env`, reemplaza `APP_ORIGIN`, `GOOGLE_CLIENT_ID` y `GOOGLE_REDIRECT_URI`. `APP_ORIGIN` debe ser la URL final de tu web (por ejemplo, `https://TU-PROYECTO.web.app`).
4. Define los secretos de backend, NO en `.env` de Vite y NO en el frontend:

```bash
firebase functions:secrets:set GOOGLE_CLIENT_SECRET
firebase functions:secrets:set TOKEN_ENCRYPTION_KEY
```

Para `TOKEN_ENCRYPTION_KEY` utiliza una cadena hexadecimal de **64 caracteres** generada con un generador seguro, por ejemplo:

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

5. Instala y despliega las funciones:

```bash
cd functions
npm install
cd ..
firebase deploy --only functions --project TU_ID
```

6. Abre tu aplicación, inicia sesión, ve a **Más → Respaldo y seguridad de los datos → Conectar Google Sheets**, concede el permiso y verifica la fecha y el enlace del archivo. Luego usa **Crear copia en la nube ahora** para validar la configuración.
7. Confirma en Firebase/Google Cloud que el trabajo `scheduledDailyBackup` aparece programado a las **02:00 de Colombia** y que los logs muestran ejecuciones satisfactorias. Revisa que la copia se actualice al día siguiente incluso si no abres la app.

**Atención con la pantalla OAuth en modo Testing:** Google puede emitir tokens de renovación que expiran a los **7 días**. Si se pretende usar la conexión a largo plazo, hay que publicar/configurar correctamente la app OAuth y cumplir los requisitos de Google. Sin esto, no prometas conexión permanente.

Documentación oficial:
- https://firebase.google.com/docs/functions/schedule-functions
- https://developers.google.com/workspace/sheets/api/scopes
- https://developers.google.com/identity/protocols/oauth2

## 5. Opciones de respaldo y recuperación

| Capa | Cada cuánto | Cómo se recupera | Requisitos |
|---|---|---|---|
| Datos principales | Cada operación confirmada | Se leen al iniciar sesión | Firebase Realtime Database + red |
| Copias automáticas JSON comprimidas | Cada día 02:00 (Colombia) | **Respaldo → Recuperar última copia de Storage** | Functions + Scheduler + Storage configurados |
| Google Sheets | Al conectar, diariamente y al ejecutar una copia manual en nube | **Respaldo → Recuperar datos desde Google Sheets** | OAuth conectado, permiso vigente |
| Descarga JSON independiente | Cuando pulsas «Descargar JSON» | **Respaldo → Restaurar** y selecciona el archivo | Tener el archivo guardado |

Todas las restauraciones remotas verifican que el respaldo pertenezca al usuario autenticado. El respaldo JSON contiene información personal y financiera: guárdalo con cuidado, evita compartirlo sin protección. Si hay cualquier error en Sheets, la copia de Storage puede mantenerse correcta; revisa el estado individual de cada canal. **No se garantiza riesgo cero.**

La recuperación desde las pantallas reemplaza la información de **todos los negocios de la cuenta**; no mezcla datos de dos versiones. Antes de restaurar remotamente, el servidor guarda una copia adicional del estado anterior en `backups/<uid>/pre-restore/`.

### Prueba de recuperación recomendada

Registra una cuenta de prueba, un negocio con capital de $5.000.000, un préstamo de $1.000.000, un abono parcial de $200.000 y confirma que quedan $4.200.000 disponibles. Añade $500.000 de capital y confirma que hay $4.700.000 disponibles. Crea una copia en nube, descarga un JSON y **prueba una restauración en una cuenta de pruebas**, verificando saldos y el historial antes de trabajar con cifras reales.

## 6. Modelo financiero: puntos a validar para cada negocio

- Se usa COP entero (sin centavos). Tasa mensual en puntos básicos (20 % se guarda como `2000`).
- Al crear el préstamo se registra un primer interés del mes; el siguiente cargo se registra al llegar la fecha de ciclo mensual siguiente. Los abonos posteriores al capital reducen intereses de ciclos futuros, no anulan intereses pasados.
- Esta es **una política de cálculo configurable** y debe contrastarse con tus contratos y las reglas legales que correspondan: interés simple mensual sobre principal pendiente, sin capitalización del interés y sin recargos automáticos.
- Los pagos pueden hacerse en cualquier número de abonos; los pagos a interés no modifican el capital; los abonos a capital no se contabilizan como ganancias.
- Los pagos se validan para no exceder capital ni interés causado. Si necesitas condonar intereses, cambiar vencimientos o editar un préstamo pasado, se debe diseñar una política de ajustes con trazabilidad antes de hacerlo.
- El historial de operaciones es informativo. Si necesitas auditoría legal inalterable, integración contable o control de roles, agrega validación estricta y un registro inmutable en el servidor.

## 7. Arquitectura

```text
src/main.jsx           Interfaz móvil React
src/style.css          Diseño blanco/azul iOS
src/domain.mjs         Reglas financieras puras y validación
src/firebase.mjs       Configuración Firebase web
functions/index.mjs    Backend OAuth, respaldos diarios, Google Sheets, recuperación
public/favicon.svg     Ícono azul PrestamoApp
*.rules                Seguridad base de datos, Firestore y Storage
README.md              Guía de instalación y límites
```

## 8. Límites de esta versión inicial

- Se ha validado la **sintaxis** y ejecutado pruebas automatizadas de reglas financieras, pero **no** se ha desplegado ni probado contra un proyecto Firebase o una cuenta Google real desde este entorno. Comprueba el flujo OAuth y la restauración de extremo a extremo antes de usar datos sensibles.
- El proceso programado lee las cuentas de una sola vez. Sirve para un MVP con pocas cuentas; si la aplicación va a administrar muchos usuarios, hay que paginar registros y distribuir el trabajo en tareas independientes.
- No contempla acceso de múltiples empleados con roles distintos, conciliación bancaria externa, mora, intereses legales diferenciados, adjuntar contratos o informes fiscales.
- No elimina registros financieros desde la interfaz, para evitar borrar accidentalmente el historial.
- El modo demo es una **maqueta funcional local**, no una base de datos segura para operar un negocio.
