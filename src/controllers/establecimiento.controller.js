const db = require('../config/db');
const { calculatePolygonMetrics } = require('../utils/grazingCalculator');

function parsePolygonJson(poligono) {
  if (!poligono) return null;
  if (typeof poligono === 'string') {
    try {
      return JSON.parse(poligono);
    } catch (_) {
      return null;
    }
  }
  return poligono;
}

/**
 * GET /api/establecimiento
 * Obtiene todos los establecimientos del productor autenticado (HU-001 multi-establecimiento)
 */
async function obtenerEstablecimiento(req, res) {
  try {
    const idProductor = req.user.id_productor;
    const [rows] = await db.query(
      'SELECT * FROM Establecimiento WHERE id_productor = ? ORDER BY id_establecimiento ASC',
      [idProductor]
    );

    const establecimientos = [];
    for (const est of rows) {
      const parsedPoly = parsePolygonJson(est.poligono);
      const supTotal = Number(est.superficie_total_ha || 0);

      const [potreros] = await db.query(
        'SELECT * FROM Potrero WHERE id_establecimiento = ? ORDER BY id_potrero ASC',
        [est.id_establecimiento]
      );
      const superficieDivididaHa = Number(
        potreros.reduce((acc, p) => acc + Number(p.superficie_ha || 0), 0).toFixed(2)
      );

      establecimientos.push({
        ...est,
        poligono: parsedPoly,
        superficie_total_ha: supTotal,
        ubicacion_lat: Number(est.ubicacion_lat || -31.738),
        ubicacion_lng: Number(est.ubicacion_lng || -62.723),
        cantidad_potreros: potreros.length,
        superficie_dividida_ha: superficieDivididaHa,
        superficie_sin_asignar_ha: Number(Math.max(0, supTotal - superficieDivididaHa).toFixed(2))
      });
    }

    return res.json({
      ok: true,
      establecimientos,
      establecimiento: establecimientos[0] || null
    });
  } catch (err) {
    console.error('Error en obtenerEstablecimiento:', err);
    return res.status(500).json({
      ok: false,
      error: 'Error al consultar los establecimientos.'
    });
  }
}

/**
 * POST /api/establecimiento
 * Crea un NUEVO establecimiento delimitado en el mapa (HU-001).
 * Calcula automáticamente superficie_total_ha con Turf.js.
 */
async function guardarEstablecimiento(req, res) {
  try {
    const idProductor = req.user.id_productor;
    const { nombre, poligono, superficie_total_ha } = req.body;

    if (!poligono) {
      return res.status(400).json({
        ok: false,
        error: 'Debe dibujar el polígono del establecimiento en el mapa antes de guardar.'
      });
    }

    const parsedPolygon = parsePolygonJson(poligono);
    const metrics = calculatePolygonMetrics(parsedPolygon);

    const superficieCalculada =
      superficie_total_ha && Number(superficie_total_ha) > 0
        ? Number(Number(superficie_total_ha).toFixed(2))
        : metrics.superficie_ha;

    const nombreEst = (nombre || 'Nuevo Establecimiento').trim();
    const poligonoStr = JSON.stringify(parsedPolygon);

    const [insertRes] = await db.query(
      'INSERT INTO Establecimiento (id_productor, nombre, ubicacion_lat, ubicacion_lng, poligono, superficie_total_ha) VALUES (?, ?, ?, ?, ?, ?)',
      [
        idProductor,
        nombreEst,
        metrics.ubicacion_lat,
        metrics.ubicacion_lng,
        poligonoStr,
        superficieCalculada
      ]
    );

    const idEstablecimiento = insertRes.insertId;
    const [actualizadoRows] = await db.query(
      'SELECT * FROM Establecimiento WHERE id_establecimiento = ?',
      [idEstablecimiento]
    );
    const est = actualizadoRows[0];
    est.poligono = parsePolygonJson(est.poligono);
    est.superficie_total_ha = Number(est.superficie_total_ha || 0);

    return res.status(201).json({
      ok: true,
      mensaje: `Establecimiento "${nombreEst}" creado correctamente (${superficieCalculada} ha).`,
      establecimiento: est
    });
  } catch (err) {
    console.error('Error en guardarEstablecimiento:', err);
    return res.status(500).json({
      ok: false,
      error: 'Error al guardar el nuevo establecimiento.'
    });
  }
}

/**
 * PUT /api/establecimiento/:id
 * Actualiza el nombre o el polígono perimetral de un establecimiento existente.
 */
