const mysql = require('mysql2/promise');
const dotenv = require('dotenv');
const localDbEngine = require('./localDbEngine');

dotenv.config();

let mysqlPool = null;
let usingLocalFallback = false;
let initialized = false;

/**
 * Crea el pool de conexión MySQL a partir de variables de entorno (Railway, Render o Local)
 */
function createMysqlPool() {
  const connectionUri = process.env.DATABASE_URL || process.env.MYSQL_URL;
  if (connectionUri && connectionUri.trim() !== '') {
    return mysql.createPool({
      uri: connectionUri,
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0,
      dateStrings: true
    });
  }

  return mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'geocampo_db',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    dateStrings: true
  });
}

/**
 * Inicializa y verifica la conexión a MySQL; si no hay un servidor MySQL corriendo
 * localmente y DB_FALLBACK_LOCAL !== 'false', activa el motor relacional local con persistencia JSON.
 */
async function initDatabase() {
  if (initialized) return;

  try {
    mysqlPool = createMysqlPool();
    const conn = await mysqlPool.getConnection();
    await conn.query('SELECT 1');
    conn.release();
    usingLocalFallback = false;
    initialized = true;
    console.log('✅ Conectado exitosamente a la base de datos MySQL.');
  } catch (err) {
    const allowFallback = String(process.env.DB_FALLBACK_LOCAL || 'true').toLowerCase() !== 'false';
    if (allowFallback) {
      usingLocalFallback = true;
      initialized = true;
      console.log(
        `⚠️ Servidor MySQL no detectado en ${process.env.DB_HOST || 'localhost'}:${process.env.DB_PORT || 3306} (${err.code || err.message}).`
      );
      console.log('💾 Activando motor relacional persistente local (database/local_db.json) con el seed de Tambo 117 ha - El Arañado.');
    } else {
      console.error('❌ Error fatal conectando a MySQL:', err.message);
      throw err;
    }
  }
}

async function query(sql, params = []) {
  if (!initialized) {
    await initDatabase();
  }
  if (usingLocalFallback) {
    return localDbEngine.query(sql, params);
  }
  return mysqlPool.query(sql, params);
}

async function getConnection() {
  if (!initialized) {
    await initDatabase();
  }
  if (usingLocalFallback) {
    return localDbEngine.getConnection();
  }
  return mysqlPool.getConnection();
}

function getEngineStatus() {
  return {
    engine: usingLocalFallback ? 'LocalJSON-MySQL-Compatible' : 'MySQL',
    usingLocalFallback
  };
}

module.exports = {
  initDatabase,
  query,
  getConnection,
  getEngineStatus,
  localDbEngine
};
