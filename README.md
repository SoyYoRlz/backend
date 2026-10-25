# JokuTV Backend (Node.js + Express)

Servidor backend ligero diseñado para desplegarse en el **plan gratuito de Render.com**. Proporciona un catálogo de canales, rotación de tokens de seguridad HMAC-SHA256 y un mecanismo de precalentamiento (`/wakeup`) para mitigar el reposo de Render.

---

## 🚀 Despliegue en Render.com (Paso a Paso)

1. **Subir al repositorio:** Asegúrate de que la carpeta `backend` esté en tu repositorio de GitHub.
2. **Crear Web Service en Render:**
   - Entra en [dashboard.render.com](https://dashboard.render.com) y pulsa **New + > Web Service**.
   - Conecta tu repositorio de GitHub.
   - **Root Directory:** Pon `backend` (o déjalo vacío si subes solo la carpeta backend a un repo independiente).
   - **Runtime:** `Node`.
   - **Build Command:** `npm install`.
   - **Start Command:** `node index.js`.
   - **Instance Type:** `Free`.
3. **Variables de Entorno (Environment Variables):**
   - `SECRET_KEY`: Una cadena secreta larga y aleatoria para firmar los tokens HMAC (ej: `jokutv_prod_secret_2026_xyz`).
   - `APP_API_KEY`: Clave que tu app móvil enviará para solicitar la playlist (ej: `mi_clave_secreta_app_2026`).

---

## 📡 Endpoints Disponibles

| Método | Endpoint | Descripción |
| :--- | :--- | :--- |
| `GET` | `/` | Estado del servicio y tiempo de vida de la caché en memoria. |
| `GET` | `/wakeup` | Despierta la instancia de Render y pre-genera la lista M3U con tokens frescos recién firmados. |
| `GET` | `/playlist.m3u?key=APP_API_KEY` | Devuelve la lista en formato M3U con cabeceras `audio/x-mpegurl` y `Cache-Control: no-store`. |
| `GET` | `/play/:channel/index.m3u8?token=...` | Valida el token HMAC y redirige (HTTP 302) al flujo HLS real de TecTV (o 403 Forbidden). |
