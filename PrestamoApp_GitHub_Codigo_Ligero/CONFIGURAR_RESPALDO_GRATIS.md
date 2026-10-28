# PrestamoApp — respaldo sin plan de pago

**Versión 1.1 — Firebase Realtime Database (Spark) + Google Apps Script + Google Sheets + Drive**

El objetivo es que **el guardado principal sea inmediato** cada vez que se confirma una operación en Firebase, y que **otra plataforma independiente** haga copias aunque el teléfono o la web estén cerrados. El script viene incluido en `apps-script/Codigo.gs`. **No está conectado hasta completar estos pasos y verificar la primera copia real.**

## 1. Qué se guarda, dónde y con qué frecuencia

| Capa | Contenido | Frecuencia | Recuperación |
|---|---|---|---|
| Firebase Realtime Database | Todos los negocios, clientes, préstamos, intereses, pagos, capital, auditoría | Cada operación confirmada | Inicio de sesión normal |
| Google Sheets | Pestañas de consulta + hoja técnica `DATOS_JSON` con respaldo íntegro comprimido | Cada 4 h aproximadamente, una vez instalada | Apps Script `exportarCopiaDeSheets()` → descargar JSON → restaurar en PrestamoApp |
| Google Drive | Versiones JSON independientes dentro de la carpeta `PrestamoApp - Copias históricas` | Cuando cambia la revisión, como máximo al ejecutarse el activador; mínimo una por día si las ejecuciones funcionan | Descargar JSON de Drive → restaurar en PrestamoApp |
| Exportación manual | JSON completo de la cuenta | Cuando se pulsa «Descargar JSON» | «Restaurar» desde la propia app |

**Máxima pérdida posible de la copia automática:** con un activador cada cuatro horas puede faltar hasta aproximadamente cuatro horas de cambios si se destruye Firebase antes del próximo respaldo. Las ejecuciones de Apps Script pueden retrasarse o fallar por cuotas, permisos o disponibilidad. **Ningún respaldo es garantía absoluta de cero pérdida.** Para operaciones especialmente importantes descarga un JSON al cerrar el día y comprueba periódicamente las fechas de sincronización.

## 2. Preparar Firebase gratuito

1. Crea o selecciona **un proyecto Firebase propio** con Authentication (Correo/Contraseña) y **Realtime Database**. Si utilizas Spark, verifica que continúas dentro de sus límites gratuitos. Cloud Functions y Cloud Storage **no son necesarios para esta opción**.
2. Pon las variables de configuración del frontend en `.env` tomando como base `.env.example`, e implementa las reglas proporcionadas en `database.rules.json`.
3. Registra una cuenta de prueba, crea un negocio y un cliente. En PrestamoApp abre **Más → Mi cuenta** y copia el **ID de cuenta (UID)**. NO es la contraseña.
4. Anota la URL exacta de Realtime Database. Formatos habituales: `https://<base>.firebasedatabase.app` o `https://<base>.firebaseio.com`. **No confundas el identificador del proyecto con la URL de la base**.

## 3. Preparar una cuenta de servicio privada

1. Desde Firebase Console → **Configuración del proyecto → Cuentas de servicio**, crea/descarga un JSON de cuenta de servicio capaz de leer la Realtime Database. Si tu organización usa claves deshabilitadas por política, usa un método de credenciales administradas en lugar de intentar saltarte esa restricción.
2. Guarda el archivo JSON fuera del proyecto, de los ZIP públicos y de cualquier repositorio Git. Su clave privada puede permitir el acceso a datos sensibles.
3. Crea **un proyecto privado de Google Apps Script de tu propiedad** en <https://script.google.com/>. No publiques el proyecto como una aplicación web ni concedas permiso de edición a otras personas.
4. Copia **todo** el contenido de `apps-script/Codigo.gs` al archivo `Código.gs` de Apps Script.
5. Ve a **Configuración del proyecto → Propiedades de secuencia de comandos** y crea:

| Nombre exacto | Valor |
|---|---|
| `FIREBASE_DATABASE_URL` | URL de la Realtime Database, comenzando con `https://` |
| `FIREBASE_UID` | UID de la cuenta propietaria, visto en PrestamoApp |
| `SERVICE_ACCOUNT_JSON` | Contenido completo del JSON privado de la cuenta de servicio (un solo valor) |

Los valores `SHEET_ID` y `FOLDER_ID` los crea el propio script en la primera instalación. **Nunca pegues la clave JSON en código frontend (`src/`) ni en una variable `VITE_`**, porque se expondría públicamente.

## 4. Instalar la copia automática

