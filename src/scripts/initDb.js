const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const dotenv = require('dotenv');
const localDbEngine = require('../config/localDbEngine');

dotenv.config();

async function initDb() {
  const schemaPath = path.join(__dirname, '../../database/schema.sql');
  const seedPath = path.join(__dirname, '../../database/seed.sql');

  const schemaSql = fs.readFileSync(schemaPath, 'utf8');
  const seedSql = fs.readFileSync(seedPath, 'utf8');

  try {
    const uri = process.env.DATABASE_URL || process.env.MYSQL_URL;
    const conn = uri
      ? await mysql.createConnection({ uri, multipleStatements: true })
      : await mysql.createConnection({
          host: process.env.DB_HOST || 'localhost',
          port: Number(process.env.DB_PORT || 3306),
          user: process.env.DB_USER || 'root',
          password: process.env.DB_PASSWORD || '',
          multipleStatements: true
        });

    console.log('Ejecutando database/schema.sql en MySQL...');
    await conn.query(schemaSql);
    console.log('Ejecutando database/seed.sql en MySQL...');
    await conn.query(seedSql);
    await conn.end();
    console.log('✅ Base de datos MySQL inicializada correctamente con el caso real (Tambo 117 ha - El Arañado).');
  } catch (err) {
    console.log(`⚠️ MySQL no disponible localmente (${err.code || err.message}). Inicializando base de datos local con datos semilla...`);
    localDbEngine.resetToSeed();
    console.log('✅ Base de datos local (database/local_db.json) inicializada con éxito.');
  }
}

initDb();
