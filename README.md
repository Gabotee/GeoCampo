# 🌿 GeoCampo — Plataforma de Gestión de Potreros y Pastoreo

Sistema web completo para productores ganaderos y tamberos que digitaliza la delimitación satelital de potreros, el aforo de pasturas, el seguimiento histórico del rodeo y la rotación oportuna de lotes mediante un semáforo agronómico inteligente.

Diseñado sobre el caso real de referencia de un **tambo de 117 hectáreas en El Arañado, Córdoba**, gestionado por un único perfil de usuario (**Productor / Dueño**).

---

## 🚀 Stack Tecnológico

- **Frontend**: HTML5 + CSS3 + JavaScript (ES6+).
- **Mapa Satelital**: `Leaflet.js` + `Leaflet.draw` + Capa satelital `Esri World Imagery`.
- **Geoprocesamiento**: `Turf.js` (cálculo automático de superficie de polígonos en hectáreas).
- **Backend**: `Node.js` + `Express` (API REST + `node-cron` para monitoreo de lotes).
- **Base de Datos**: `MySQL` (`mysql2/promise` con soporte de `DATABASE_URL` para Railway/Render y motor de persistencia local automático en JSON para desarrollo rápido sin servidor MySQL activo).
- **Seguridad**: Autenticación `JWT`, contraseñas hasheadas con `bcryptjs`, política de complejidad, bloqueo a los 5 intentos fallidos, recuperación/desbloqueo por token, vencimiento cada 6 meses y restricción de no repetir las últimas 3 contraseñas.

---

## 📋 Requisitos Previos

Antes de arrancar el proyecto, asegúrate de tener instalado:

1. **Node.js v18.11 o superior** (recomendado **Node.js v20 LTS** o superior, ya que el modo desarrollo utiliza `node --watch` y las pruebas usan `fetch` nativo).
   - Verificar versión en terminal:
     ```bash
     node -v
     npm -v
     ```
2. **Git** (opcional, si se clona desde un repositorio).
3. **MySQL 8.0+** *(Opcional)*: **No es obligatorio para desarrollo local**, ya que el proyecto cuenta con un motor local de respaldo (`database/local_db.json`) que funciona automáticamente si MySQL no está instalado o corriendo.

---

## 🛠️ Guía Paso a Paso para Arrancar en Modo Desarrollo

### 1. Clonar o abrir el proyecto

Abre una terminal y sitúate en la carpeta raíz del proyecto (`GeoCampo`):

```bash
git clone <URL_DEL_REPOSITORIO>
cd GeoCampo
```
*(Si recibiste el proyecto en un archivo `.zip`, descomprímelo y abre la terminal dentro de la carpeta `GeoCampo`).*

---

### 2. Instalar dependencias

Descarga los paquetes necesarios definidos en `package.json`:

```bash
npm install
```

---

### 3. Configurar las variables de entorno (`.env`)

Crea tu archivo `.env` copiando la plantilla `.env.example`:

- **En Windows (PowerShell o CMD):**
  ```powershell
  copy .env.example .env
  ```
- **En Linux / macOS (o Git Bash):**
  ```bash
  cp .env.example .env
  ```

#### ¿Cómo configurar la Base de Datos en `.env`? (Elige una opción)

* **Opción A — Arranque rápido SIN instalar MySQL (Recomendado para probar rápido):**
  No necesitas tocar nada en el `.env`. Con `DB_FALLBACK_LOCAL=true` (valor por defecto), el sistema detectará que no hay un servidor MySQL activo y usará automáticamente la base de datos local persistente en `database/local_db.json`.

* **Opción B — Conectando a un servidor MySQL local:**
  Asegúrate de tener tu servidor MySQL encendido y edita el archivo `.env` con tus credenciales locales:
  ```env
  DB_HOST=localhost
  DB_PORT=3306
  DB_USER=root
  DB_PASSWORD=tu_password_de_mysql
  DB_NAME=geocampo_db
  DB_FALLBACK_LOCAL=false
  ```

---

### 4. Inicializar / poblar la base de datos (Seed inicial)

Ejecuta el comando de inicialización para crear las tablas (`database/schema.sql`) y cargar los datos de prueba del tambo de 117 ha (`database/seed.sql`):

```bash
npm run db:init
```
> **Nota:** Si usas MySQL, creará la base `geocampo_db`, las tablas y los datos semilla. Si estás en modo local sin MySQL, restaurará `database/local_db.json` a su estado inicial limpio. Puedes volver a correr este comando cuando quieras resetear los datos de prueba.

---

### 5. Levantar el servidor en modo desarrollo

Para iniciar el servidor con **recarga automática** (`--watch`) ante cualquier cambio en el código:

```bash
npm run dev
```

*(Alternativamente, puedes usar `npm start` para correrlo sin recarga automática).*

Verás en consola un mensaje indicando que el servidor está activo. Abre tu navegador en:

👉 **http://localhost:3000**

---

## 🔑 Credenciales de Prueba (Seed Inicial)

Para ingresar al sistema en `http://localhost:3000`:

- **Email**: `productor@elaranado.com`
- **Contraseña**: `Campo2026!`

---

## 📜 Scripts Disponibles en `package.json`

| Comando | Descripción |
| :--- | :--- |
| `npm run dev` | Inicia el servidor en **modo desarrollo** con reinicio automático (`node --watch src/server.js`). |
| `npm start` | Inicia el servidor en modo estándar (`node src/server.js`). |
| `npm run db:init` | Inicializa o reinicia la base de datos (MySQL o `local_db.json`) con el esquema y los datos semilla. |
| `npm run test:api` | Ejecuta la suite automatizada que verifica seguridad y las 10 Historias de Usuario. |

---

## 🩺 Solución de Problemas Comunes (Troubleshooting)

- **El puerto `3000` ya está en uso (`EADDRINUSE`):**
  Abre el archivo `.env` y cambia `PORT=3000` por otro puerto libre (por ejemplo, `PORT=3001`), luego reinicia `npm run dev`.
- **Error `unknown option '--watch'` al correr `npm run dev`:**
  Tu versión de Node.js es antigua (menor a v18.11). Actualiza Node.js a la versión LTS actual o ejecuta el proyecto con `npm start`.
- **La cuenta de prueba se bloqueó tras 5 intentos fallidos:**
  Puedes usar el flujo de *"¿Olvidaste o bloqueaste tu contraseña?"* en la pantalla de login (el token aparece en la consola del servidor si no hay SMTP configurado), o bien reiniciar la base de datos ejecutando `npm run db:init`.

---

## ☁️ Despliegue en Railway o Render

1. Suba el repositorio a GitHub.
2. Cree un servicio **MySQL** en Railway o conecte una base MySQL externa en Render.
3. Configure las siguientes variables de entorno en el panel del hosting:
   - `DATABASE_URL`: URL de conexión provista por Railway/Render (`mysql://user:pass@host:port/db`) — o bien `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`.
   - `DB_FALLBACK_LOCAL`: `false`
   - `JWT_SECRET`: Cadena secreta aleatoria segura.
   - `PORT`: (Asignado automáticamente por Railway/Render).
4. Ejecute por única vez `npm run db:init` (o corra los scripts `database/schema.sql` y `database/seed.sql`) para inicializar las tablas.
5. Comando de inicio: `npm start`.
