# PrestamoApp: guardar el código en GitHub y publicar en Vercel

**Objetivo:** usar un solo repositorio GitHub (`prestamoapp`) y un solo proyecto Vercel. Cada cambio confirmado en la rama `main` crea una nueva publicación, sin abrir otro proyecto ni cambiar la dirección web.

## 1. Tu copia del código

- Crea un repositorio **privado** en GitHub, por ejemplo `prestamoapp`.
- Sube **el contenido** de la carpeta `PrestamoApp` (no solamente el archivo ZIP).
- El ZIP entregado está preparado para subirlo a un repositorio. Incluye el código, las pruebas, el favicon y las tres imágenes de diseño final en `referencias_visuales/diseno_final/`.
- GitHub conserva las versiones del código; **no sustituye** el respaldo de la información financiera de tus clientes, que depende de Firebase y de las copias a Drive/Sheets configuradas y verificadas aparte.

### Forma A: GitHub desde el navegador

1. En GitHub selecciona **New repository** → `prestamoapp` → **Private** → Create repository.
2. Descomprime el ZIP en tu computador.
3. En el repositorio elige **Add file → Upload files**. Arrastra **el contenido** de la carpeta del proyecto, manteniendo su estructura; confirma la subida a `main`.
4. Cuando cambies archivos, súbelos al mismo repositorio y confirma los cambios. No crees uno nuevo.

> Si GitHub no acepta correctamente una carpeta con subcarpetas desde el navegador, usa Git en el computador (Forma B), para preservar la estructura de `src/`, `public/`, etc.

### Forma B: Git desde tu computador (recomendada)

Abre una terminal en la carpeta donde quedó `package.json`:

```bash
git init -b main
git add .
git commit -m "PrestamoApp: base movil y respaldos"
git remote add origin https://github.com/TU_USUARIO/prestamoapp.git
git push -u origin main
```

Si ya tenías un repositorio creado y conectado, no vuelvas a ejecutar `git init` ni `git remote add`. Para actualizaciones:

```bash
git add .
git commit -m "Mejoras de PrestamoApp"
git push origin main
```

**Alternativa:** si recibiste el archivo `.bundle`, puedes crear una copia con historial local mediante `git clone PrestamoApp_historial_git.bundle PrestamoApp` y luego añadir el remoto GitHub. El ZIP normal es el que debe usarse para subir el código desde el navegador.

## 2. Conectar el mismo repositorio con Vercel

1. En Vercel, selecciona **Add New → Project**.
2. Importa el repositorio GitHub `prestamoapp`.
3. En **Framework Preset** selecciona **Vite**.
4. **Root Directory**: `./` (la carpeta raíz que contiene `package.json`).
5. **Build command**: `npm run build`.
6. **Output directory**: `dist`.
7. En **Environment Variables**, configura las variables `VITE_FIREBASE_*` listadas en `.env.example` con los valores de **tu proyecto** de Firebase. Configura el mismo juego de variables para Production; si usarás Preview, configura también Preview.
8. Pulsa **Deploy**. La primera publicación crea la URL del proyecto.

En adelante, cuando hagas `git push origin main`, Vercel detectará el cambio y actualizará **el mismo proyecto y dominio**. Las otras ramas pueden crear previews independientes.

> Importante: Vercel publica la interfaz React; NO instala automáticamente Firebase, Google Apps Script, ni las reglas de Firebase. Consulta `README.md` y `CONFIGURAR_RESPALDO_GRATIS.md` antes de usar datos reales.

## 3. Protección del código y los datos

- **Nunca subas** `.env`, contraseñas, `SERVICE_ACCOUNT_JSON`, claves privadas, tokens, archivos JSON de clientes ni copias de seguridad con información real.
- El archivo `.gitignore` excluye esos tipos de archivos y también `node_modules/` y `dist/`.
- Guarda la cuenta de servicio **solo en las propiedades privadas de Apps Script**, no en el repositorio y nunca en variables `VITE_*` de Vercel.
- Usa autenticación y reglas seguras de Firebase; comprueba que una cuenta no vea los datos de otra.
- Antes de usar PrestamoApp con dinero real, prueba el inicio de sesión, el registro de préstamos y pagos, el respaldo programado y la restauración desde una cuenta de ensayo.
- **GitHub conserva tu código, pero no guarda automáticamente la base de datos.** El respaldo de Sheets y Drive necesita configuración inicial y seguimiento de su última sincronización.

## 4. Si hay un error en una actualización

En GitHub abre la pestaña **Commits** para ver el historial y recuperar una versión anterior. Vercel también permite revisar despliegues anteriores. Volver a una versión de código no revierte los registros de dinero guardados en Firebase.

## 5. Comprobación del proyecto

```bash
npm install
npm test
npm run build
```

El frontend está preparado para Vercel. Se probaron las funciones financieras con Node.js, pero la compilación con dependencias completas y el despliegue real deberán comprobarse en una máquina con acceso al registro npm o en Vercel. Nunca se debe considerar conectada una cuenta externa que no haya sido autorizada y verificada.
