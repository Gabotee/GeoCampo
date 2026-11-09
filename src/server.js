const path = require('path');
const express = require('express');
const cors = require('cors');
const cron = require('node-cron');
const dotenv = require('dotenv');

dotenv.config();

const db = require('./config/db');
const apiRoutes = require('./routes/api.routes');
const { evaluateSemaphoreAndGenerateAlerts } = require('./services/alert.service');

const app = express();
const PORT = Number(process.env.PORT || 3000);

// Middlewares globales
app.use(cors());
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true }));

// Servir archivos estáticos del frontend
const publicPath = path.join(__dirname, '../public');
app.use(express.static(publicPath));

// Rutas REST API
app.use('/api', apiRoutes);

// Healthcheck para Railway / Render
app.get('/health', (req, res) => {
  res.json({
    ok: true,
    service: 'GeoCampo API',
    timestamp: new Date().toISOString(),
    db: db.getEngineStatus()
  });
});

// Redirigir rutas raíz a index.html / login.html
app.get('/', (req, res) => {
  res.sendFile(path.join(publicPath, 'index.html'));
});

// Inicializar base de datos, cron job de HU-008 y servidor HTTP
async function startServer() {
  await db.initDatabase();

  // Chequeo inicial de semáforo y alertas al iniciar el servidor (HU-008)
  await evaluateSemaphoreAndGenerateAlerts();

  // Job programado cada hora para evaluar potreros que pasan a estado ROJO (HU-008)
  cron.schedule('0 * * * *', async () => {
    await evaluateSemaphoreAndGenerateAlerts();
  });

  app.listen(PORT, () => {
    console.log('==================================================================');
    console.log(`🌿 GeoCampo — Plataforma de Gestión de Potreros y Pastoreo`);
    console.log(`🚀 Servidor activo en: http://localhost:${PORT}`);
    console.log(`🔑 Usuario Demo: productor@elaranado.com | Clave: Campo2026!`);
    console.log('==================================================================');
  });
}

if (require.main === module) {
  startServer().catch((err) => {
    console.error('Error iniciando el servidor GeoCampo:', err);
    process.exit(1);
  });
}

module.exports = { app, startServer };
