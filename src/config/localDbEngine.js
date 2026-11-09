const fs = require('fs');
const path = require('path');

const DB_FILE = path.join(__dirname, '../../database/local_db.json');

/**
 * Datos semilla idénticos a database/seed.sql
 * Solo incluye la cuenta de acceso del Productor, sin establecimientos ni potreros preconfigurados.
 */
function createInitialSeedData() {
  const initialHash = '$2a$10$o1Pk7DI4saEnJEiHDrdVjuM.sWMfgFSR1oN6VqF8pZMaHTj7EYRa2'; // Campo2026!
  const nowIso = new Date().toISOString();

  return {
    Productor: [
      {
        id_productor: 1,
        nombre: 'Juan Carlos Giordano (Productor)',
        email: 'productor@elaranado.com',
        contrasena_hash: initialHash,
        intentos_fallidos: 0,
        bloqueado: 0,
        token_recuperacion: null,
        token_expiracion: null,
        fecha_ultimo_cambio_clave: nowIso,
        rol: 'productor',
        activo: 1
      }
    ],
    Historial_Contrasena: [
      {
        id_historial_clave: 1,
        id_productor: 1,
        contrasena_hash: initialHash,
        fecha_creacion: nowIso
      }
    ],
    Establecimiento: [],
    Potrero: [],
    Rodeo: [],
    Historial_Rodeo: [],
    Uso_Potrero: [],
    Notificacion: []
  };
}

class LocalDbEngine {
  constructor() {
    this.data = null;
    this.load();
  }

  load() {
    try {
      if (fs.existsSync(DB_FILE)) {
        const raw = fs.readFileSync(DB_FILE, 'utf8');
        this.data = JSON.parse(raw);
      } else {
        this.resetToSeed();
      }
    } catch (err) {
      console.error('Error leyendo local_db.json, regenerando seed:', err.message);
      this.resetToSeed();
    }
  }

  resetToSeed() {
    this.data = createInitialSeedData();
    this.save();
  }