1. Dentro de Apps Script, selecciona la función `instalarRespaldo` y presiona **Ejecutar**.
2. Google te pedirá autorizar el acceso del script a Google Sheets, Google Drive, llamadas HTTPS y activadores. Revisa cada permiso y autorízalo únicamente en tu proyecto privado.
3. Apps Script creará una hoja llamada `PrestamoApp - Respaldo`, una carpeta `PrestamoApp - Copias históricas`, y un activador que ejecuta `respaldarAhora` aproximadamente cada **4 horas**, aunque la app esté cerrada.
4. Ejecuta la función `comprobarEstado`. Debe informar un objeto con `status: "ok"`, la revisión y la fecha `at`.
5. Abre PrestamoApp → **Más → Respaldo de información**. Debes ver **“Copia informada”** con fecha real y enlace a la hoja. Si ves “Falta verificar”, no consideres el respaldo activado.
6. Comprueba el activador en la sección **Activadores** de Apps Script y, tras la primera ejecución futura, verifica que la hora haya cambiado. Revisa también **Ejecuciones** para conocer errores.

## 5. Comprobar que sí guarda todo

Con **datos de prueba**, registra:

- Dos negocios distintos.
- Un cliente con dos préstamos activos.
- Un préstamo entregado por Nequi y otro en efectivo.
- Abonos a capital, intereses y combinados.
- Intereses pactados de forma manual para un período.
- Un movimiento de capital adicional.

Ejecuta `respaldarAhora` y revisa las pestañas: `Resumen`, `Negocios`, `Clientes`, `Prestamos`, `Pagos`, `Capital`, `Intereses`, `DATOS_JSON`. La última es técnica y contiene la **copia íntegra**, no debe editarse.

## 6. Recuperar después de una falla

**Desde Drive:** busca la carpeta `PrestamoApp - Copias históricas`, descarga una versión JSON de una fecha anterior y abre PrestamoApp → **Más → Respaldo de información → Restaurar**. Lee el resumen y confirma únicamente si es el archivo correcto.

**Desde Sheets:** en el proyecto privado Apps Script, ejecuta `exportarCopiaDeSheets`. Se generará un nuevo archivo JSON verificado con SHA-256 dentro de la carpeta de copias históricas. Descarga ese archivo y restáuralo desde PrestamoApp.

**Antes de reemplazar los datos** PrestamoApp descarga automáticamente un respaldo local preventivo de lo que estaba guardado. Realiza esta operación solo sobre un entorno de prueba hasta haber comprobado el funcionamiento real con Firebase y Apps Script.

## 7. Costos y seguridad

- Firebase Realtime Database en Spark ofrece cuotas gratuitas, incluyendo **1 GB de datos almacenados** y **10 GB de descargas mensuales** (según documentación consultada en octubre de 2026). Si excedes los límites, la aplicación puede sufrir restricciones; no presupongas capacidad ilimitada.
- Google Apps Script tiene límites de ejecución (por ejemplo, duración máxima de cada ejecución y límite diario de tiempo total); el horario puede variar.
- Google Sheets y Drive también tienen límites de capacidad y cuotas. Las copias históricas consumen tu almacenamiento Drive. **Revisa el uso periódicamente**.
- Los datos incluyen nombres, teléfonos y movimientos financieros. Mantén privadas la hoja, la carpeta y el proyecto Apps Script. Protege tu Google Account con autenticación en dos pasos.
- La cuenta de servicio tiene acceso sensible. Si sospechas filtración de su JSON, revoca o rota la clave de inmediato.
- La funcionalidad se entrega como **código instalable**; no se ha autenticado contra tu cuenta Google ni se ha ejecutado una copia real desde este entorno.

Documentación oficial:

- [Precios y cuotas de Realtime Database](https://firebase.google.com/docs/database/usage/billing)
- [Autenticación REST con cuenta de servicio](https://firebase.google.com/docs/database/rest/auth)
- [Activadores programados Apps Script](https://developers.google.com/apps-script/guides/triggers/installable)
- [Cuotas Apps Script](https://developers.google.com/apps-script/guides/services/quotas)
- [Propiedades de Apps Script](https://developers.google.com/apps-script/guides/properties)

## 8. Método alternativo de pago: desactivado por defecto

El proyecto **conserva** la versión anterior de Firebase Functions + Cloud Storage + Google Sheets OAuth, para el caso de que quieras habilitarla en el futuro. La UI de estas funciones permanece oculta salvo que establezcas `VITE_ENABLE_PAID_BACKUPS=true`; esta opción exige configuración, pruebas y puede requerir Blaze. **No la actives si tu objetivo actual es evitar cargos**.
