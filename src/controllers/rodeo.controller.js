const db = require('../config/db');

function enrichRodeoMetrics(r) {
  if (!r) return null;
  const vacasOrdene = Number(r.cant_vacas_ordene || 0);
  const vacasSecas = Number(r.cant_vacas_secas || 0);
  const vaquillonas = Number(r.cant_vaquillonas || 0);
  const terneras = Number(r.cant_terneras || 0);
  const totalAnimales = vacasOrdene + vacasSecas + vaquillonas + terneras;
  const consumoProm = Number(r.consumo_diario_prom_kg_ms || 0);
  const consumoTotalDiarioKgMs = Number((totalAnimales * consumoProm).toFixed(2));

  return {
    ...r,
    cant_vacas_ordene: vacasOrdene,
    cant_vacas_secas: vacasSecas,
    cant_vaquillonas: vaquillonas,
    cant_terneras: terneras,
    consumo_diario_prom_kg_ms: consumoProm,
    total_animales: totalAnimales,
    consumo_diario_total_kg_ms: consumoTotalDiarioKgMs
  };
}

/**
 * GET /api/rodeo
 * Obtiene el rodeo único compartido del productor y su historial de snapshots en Historial_Rodeo (HU-004).
 */
async function obtenerRodeo(req, res) {
  try {
    const [estRows] = await db.query(
      'SELECT * FROM Establecimiento WHERE id_productor = ? ORDER BY id_establecimiento ASC',
      [req.user.id_productor]
    );
    const est = estRows[0];
    if (!est) {
      return res.json({
        ok: true,
        rodeo: null,
        historial: []
      });
    }

    let [rodeoRows] = await db.query('SELECT * FROM Rodeo ORDER BY id_rodeo ASC');

    let rodeo = rodeoRows[0];
    if (!rodeo) {
      const [insertRes] = await db.query(
        'INSERT INTO Rodeo (id_establecimiento, cant_vacas_ordene, cant_vacas_secas, cant_vaquillonas, cant_terneras, consumo_diario_prom_kg_ms) VALUES (?, 0, 0, 0, 0, 15.00)',
        [est.id_establecimiento]
      );
      const [nuevos] = await db.query('SELECT * FROM Rodeo WHERE id_rodeo = ?', [
        insertRes.insertId
      ]);
      rodeo = nuevos[0];
    }

    const [historialRows] = await db.query(
      'SELECT * FROM Historial_Rodeo WHERE id_rodeo = ? ORDER BY fecha_registro DESC, id_historial_rodeo DESC',
      [rodeo.id_rodeo]
    );

    return res.json({
      ok: true,
      rodeo: enrichRodeoMetrics(rodeo),
      historial: historialRows.map(enrichRodeoMetrics)
    });
  } catch (err) {
    console.error('Error en obtenerRodeo:', err);
    return res.status(500).json({ ok: false, error: 'Error al obtener los datos del rodeo.' });
  }
}

/**
 * PUT /api/rodeo
 * Actualiza la composición del rodeo único y genera automáticamente un snapshot en Historial_Rodeo (HU-004).
 */
async function actualizarRodeo(req, res) {
  const conn = await db.getConnection();
  try {
    const [estRows] = await conn.query(
      'SELECT * FROM Establecimiento WHERE id_productor = ? ORDER BY id_establecimiento ASC',
      [req.user.id_productor]
    );
    const est = estRows[0];
    if (!est) {
      conn.release();
      return res.status(400).json({
        ok: false,
        error: 'Primero debe delimitar al menos un establecimiento antes de registrar el rodeo.'
      });
    }

    const {
      cant_vacas_ordene,
      cant_vacas_secas,
      cant_vaquillonas,
      cant_terneras,
      consumo_diario_prom_kg_ms
    } = req.body;

    const vacasOrdene = Math.max(0, parseInt(cant_vacas_ordene ?? 0, 10) || 0);
    const vacasSecas = Math.max(0, parseInt(cant_vacas_secas ?? 0, 10) || 0);
    const vaquillonas = Math.max(0, parseInt(cant_vaquillonas ?? 0, 10) || 0);
    const terneras = Math.max(0, parseInt(cant_terneras ?? 0, 10) || 0);
    const consumoProm = Number(consumo_diario_prom_kg_ms ?? 0);

    if (consumoProm <= 0) {
      conn.release();
      return res.status(400).json({
        ok: false,
        error: 'El consumo diario promedio por animal (kg MS) debe ser mayor a 0.'
      });
    }

    await conn.beginTransaction();

    const [rodeoRows] = await conn.query('SELECT * FROM Rodeo ORDER BY id_rodeo ASC');

    let idRodeo;
    if (rodeoRows.length > 0) {
      idRodeo = rodeoRows[0].id_rodeo;
      await conn.query(
        'UPDATE Rodeo SET cant_vacas_ordene = ?, cant_vacas_secas = ?, cant_vaquillonas = ?, cant_terneras = ?, consumo_diario_prom_kg_ms = ?, fecha_actualizacion = NOW() WHERE id_rodeo = ?',
        [vacasOrdene, vacasSecas, vaquillonas, terneras, consumoProm, idRodeo]
      );
    } else {
      const [insRodeo] = await conn.query(
        'INSERT INTO Rodeo (id_establecimiento, cant_vacas_ordene, cant_vacas_secas, cant_vaquillonas, cant_terneras, consumo_diario_prom_kg_ms) VALUES (?, ?, ?, ?, ?, ?)',
        [est.id_establecimiento, vacasOrdene, vacasSecas, vaquillonas, terneras, consumoProm]
      );
      idRodeo = insRodeo.insertId;
    }

    // HU-004: Generar automáticamente un snapshot en Historial_Rodeo
    const [insSnapshot] = await conn.query(
      'INSERT INTO Historial_Rodeo (id_rodeo, fecha_registro, cant_vacas_ordene, cant_vacas_secas, cant_vaquillonas, cant_terneras, consumo_diario_prom_kg_ms) VALUES (?, NOW(), ?, ?, ?, ?, ?)',
      [idRodeo, vacasOrdene, vacasSecas, vaquillonas, terneras, consumoProm]
    );

    await conn.commit();
    conn.release();

    const [actualizadoRows] = await db.query('SELECT * FROM Rodeo WHERE id_rodeo = ?', [idRodeo]);
    const [historialRows] = await db.query(
      'SELECT * FROM Historial_Rodeo WHERE id_rodeo = ? ORDER BY fecha_registro DESC, id_historial_rodeo DESC',
      [idRodeo]
    );

    const rodeoEnriquecido = enrichRodeoMetrics(actualizadoRows[0]);

    return res.json({
      ok: true,
      mensaje: `Composición del rodeo actualizada (${rodeoEnriquecido.total_animales} cabezas, ${rodeoEnriquecido.consumo_diario_total_kg_ms} kg MS/día). Snapshot #${insSnapshot.insertId} registrado en Historial_Rodeo.`,
      rodeo: rodeoEnriquecido,
      id_historial_generado: insSnapshot.insertId,
      historial: historialRows.map(enrichRodeoMetrics)
    });
  } catch (err) {
    await conn.rollback();
    conn.release();
    console.error('Error en actualizarRodeo:', err);
    return res.status(500).json({ ok: false, error: 'Error al actualizar el rodeo.' });
  }
}

module.exports = {
  obtenerRodeo,
  actualizarRodeo
};