  save() {
    const dir = path.dirname(DB_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(DB_FILE, JSON.stringify(this.data, null, 2), 'utf8');
  }

  nextId(tableName, pkName) {
    const rows = this.data[tableName] || [];
    if (rows.length === 0) return 1;
    return Math.max(...rows.map((r) => Number(r[pkName]) || 0)) + 1;
  }

  /**
   * Ejecuta consultas SQL parametrizadas del sistema sobre las tablas en memoria/JSON
   * manteniendo total compatibilidad con el formato de respuesta de mysql2/promise: [rows, fields]
   */
  async query(sql, params = []) {
    const normalized = sql.replace(/\s+/g, ' ').trim();
    const upper = normalized.toUpperCase();

    if (upper === 'SELECT 1') {
      return [[{ 1: 1 }], []];
    }

    // ========================================================================
    // 1. PRODUCTOR & HISTORIAL_CONTRASENA
    // ========================================================================
    if (upper.startsWith('SELECT * FROM PRODUCTOR WHERE EMAIL = ?')) {
      const email = String(params[0] || '').toLowerCase();
      const rows = this.data.Productor.filter((p) => p.email.toLowerCase() === email);
      return [rows, []];
    }

    if (upper.startsWith('SELECT * FROM PRODUCTOR WHERE ID_PRODUCTOR = ?')) {
      const id = Number(params[0]);
      const rows = this.data.Productor.filter((p) => Number(p.id_productor) === id);
      return [rows, []];
    }

    if (upper.startsWith('SELECT * FROM PRODUCTOR WHERE TOKEN_RECUPERACION = ?')) {
      const token = String(params[0] || '');
      const rows = this.data.Productor.filter((p) => p.token_recuperacion && p.token_recuperacion === token);
      return [rows, []];
    }

    if (upper.startsWith('UPDATE PRODUCTOR SET INTENTOS_FALLIDOS = ?, BLOQUEADO = ? WHERE ID_PRODUCTOR = ?')) {
      const [intentos, bloqueado, id] = params;
      let affectedRows = 0;
      this.data.Productor.forEach((p) => {
        if (Number(p.id_productor) === Number(id)) {
          p.intentos_fallidos = Number(intentos);
          p.bloqueado = bloqueado ? 1 : 0;
          affectedRows++;
        }
      });
      this.save();
      return [{ affectedRows }, []];
    }

    if (upper.startsWith('UPDATE PRODUCTOR SET INTENTOS_FALLIDOS = 0 WHERE ID_PRODUCTOR = ?')) {
      const id = Number(params[0]);
      let affectedRows = 0;
      this.data.Productor.forEach((p) => {
        if (Number(p.id_productor) === id) {
          p.intentos_fallidos = 0;
          affectedRows++;
        }
      });
      this.save();
      return [{ affectedRows }, []];
    }

    if (upper.startsWith('UPDATE PRODUCTOR SET TOKEN_RECUPERACION = ?, TOKEN_EXPIRACION = ? WHERE ID_PRODUCTOR = ?')) {
      const [token, exp, id] = params;
      let affectedRows = 0;
      this.data.Productor.forEach((p) => {
        if (Number(p.id_productor) === Number(id)) {
          p.token_recuperacion = token;
          p.token_expiracion = exp instanceof Date ? exp.toISOString() : exp;
          affectedRows++;
        }
      });
      this.save();
      return [{ affectedRows }, []];
    }

    if (upper.startsWith('UPDATE PRODUCTOR SET CONTRASENA_HASH = ?, INTENTOS_FALLIDOS = 0, BLOQUEADO = FALSE, TOKEN_RECUPERACION = NULL, TOKEN_EXPIRACION = NULL, FECHA_ULTIMO_CAMBIO_CLAVE = NOW() WHERE ID_PRODUCTOR = ?')) {
      const [hash, id] = params;
      let affectedRows = 0;
      this.data.Productor.forEach((p) => {
        if (Number(p.id_productor) === Number(id)) {
          p.contrasena_hash = hash;
          p.intentos_fallidos = 0;
          p.bloqueado = 0;
          p.token_recuperacion = null;
          p.token_expiracion = null;
          p.fecha_ultimo_cambio_clave = new Date().toISOString();
          affectedRows++;
        }
      });
      this.save();
      return [{ affectedRows }, []];
    }

    if (upper.startsWith('SELECT * FROM HISTORIAL_CONTRASENA WHERE ID_PRODUCTOR = ? ORDER BY FECHA_CREACION DESC LIMIT ?')) {
      const [id, limit] = params;
      const rows = this.data.Historial_Contrasena
        .filter((h) => Number(h.id_productor) === Number(id))
        .sort((a, b) => new Date(b.fecha_creacion) - new Date(a.fecha_creacion))
        .slice(0, Number(limit));
      return [rows, []];
    }

    if (upper.startsWith('INSERT INTO HISTORIAL_CONTRASENA (ID_PRODUCTOR, CONTRASENA_HASH, FECHA_CREACION) VALUES (?, ?, NOW())')) {
      const [id_productor, contrasena_hash] = params;
      const insertId = this.nextId('Historial_Contrasena', 'id_historial_clave');
      this.data.Historial_Contrasena.push({
        id_historial_clave: insertId,
        id_productor: Number(id_productor),
        contrasena_hash,
        fecha_creacion: new Date().toISOString()
      });
      this.save();
      return [{ insertId, affectedRows: 1 }, []];
    }

    // ========================================================================
    // 2. ESTABLECIMIENTO (HU-001)
    // ========================================================================
    if (upper.startsWith('SELECT * FROM ESTABLECIMIENTO WHERE ID_PRODUCTOR = ?')) {
      const id = Number(params[0]);
      const rows = this.data.Establecimiento
        .filter((e) => Number(e.id_productor) === id)
        .sort((a, b) => Number(a.id_establecimiento) - Number(b.id_establecimiento));
      return [rows, []];
    }

    if (upper.startsWith('SELECT * FROM ESTABLECIMIENTO WHERE ID_ESTABLECIMIENTO = ?')) {
      const id = Number(params[0]);
      const idProd = params[1] !== undefined ? Number(params[1]) : null;
      const rows = this.data.Establecimiento.filter(
        (e) => Number(e.id_establecimiento) === id && (idProd === null || Number(e.id_productor) === idProd)
      );
      return [rows, []];
    }

    if (upper.startsWith('INSERT INTO ESTABLECIMIENTO')) {
      const [id_productor, nombre, ubicacion_lat, ubicacion_lng, poligono, superficie_total_ha] = params;
      const insertId = this.nextId('Establecimiento', 'id_establecimiento');
      const parsedPoligono = typeof poligono === 'string' ? JSON.parse(poligono) : poligono;
      this.data.Establecimiento.push({
        id_establecimiento: insertId,
        id_productor: Number(id_productor),
        nombre,
        ubicacion_lat: Number(ubicacion_lat),
        ubicacion_lng: Number(ubicacion_lng),
        poligono: parsedPoligono,
        superficie_total_ha: Number(superficie_total_ha)
      });
      this.save();
      return [{ insertId, affectedRows: 1 }, []];
    }

    if (upper.startsWith('UPDATE ESTABLECIMIENTO SET NOMBRE = ?, UBICACION_LAT = ?, UBICACION_LNG = ?, POLIGONO = ?, SUPERFICIE_TOTAL_HA = ? WHERE ID_ESTABLECIMIENTO = ?')) {
      const [nombre, ubicacion_lat, ubicacion_lng, poligono, superficie_total_ha, id_establecimiento] = params;
      const parsedPoligono = typeof poligono === 'string' ? JSON.parse(poligono) : poligono;
      let affectedRows = 0;
      this.data.Establecimiento.forEach((e) => {
        if (Number(e.id_establecimiento) === Number(id_establecimiento)) {
          e.nombre = nombre;
          e.ubicacion_lat = Number(ubicacion_lat);
          e.ubicacion_lng = Number(ubicacion_lng);
          e.poligono = parsedPoligono;
          e.superficie_total_ha = Number(superficie_total_ha);
          affectedRows++;
        }
      });
      this.save();
      return [{ affectedRows }, []];
    }

    if (upper.startsWith('DELETE FROM ESTABLECIMIENTO WHERE ID_ESTABLECIMIENTO = ?')) {
      const id = Number(params[0]);
      const before = this.data.Establecimiento.length;
      this.data.Establecimiento = this.data.Establecimiento.filter((e) => Number(e.id_establecimiento) !== id);
      const affectedRows = before - this.data.Establecimiento.length;
      if (affectedRows > 0) {
        const potIds = this.data.Potrero
          .filter((p) => Number(p.id_establecimiento) === id)
          .map((p) => Number(p.id_potrero));
        this.data.Potrero = this.data.Potrero.filter((p) => Number(p.id_establecimiento) !== id);
        const usosIds = this.data.Uso_Potrero
          .filter((u) => potIds.includes(Number(u.id_potrero)))
          .map((u) => Number(u.id_uso_potrero));
        this.data.Uso_Potrero = this.data.Uso_Potrero.filter((u) => !potIds.includes(Number(u.id_potrero)));
        this.data.Notificacion = this.data.Notificacion.filter((n) => !usosIds.includes(Number(n.id_uso_potrero)));
      }
      this.save();
      return [{ affectedRows }, []];
    }

    // ========================================================================
    // 3. POTREROS (HU-002, HU-003, HU-007)
    // ========================================================================
    if (upper.startsWith('SELECT * FROM POTRERO WHERE ID_ESTABLECIMIENTO IN')) {
      const ids = params.map(Number);
      const rows = this.data.Potrero
        .filter((p) => ids.includes(Number(p.id_establecimiento)))
        .sort((a, b) => Number(a.id_potrero) - Number(b.id_potrero));
      return [rows, []];
    }

    if (upper.startsWith('SELECT * FROM POTRERO WHERE ID_ESTABLECIMIENTO = ? ORDER BY ID_POTRERO ASC')) {
      const id = Number(params[0]);
      const rows = this.data.Potrero
        .filter((p) => Number(p.id_establecimiento) === id)
        .sort((a, b) => Number(a.id_potrero) - Number(b.id_potrero));
      return [rows, []];
    }

    if (upper.startsWith('SELECT * FROM POTRERO WHERE ID_POTRERO = ?')) {
      const id = Number(params[0]);
      const rows = this.data.Potrero.filter((p) => Number(p.id_potrero) === id);
      return [rows, []];
    }

    if (upper.startsWith('INSERT INTO POTRERO')) {
      const [
        id_establecimiento,
        nombre,
        poligono,
        superficie_ha,
        tipo_pastura,
        disponibilidad_kg_ms_ha,
        porcentaje_aprovechable,
        observaciones,
        estado_actual
      ] = params;
      const insertId = this.nextId('Potrero', 'id_potrero');
      const parsedPoligono = typeof poligono === 'string' ? JSON.parse(poligono) : poligono;
      this.data.Potrero.push({
        id_potrero: insertId,
        id_establecimiento: Number(id_establecimiento),
        nombre,
        poligono: parsedPoligono,
        superficie_ha: Number(superficie_ha),
        tipo_pastura: tipo_pastura || 'Sin especificar',
        disponibilidad_kg_ms_ha: Number(disponibilidad_kg_ms_ha || 0),
        porcentaje_aprovechable: Number(porcentaje_aprovechable ?? 70),
        observaciones: observaciones || '',
        estado_actual: estado_actual || 'disponible'
      });
      this.save();
      return [{ insertId, affectedRows: 1 }, []];
    }

    if (upper.startsWith('UPDATE POTRERO SET NOMBRE = ?, POLIGONO = ?, SUPERFICIE_HA = ?, TIPO_PASTURA = ?, DISPONIBILIDAD_KG_MS_HA = ?, PORCENTAJE_APROVECHABLE = ?, OBSERVACIONES = ?, ESTADO_ACTUAL = ? WHERE ID_POTRERO = ?')) {
      const [
        nombre,
        poligono,
        superficie_ha,
        tipo_pastura,
        disponibilidad_kg_ms_ha,
        porcentaje_aprovechable,
        observaciones,
        estado_actual,
        id_potrero
      ] = params;
      const parsedPoligono = typeof poligono === 'string' ? JSON.parse(poligono) : poligono;
      let affectedRows = 0;
      this.data.Potrero.forEach((p) => {
        if (Number(p.id_potrero) === Number(id_potrero)) {
          p.nombre = nombre;
          p.poligono = parsedPoligono;
          p.superficie_ha = Number(superficie_ha);
          p.tipo_pastura = tipo_pastura;
          p.disponibilidad_kg_ms_ha = Number(disponibilidad_kg_ms_ha);
          p.porcentaje_aprovechable = Number(porcentaje_aprovechable);
          p.observaciones = observaciones;
          p.estado_actual = estado_actual;
          affectedRows++;
        }
      });
      this.save();
      return [{ affectedRows }, []];
    }

    if (upper.startsWith('UPDATE POTRERO SET ESTADO_ACTUAL = ? WHERE ID_POTRERO = ?')) {
      const [estado_actual, id_potrero] = params;
      let affectedRows = 0;
      this.data.Potrero.forEach((p) => {
        if (Number(p.id_potrero) === Number(id_potrero)) {
          p.estado_actual = estado_actual;
          affectedRows++;
        }
      });
      this.save();
      return [{ affectedRows }, []];
    }

    if (upper.startsWith('DELETE FROM POTRERO WHERE ID_POTRERO = ?')) {
      const id = Number(params[0]);
      const before = this.data.Potrero.length;
      this.data.Potrero = this.data.Potrero.filter((p) => Number(p.id_potrero) !== id);
      const affectedRows = before - this.data.Potrero.length;
      if (affectedRows > 0) {
        const usosIds = this.data.Uso_Potrero
          .filter((u) => Number(u.id_potrero) === id)
          .map((u) => Number(u.id_uso_potrero));
        this.data.Uso_Potrero = this.data.Uso_Potrero.filter((u) => Number(u.id_potrero) !== id);
        this.data.Notificacion = this.data.Notificacion.filter((n) => !usosIds.includes(Number(n.id_uso_potrero)));
      }
      this.save();
      return [{ affectedRows }, []];
    }

    // ========================================================================
    // 4. RODEO & HISTORIAL_RODEO (HU-004)
    // ========================================================================
    if (upper.startsWith('SELECT * FROM RODEO ORDER BY ID_RODEO ASC')) {
      const rows = [...this.data.Rodeo].sort((a, b) => Number(a.id_rodeo) - Number(b.id_rodeo));
      return [rows, []];
    }

    if (upper.startsWith('UPDATE RODEO SET ID_ESTABLECIMIENTO = ? WHERE ID_ESTABLECIMIENTO = ?')) {
      const [newEstId, oldEstId] = params;
      let affectedRows = 0;
      this.data.Rodeo.forEach((r) => {
        if (Number(r.id_establecimiento) === Number(oldEstId)) {
          r.id_establecimiento = Number(newEstId);
          affectedRows++;
        }
      });
      this.save();
      return [{ affectedRows }, []];
    }

    if (upper.startsWith('SELECT * FROM RODEO WHERE ID_ESTABLECIMIENTO = ?')) {
      const id = Number(params[0]);
      const rows = this.data.Rodeo.filter((r) => Number(r.id_establecimiento) === id);
      return [rows, []];
    }

    if (upper.startsWith('SELECT * FROM RODEO WHERE ID_RODEO = ?')) {
      const id = Number(params[0]);
      const rows = this.data.Rodeo.filter((r) => Number(r.id_rodeo) === id);
      return [rows, []];
    }

    if (upper.startsWith('INSERT INTO RODEO')) {
      const [
        id_establecimiento,
        cant_vacas_ordene,
        cant_vacas_secas,
        cant_vaquillonas,
        cant_terneras,
        consumo_diario_prom_kg_ms
      ] = params;
      const insertId = this.nextId('Rodeo', 'id_rodeo');
      this.data.Rodeo.push({
        id_rodeo: insertId,
        id_establecimiento: Number(id_establecimiento),
        cant_vacas_ordene: Number(cant_vacas_ordene),
        cant_vacas_secas: Number(cant_vacas_secas),
        cant_vaquillonas: Number(cant_vaquillonas),
        cant_terneras: Number(cant_terneras),
        consumo_diario_prom_kg_ms: Number(consumo_diario_prom_kg_ms),
        fecha_actualizacion: new Date().toISOString()
      });
      this.save();
      return [{ insertId, affectedRows: 1 }, []];
    }

    if (upper.startsWith('UPDATE RODEO SET CANT_VACAS_ORDENE = ?, CANT_VACAS_SECAS = ?, CANT_VAQUILLONAS = ?, CANT_TERNERAS = ?, CONSUMO_DIARIO_PROM_KG_MS = ?, FECHA_ACTUALIZACION = NOW() WHERE ID_RODEO = ?')) {
      const [
        cant_vacas_ordene,
        cant_vacas_secas,
        cant_vaquillonas,
        cant_terneras,
        consumo_diario_prom_kg_ms,
        id_rodeo
      ] = params;
      let affectedRows = 0;
      this.data.Rodeo.forEach((r) => {
        if (Number(r.id_rodeo) === Number(id_rodeo)) {
          r.cant_vacas_ordene = Number(cant_vacas_ordene);
          r.cant_vacas_secas = Number(cant_vacas_secas);
          r.cant_vaquillonas = Number(cant_vaquillonas);
          r.cant_terneras = Number(cant_terneras);
          r.consumo_diario_prom_kg_ms = Number(consumo_diario_prom_kg_ms);
          r.fecha_actualizacion = new Date().toISOString();
          affectedRows++;
        }
      });
      this.save();
      return [{ affectedRows }, []];
    }

    if (upper.startsWith('INSERT INTO HISTORIAL_RODEO (ID_RODEO, FECHA_REGISTRO, CANT_VACAS_ORDENE, CANT_VACAS_SECAS, CANT_VAQUILLONAS, CANT_TERNERAS, CONSUMO_DIARIO_PROM_KG_MS) VALUES (?, NOW(), ?, ?, ?, ?, ?)')) {
      const [
        id_rodeo,
        cant_vacas_ordene,
        cant_vacas_secas,
        cant_vaquillonas,
        cant_terneras,
        consumo_diario_prom_kg_ms
      ] = params;
      const insertId = this.nextId('Historial_Rodeo', 'id_historial_rodeo');
      this.data.Historial_Rodeo.push({
        id_historial_rodeo: insertId,
        id_rodeo: Number(id_rodeo),
        fecha_registro: new Date().toISOString(),
        cant_vacas_ordene: Number(cant_vacas_ordene),
        cant_vacas_secas: Number(cant_vacas_secas),
        cant_vaquillonas: Number(cant_vaquillonas),
        cant_terneras: Number(cant_terneras),
        consumo_diario_prom_kg_ms: Number(consumo_diario_prom_kg_ms)
      });
      this.save();
      return [{ insertId, affectedRows: 1 }, []];
    }

    if (upper.startsWith('SELECT * FROM HISTORIAL_RODEO WHERE ID_RODEO = ? ORDER BY FECHA_REGISTRO DESC, ID_HISTORIAL_RODEO DESC')) {
      const id = Number(params[0]);
      let rows = this.data.Historial_Rodeo
        .filter((h) => Number(h.id_rodeo) === id)
        .sort((a, b) => {
          const diff = new Date(b.fecha_registro) - new Date(a.fecha_registro);
          return diff !== 0 ? diff : Number(b.id_historial_rodeo) - Number(a.id_historial_rodeo);
        });
      if (upper.includes('LIMIT 1')) {
        rows = rows.slice(0, 1);
      }
      return [rows, []];
    }

    // ========================================================================
    // 5. USO_POTRERO (HU-005, HU-006, HU-009, HU-010)
    // ========================================================================
    if (upper.startsWith('SELECT * FROM USO_POTRERO WHERE ESTADO = \'ACTIVO\'')) {
      const rows = this.data.Uso_Potrero.filter((u) => u.estado === 'activo');
      return [rows, []];
    }

    if (upper.startsWith('SELECT * FROM USO_POTRERO WHERE ID_POTRERO = ? AND ESTADO = \'ACTIVO\'')) {
      const id = Number(params[0]);
      const rows = this.data.Uso_Potrero.filter((u) => Number(u.id_potrero) === id && u.estado === 'activo');
      return [rows, []];
    }

    if (upper.startsWith('SELECT * FROM USO_POTRERO WHERE ID_RODEO = ? AND ESTADO = \'ACTIVO\'')) {
      const id = Number(params[0]);
      const rows = this.data.Uso_Potrero.filter((u) => Number(u.id_rodeo) === id && u.estado === 'activo');
      return [rows, []];
    }

    if (upper.startsWith('SELECT * FROM USO_POTRERO WHERE ID_POTRERO = ? AND ESTADO = \'FINALIZADO\' ORDER BY FECHA_FIN_REAL DESC, ID_USO_POTRERO DESC LIMIT 1')) {
      const id = Number(params[0]);
      const rows = this.data.Uso_Potrero
        .filter((u) => Number(u.id_potrero) === id && u.estado === 'finalizado')
        .sort((a, b) => {
          const dDiff = new Date(b.fecha_fin_real || 0) - new Date(a.fecha_fin_real || 0);
          return dDiff !== 0 ? dDiff : Number(b.id_uso_potrero) - Number(a.id_uso_potrero);
        })
        .slice(0, 1);
      return [rows, []];
    }

    if (upper.startsWith('SELECT * FROM USO_POTRERO WHERE ID_USO_POTRERO = ?')) {
      const id = Number(params[0]);
      const rows = this.data.Uso_Potrero.filter((u) => Number(u.id_uso_potrero) === id);
      return [rows, []];
    }

    if (upper.startsWith('INSERT INTO USO_POTRERO (ID_POTRERO, ID_RODEO, ID_HISTORIAL_RODEO, FECHA_INGRESO, FECHA_FIN_ESTIMADA, FECHA_FIN_REAL, DIAS_PASTOREO_ESTIMADOS, ESTADO) VALUES (?, ?, ?, ?, ?, NULL, ?, \'ACTIVO\')')) {
      const [
        id_potrero,
        id_rodeo,
        id_historial_rodeo,
        fecha_ingreso,
        fecha_fin_estimada,
        dias_pastoreo_estimados
      ] = params;
      const insertId = this.nextId('Uso_Potrero', 'id_uso_potrero');
      this.data.Uso_Potrero.push({
        id_uso_potrero: insertId,
        id_potrero: Number(id_potrero),
        id_rodeo: Number(id_rodeo),
        id_historial_rodeo: Number(id_historial_rodeo),
        fecha_ingreso,
        fecha_fin_estimada,
        fecha_fin_real: null,
        dias_pastoreo_estimados: Number(dias_pastoreo_estimados),
        estado: 'activo'
      });
      this.save();
      return [{ insertId, affectedRows: 1 }, []];
    }

    if (upper.startsWith('UPDATE USO_POTRERO SET FECHA_FIN_REAL = ?, ESTADO = \'FINALIZADO\' WHERE ID_USO_POTRERO = ?')) {
      const [fecha_fin_real, id_uso_potrero] = params;
      let affectedRows = 0;
      this.data.Uso_Potrero.forEach((u) => {
        if (Number(u.id_uso_potrero) === Number(id_uso_potrero)) {
          u.fecha_fin_real = fecha_fin_real;
          u.estado = 'finalizado';
          affectedRows++;
        }
      });
      this.save();
      return [{ affectedRows }, []];
    }

    if (upper.includes('FROM USO_POTRERO UP') && upper.includes('JOIN HISTORIAL_RODEO HR')) {
      const filterByPotrero = upper.includes('WHERE UP.ID_POTRERO = ?');
      const filterByEstablecimientoIn = upper.includes('WHERE P.ID_ESTABLECIMIENTO IN');
      const filterByEstablecimientoEq = upper.includes('WHERE P.ID_ESTABLECIMIENTO = ?');

      let usos = [...this.data.Uso_Potrero];
      if (filterByPotrero) {
        const paramId = Number(params[0]);
        usos = usos.filter((u) => Number(u.id_potrero) === paramId);
      } else if (filterByEstablecimientoIn) {
        const estIds = params.map(Number);
        const potreroIds = this.data.Potrero
          .filter((p) => estIds.includes(Number(p.id_establecimiento)))
          .map((p) => Number(p.id_potrero));
        usos = usos.filter((u) => potreroIds.includes(Number(u.id_potrero)));
      } else if (filterByEstablecimientoEq) {
        const paramId = Number(params[0]);
        const potreroIds = this.data.Potrero
          .filter((p) => Number(p.id_establecimiento) === paramId)
          .map((p) => Number(p.id_potrero));
        usos = usos.filter((u) => potreroIds.includes(Number(u.id_potrero)));
      }

      const joined = usos.map((up) => {
        const p = this.data.Potrero.find((pot) => Number(pot.id_potrero) === Number(up.id_potrero)) || {};
        const hr = this.data.Historial_Rodeo.find((h) => Number(h.id_historial_rodeo) === Number(up.id_historial_rodeo)) || {};
        return {
          ...up,
          potrero_nombre: p.nombre || `Potrero #${up.id_potrero}`,
          tipo_pastura: p.tipo_pastura || '',
          superficie_ha: p.superficie_ha || 0,
          fecha_snapshot: hr.fecha_registro || null,
          cant_vacas_ordene: hr.cant_vacas_ordene ?? 0,
          cant_vacas_secas: hr.cant_vacas_secas ?? 0,
          cant_vaquillonas: hr.cant_vaquillonas ?? 0,
          cant_terneras: hr.cant_terneras ?? 0,
          consumo_diario_prom_kg_ms: hr.consumo_diario_prom_kg_ms ?? 0
        };
      }).sort((a, b) => {
        const dDiff = new Date(b.fecha_ingreso) - new Date(a.fecha_ingreso);
        return dDiff !== 0 ? dDiff : Number(b.id_uso_potrero) - Number(a.id_uso_potrero);
      });

      return [joined, []];
    }

    // ========================================================================
    // 6. NOTIFICACION (HU-008)
    // ========================================================================
    if (upper.startsWith('SELECT * FROM NOTIFICACION WHERE ID_USO_POTRERO = ?')) {
      const id = Number(params[0]);
      const rows = this.data.Notificacion.filter((n) => Number(n.id_uso_potrero) === id);
      return [rows, []];
    }

    if (upper.startsWith('INSERT INTO NOTIFICACION (ID_USO_POTRERO, FECHA, MENSAJE, LEIDA) VALUES (?, NOW(), ?, FALSE)')) {
      const [id_uso_potrero, mensaje] = params;
      const insertId = this.nextId('Notificacion', 'id_notificacion');
      this.data.Notificacion.push({
        id_notificacion: insertId,
        id_uso_potrero: Number(id_uso_potrero),
        fecha: new Date().toISOString(),
        mensaje,
        leida: 0
      });
      this.save();
      return [{ insertId, affectedRows: 1 }, []];
    }

    if (upper.includes('FROM NOTIFICACION N') && upper.includes('JOIN USO_POTRERO UP')) {
      const estIds = params.map(Number);
      const potrerosMap = new Map(
        this.data.Potrero
          .filter((p) => estIds.includes(Number(p.id_establecimiento)))
          .map((p) => [Number(p.id_potrero), p])
      );

      const rows = this.data.Notificacion
        .map((n) => {
          const up = this.data.Uso_Potrero.find((u) => Number(u.id_uso_potrero) === Number(n.id_uso_potrero));
          if (!up) return null;
          const pot = potrerosMap.get(Number(up.id_potrero));
          if (!pot) return null;
          return {
            ...n,
            leida: Boolean(n.leida),
            id_potrero: pot.id_potrero,
            potrero_nombre: pot.nombre,
            fecha_ingreso: up.fecha_ingreso,
            fecha_fin_estimada: up.fecha_fin_estimada,
            estado_uso: up.estado
          };
        })
        .filter(Boolean)
        .sort((a, b) => new Date(b.fecha) - new Date(a.fecha));

      return [rows, []];
    }

    if (upper.startsWith('UPDATE NOTIFICACION SET LEIDA = TRUE WHERE ID_NOTIFICACION = ?')) {
      const id = Number(params[0]);
      let affectedRows = 0;
      this.data.Notificacion.forEach((n) => {
        if (Number(n.id_notificacion) === id) {
          n.leida = 1;
          affectedRows++;
        }
      });
      this.save();
      return [{ affectedRows }, []];
    }

    if (upper.startsWith('UPDATE NOTIFICACION SET LEIDA = TRUE WHERE ID_USO_POTRERO = ?')) {
      const idUso = Number(params[0]);
      let affectedRows = 0;
      this.data.Notificacion.forEach((n) => {
        if (Number(n.id_uso_potrero) === idUso) {
          n.leida = 1;
          affectedRows++;
        }
      });
      this.save();
      return [{ affectedRows }, []];
    }

    if (upper.startsWith('UPDATE NOTIFICACION SET LEIDA = TRUE WHERE LEIDA = FALSE')) {
      let affectedRows = 0;
      this.data.Notificacion.forEach((n) => {
        if (!n.leida) {
          n.leida = 1;
          affectedRows++;
        }
      });
      this.save();
      return [{ affectedRows }, []];
    }

    throw new Error(`Consulta SQL no mapeada en LocalDbEngine: ${normalized}`);
  }

  async getConnection() {
    return {
      query: (sql, params) => this.query(sql, params),
      beginTransaction: async () => {},
      commit: async () => {},
      rollback: async () => {},
      release: () => {}
    };
  }
}

module.exports = new LocalDbEngine();