async function actualizarEstablecimiento(req, res) {
  try {
    const idEstablecimiento = Number(req.params.id);
    const [rows] = await db.query('SELECT * FROM Establecimiento WHERE id_establecimiento = ?', [
      idEstablecimiento
    ]);
    const actual = rows[0];
    if (!actual) {
      return res.status(404).json({ ok: false, error: 'Establecimiento no encontrado.' });
    }

    const { nombre, poligono, superficie_total_ha } = req.body;
    const nuevoNombre = nombre !== undefined ? String(nombre).trim() : actual.nombre;

    let nuevoPoligono = parsePolygonJson(actual.poligono);
    let nuevaSuperficie = Number(actual.superficie_total_ha || 0);
    let lat = Number(actual.ubicacion_lat || -31.738);
    let lng = Number(actual.ubicacion_lng || -62.723);

    if (poligono !== undefined) {
      nuevoPoligono = parsePolygonJson(poligono);
      const metrics = calculatePolygonMetrics(nuevoPoligono);
      nuevaSuperficie =
        superficie_total_ha && Number(superficie_total_ha) > 0
          ? Number(Number(superficie_total_ha).toFixed(2))
          : metrics.superficie_ha;
      lat = metrics.ubicacion_lat;
      lng = metrics.ubicacion_lng;
    }

    await db.query(
      'UPDATE Establecimiento SET nombre = ?, ubicacion_lat = ?, ubicacion_lng = ?, poligono = ?, superficie_total_ha = ? WHERE id_establecimiento = ?',
      [nuevoNombre, lat, lng, JSON.stringify(nuevoPoligono), nuevaSuperficie, idEstablecimiento]
    );

    const [actualizadoRows] = await db.query(
      'SELECT * FROM Establecimiento WHERE id_establecimiento = ?',
      [idEstablecimiento]
    );
    const est = actualizadoRows[0];
    est.poligono = parsePolygonJson(est.poligono);
    est.superficie_total_ha = Number(est.superficie_total_ha || 0);

    return res.json({
      ok: true,
      mensaje: `Establecimiento "${est.nombre}" actualizado (${est.superficie_total_ha} ha).`,
      establecimiento: est
    });
  } catch (err) {
    console.error('Error en actualizarEstablecimiento:', err);
    return res.status(500).json({ ok: false, error: 'Error al actualizar el establecimiento.' });
  }
}

/**
 * DELETE /api/establecimiento/:id
 * Elimina un establecimiento y sus potreros (validando que no tenga pastoreo activo).
 */
async function eliminarEstablecimiento(req, res) {
  try {
    const idProductor = req.user.id_productor;
    const idEstablecimiento = Number(req.params.id);

    const [rows] = await db.query('SELECT * FROM Establecimiento WHERE id_establecimiento = ?', [
      idEstablecimiento
    ]);
    const est = rows[0];
    if (!est) {
      return res.status(404).json({ ok: false, error: 'Establecimiento no encontrado.' });
    }

    const [potreros] = await db.query(
      'SELECT * FROM Potrero WHERE id_establecimiento = ? ORDER BY id_potrero ASC',
      [idEstablecimiento]
    );

    for (const p of potreros) {
      const [usosActivos] = await db.query(
        "SELECT * FROM Uso_Potrero WHERE id_potrero = ? AND estado = 'activo'",
        [p.id_potrero]
      );
      if (usosActivos.length > 0) {
        return res.status(400).json({
          ok: false,
          error: `No se puede eliminar "${est.nombre}" porque el potrero "${p.nombre}" tiene al rodeo en pastoreo activo. Rote o finalice primero el pastoreo.`
        });
      }
    }

    // Si el Rodeo único del productor estaba asociado a este id_establecimiento y existe otro establecimiento, reasociarlo para no perder el rodeo
    const [otrosEst] = await db.query(
      'SELECT * FROM Establecimiento WHERE id_productor = ? ORDER BY id_establecimiento ASC',
      [idProductor]
    );
    const otro = otrosEst.find((e) => Number(e.id_establecimiento) !== idEstablecimiento);
    if (otro) {
      await db.query(
        'UPDATE Rodeo SET id_establecimiento = ? WHERE id_establecimiento = ?',
        [otro.id_establecimiento, idEstablecimiento]
      );
    }

    await db.query('DELETE FROM Establecimiento WHERE id_establecimiento = ?', [idEstablecimiento]);

    return res.json({
      ok: true,
      mensaje: `Establecimiento "${est.nombre}" eliminado correctamente.`
    });
  } catch (err) {
    console.error('Error en eliminarEstablecimiento:', err);
    return res.status(500).json({ ok: false, error: 'Error al eliminar el establecimiento.' });
  }
}

module.exports = {
  obtenerEstablecimiento,
  guardarEstablecimiento,
  actualizarEstablecimiento,
  eliminarEstablecimiento
};
