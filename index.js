const express = require('express');
const cors = require('cors');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

// Configuración de variables de entorno con fallbacks seguros para desarrollo local
const SECRET_KEY = process.env.SECRET_KEY || 'jokutv_super_secret_hmac_key_2026';
const APP_API_KEY = process.env.APP_API_KEY || 'jokutv_secret_api_key';

// Middlewares
app.use(cors());
app.use(express.json());

// 1. Catálogo base de canales
const CHANNELS = {
  tectv: {
    name: 'TecTV',
    group: 'Públicos Argentina',
    streamUrl: 'https://www.youtube.com/embed/cb12KmMMDJA?si=4ZaXH_ASf5Y_noQ-&amp;controls=0',
  },
  Los_40: {
    name: 'Prueba Los 40',
    group: 'Públicos Argentina',
    streamUrl: 'http://playerservices.streamtheworld.com/api/livestream-redirect/LOS40_ARGENTINAAAC',
  },
};

// 2. Sistema de Tokens HMAC-SHA256 (Validez: 3600 segundos / 60 minutos)
const TOKEN_TTL_SECONDS = 3600;

/**
 * Genera un token HMAC-SHA256 con formato: {expires}.{signature}
 * @param {string} channelKey - Identificador del canal (ej: 'tectv')
 * @returns {string} Token firmado
 */
function generateToken(channelKey) {
  const expires = Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS;
  const payload = `${channelKey}:${expires}`;
  const signature = crypto
    .createHmac('sha256', SECRET_KEY)
    .update(payload)
    .digest('hex');

  return `${expires}.${signature}`;
}

/**
 * Verifica la firma HMAC y la vigencia temporal del token
 * @param {string} channelKey - Identificador del canal
 * @param {string} token - Token recibido en la petición
 * @returns {boolean} True si es válido y no ha expirado
 */
function verifyToken(channelKey, token) {
  if (!token || typeof token !== 'string') return false;

  const parts = token.split('.');
  if (parts.length !== 2) return false;

  const [expiresStr, clientSignature] = parts;
  const expires = parseInt(expiresStr, 10);
  if (isNaN(expires)) return false;

  const now = Math.floor(Date.now() / 1000);
  if (now > expires) {
    // Token vencido
    return false;
  }

  const payload = `${channelKey}:${expires}`;
  const expectedSignature = crypto
    .createHmac('sha256', SECRET_KEY)
    .update(payload)
    .digest('hex');

  // Comparación resistente a ataques de tiempo (timing attack prevention)
  try {
    const clientSigBuf = Buffer.from(clientSignature, 'hex');
    const expectedSigBuf = Buffer.from(expectedSignature, 'hex');

    if (clientSigBuf.length !== expectedSigBuf.length) return false;
    return crypto.timingSafeEqual(clientSigBuf, expectedSigBuf);
  } catch {
    return false;
  }
}

// 3. Caché en memoria y función generadora de la lista M3U
let cachedM3u = null;
let lastGeneratedTime = 0; // Timestamp en milisegundos

/**
 * Construye el contenido del archivo .m3u con URLs firmadas hacia este servidor
 * @param {string} host - Dominio y puerto del servidor (ej: mi-app.onrender.com)
 * @param {string} protocol - Protocolo (http o https)
 * @returns {string} Lista M3U completa
 */
function buildM3uPlaylist(host, protocol) {
  let m3u = '#EXTM3U\n';
  for (const [key, channel] of Object.entries(CHANNELS)) {
    const token = generateToken(key);
    const streamEndpoint = `${protocol}://${host}/play/${key}/index.m3u8?token=${token}`;
    m3u += `#EXTINF:-1 group-title="${channel.group}",${channel.name}\n`;
    m3u += `${streamEndpoint}\n`;
  }
  return m3u;
}

/**
 * Helper para obtener el host y protocolo público respetando proxies inversos (Render / Cloudflare)
 */
function getBaseUrlParts(req) {
  const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'https';
  const host = req.get('host');
  return { protocol, host };
}

// ==========================================
// RUTAS Y ENDPOINTS
// ==========================================

// Endpoint raíz de chequeo
app.get('/', (req, res) => {
  res.json({
    app: 'JokuTV Backend API',
    status: 'online',
    channels: Object.keys(CHANNELS).length,
    cached: cachedM3u !== null,
    cacheAgeSeconds: cachedM3u ? Math.round((Date.now() - lastGeneratedTime) / 1000) : 0,
  });
});

/**
 * 3. Ruta Despertador (/wakeup)
 * Llamada en el minuto 50 desde la app móvil o cron job cuando Render está en reposo.
 * Despierta la instancia gratuita de Render y pre-genera en memoria la lista M3U con tokens frescos.
 */
app.get('/wakeup', (req, res) => {
  const { host, protocol } = getBaseUrlParts(req);

  // Pre-generar en memoria la lista M3U con tokens recién creados
  cachedM3u = buildM3uPlaylist(host, protocol);
  lastGeneratedTime = Date.now();

  res.status(200).json({
    status: 'awake',
    timestamp: lastGeneratedTime,
  });
});

/**
 * 4. Ruta de Lista Dinámica (/playlist.m3u)
 * Protegida por query param ?key=APP_API_KEY.
 * Retorna la lista M3U cacheada si tiene menos de 10 minutos (por /wakeup previo),
 * o genera una lista fresca al instante.
 */
app.get('/playlist.m3u', (req, res) => {
  const clientKey = req.query.key;

  // Validación de seguridad de la API Key
  if (!clientKey || clientKey !== APP_API_KEY) {
    return res.status(401).send('#EXTM3U\n# Acceso no autorizado: API Key invalida o ausente\n');
  }

  const { host, protocol } = getBaseUrlParts(req);
  const now = Date.now();
  const TEN_MINUTES_MS = 10 * 60 * 1000;

  // Si existe en caché y fue generada hace menos de 10 minutos, servir inmediatamente
  if (cachedM3u && now - lastGeneratedTime < TEN_MINUTES_MS) {
    res.setHeader('Content-Type', 'audio/x-mpegurl');
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).send(cachedM3u);
  }

  // De lo contrario, generar una lista nueva en el momento y refrescar caché
  cachedM3u = buildM3uPlaylist(host, protocol);
  lastGeneratedTime = now;

  res.setHeader('Content-Type', 'audio/x-mpegurl');
  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).send(cachedM3u);
});

/**
 * 5. Ruta de Reproducción y Redirección (/play/:channel/index.m3u8)
 * Valida el token HMAC recibido. Si es válido y vigente, redirige (HTTP 302)
 * hacia la señal real del canal (TecTV). Si expiró o es falso, responde 403 Forbidden.
 */
app.get('/play/:channel/index.m3u8', (req, res) => {
  const channelKey = req.params.channel.toLowerCase();
  const token = req.query.token;

  // Verificar si el canal existe en el catálogo
  const channel = CHANNELS[channelKey];
  if (!channel) {
    return res.status(404).send('Canal no encontrado');
  }

  // Verificar la firma y expiración del token
  const isValid = verifyToken(channelKey, token);
  if (!isValid) {
    return res.status(403).send('Forbidden: Token invalido o expirado');
  }

  // Redirección HTTP 302 al stream HLS real
  res.redirect(302, channel.streamUrl);
});

// Inicio del servidor
app.listen(PORT, () => {
  console.log(`[JokuTV Backend] Servidor escuchando en el puerto ${PORT}`);
});
