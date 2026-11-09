const turf = require('@turf/turf');
const db = require('../config/db');
const {
  calculatePolygonMetrics,
  calculateGrazingDays,
  calculateSemaphoreStatus
} = require('../utils/grazingCalculator');
const { evaluateSemaphoreAndGenerateAlerts } = require('../services/alert.service');

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

async function getProductorEstablecimientos(idProductor) {
  const [rows] = await db.query(
    'SELECT * FROM Establecimiento WHERE id_productor = ? ORDER BY id_establecimiento ASC',
    [idProductor]
  );
  return rows || [];
}

async function getSharedRodeo() {
  const [rows] = await db.query('SELECT * FROM Rodeo ORDER BY id_rodeo ASC');
  return (
    rows[0] || {
      cant_vacas_ordene: 0,
      cant_vacas_secas: 0,
      cant_vaquillonas: 0,
      cant_terneras: 0,
      consumo_diario_prom_kg_ms: 15
    }
  );
}

/**
 * GET /api/potreros
 * Lista todos los potreros de todos los establecimientos del productor con su cálculo de forraje (HU-003/006),
 * uso activo y estado del semáforo en tiempo real (HU-007), disparando chequeo de alertas (HU-008).
 */
async function listarPotreros(req, res) {
  try {
    const establecimientos = await getProductorEstablecimientos(req.user.id_productor);
    if (establecimientos.length === 0) {
      return res.json({ ok: true, potreros: [] });
    }

    // Evaluar semáforo y generar notificaciones automáticas para potreros en rojo (HU-008)
    await evaluateSemaphoreAndGenerateAlerts();

    const rodeoActual = await getSharedRodeo();
    const enriquecidos = [];

    for (const est of establecimientos) {
      const [potreros] = await db.query(
        'SELECT * FROM Potrero WHERE id_establecimiento = ? ORDER BY id_potrero ASC',
        [est.id_establecimiento]
      );

      for (const p of potreros) {
        const [usosActivos] = await db.query(
          "SELECT * FROM Uso_Potrero WHERE id_potrero = ? AND estado = 'activo'",
          [p.id_potrero]
        );
        const usoActivo = usosActivos[0] || null;

        const [ultimosFinalizados] = await db.query(
          "SELECT * FROM Uso_Potrero WHERE id_potrero = ? AND estado = 'finalizado' ORDER BY fecha_fin_real DESC, id_uso_potrero DESC LIMIT 1",
          [p.id_potrero]
        );
        const ultimoUsoFinalizado = ultimosFinalizados[0] || null;

        const semaforo = calculateSemaphoreStatus(usoActivo, p, ultimoUsoFinalizado);

        if (!usoActivo && semaforo.descanso_cumplido && p.estado_actual === 'descanso') {
          p.estado_actual = 'disponible';
          await db.query('UPDATE Potrero SET estado_actual = ? WHERE id_potrero = ?', [
            'disponible',
            p.id_potrero
          ]);
        } else if (!usoActivo && semaforo.en_descanso && p.estado_actual !== 'descanso') {
          p.estado_actual = 'descanso';
          await db.query('UPDATE Potrero SET estado_actual = ? WHERE id_potrero = ?', [
            'descanso',
            p.id_potrero
          ]);
        }

        const simulacionPastoreo = calculateGrazingDays(p, rodeoActual);

        enriquecidos.push({
          id_potrero: p.id_potrero,
          id_establecimiento: p.id_establecimiento,
          establecimiento_nombre: est.nombre,
          nombre: p.nombre,
          poligono: parsePolygonJson(p.poligono),
          superficie_ha: Number(p.superficie_ha || 0),
          tipo_pastura: p.tipo_pastura || 'Sin especificar',
          disponibilidad_kg_ms_ha: Number(p.disponibilidad_kg_ms_ha || 0),
          porcentaje_aprovechable: Number(p.porcentaje_aprovechable || 0),
          observaciones: p.observaciones || '',
          estado_actual: p.estado_actual,
          forraje_aprovechable_kg_ms: simulacionPastoreo.forraje_aprovechable_kg_ms,
          dias_estimados_con_rodeo_actual: simulacionPastoreo.dias_pastoreo_estimados,
          uso_activo: usoActivo,
          ultimo_uso_finalizado: ultimoUsoFinalizado,
          semaforo
        });
      }
    }

    return res.json({
      ok: true,
      potreros: enriquecidos
    });
  } catch (err) {
    console.error('Error en listarPotreros:', err);
    return res.status(500).json({ ok: false, error: 'Error al obtener la lista de potreros.' });
  }
}

/**
 * POST /api/potreros
 * Crea un nuevo potrero asociándolo al establecimiento seleccionado (o detectando automáticamente
 * dentro de qué establecimiento fue dibujado con Turf.js).
 */
async function crearPotrero(req, res) {
  try {
    const establecimientos = await getProductorEstablecimientos(req.user.id_productor);
    if (establecimientos.length === 0) {
      return res.status(400).json({
        ok: false,
        error: 'Primero debe delimitar al menos un establecimiento (HU-001).'
      });
    }

    const {
      id_establecimiento,
      nombre,
      poligono,
      superficie_ha,
      tipo_pastura,
      disponibilidad_kg_ms_ha,
      porcentaje_aprovechable,
      observaciones
    } = req.body;

    if (!nombre || !poligono) {
      return res.status(400).json({
        ok: false,
        error: 'El nombre del potrero y su polígono en el mapa son obligatorios.'
      });
    }

    const parsedPolygon = parsePolygonJson(poligono);
    const metrics = calculatePolygonMetrics(parsedPolygon);
    const superficieCalculada =
      superficie_ha && Number(superficie_ha) > 0
        ? Number(Number(superficie_ha).toFixed(2))
        : metrics.superficie_ha;

    // Determinar el establecimiento al que pertenece el potrero:
    // 1) Detectar geométricamente si el centroide del potrero cae dentro de alguno de los establecimientos
    // 2) Si no, usar el id_establecimiento enviado desde la UI o el primero disponible
    let targetEst = null;
    try {
      const center = turf.centroid(parsedPolygon);
      for (const est of establecimientos) {
        const estPoly = parsePolygonJson(est.poligono);
        if (estPoly && turf.booleanPointInPolygon(center, estPoly)) {
          targetEst = est;
          break;
        }
      }
    } catch (_) {}

    if (!targetEst && id_establecimiento) {
      targetEst = establecimientos.find(
        (e) => Number(e.id_establecimiento) === Number(id_establecimiento)
      );
    }
    if (!targetEst) {
      targetEst = establecimientos[0];
    }

    const [insertRes] = await db.query(
      'INSERT INTO Potrero (id_establecimiento, nombre, poligono, superficie_ha, tipo_pastura, disponibilidad_kg_ms_ha, porcentaje_aprovechable, observaciones, estado_actual) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [
        targetEst.id_establecimiento,
        nombre.trim(),
        JSON.stringify(parsedPolygon),
        superficieCalculada,
        (tipo_pastura || 'Sin especificar').trim(),
        Number(disponibilidad_kg_ms_ha || 0),
        Number(porcentaje_aprovechable ?? 70),
        (observaciones || '').trim(),
        'disponible'
      ]
    );

    const [nuevoRows] = await db.query('SELECT * FROM Potrero WHERE id_potrero = ?', [
      insertRes.insertId
    ]);
    const nuevo = nuevoRows[0];
    nuevo.poligono = parsePolygonJson(nuevo.poligono);
    nuevo.superficie_ha = Number(nuevo.superficie_ha || 0);
    nuevo.disponibilidad_kg_ms_ha = Number(nuevo.disponibilidad_kg_ms_ha || 0);
    nuevo.porcentaje_aprovechable = Number(nuevo.porcentaje_aprovechable || 0);

    return res.status(201).json({
      ok: true,
      mensaje: `Potrero "${nuevo.nombre}" creado en "${targetEst.nombre}" (${superficieCalculada} ha).`,
      potrero: {
        ...nuevo,
        establecimiento_nombre: targetEst.nombre,
        uso_activo: null,
        semaforo: calculateSemaphoreStatus(null)
      }
    });
  } catch (err) {
    console.error('Error en crearPotrero:', err);
    return res.status(500).json({ ok: false, error: 'Error al crear el potrero.' });
  }
}

/**
 * PUT /api/potreros/:id
 * Actualiza nombre, polígono o datos de pastura de un potrero en cualquier momento (HU-002 y HU-003).
 */
async function actualizarPotrero(req, res) {
  try {
    const idPotrero = Number(req.params.id);
    const [rows] = await db.query('SELECT * FROM Potrero WHERE id_potrero = ?', [idPotrero]);
    const actual = rows[0];

    if (!actual) {
      return res.status(404).json({ ok: false, error: 'Potrero no encontrado.' });
    }

    const {
      nombre,
      poligono,
      superficie_ha,
      tipo_pastura,
      disponibilidad_kg_ms_ha,
      porcentaje_aprovechable,
      observaciones,
      estado_actual
    } = req.body;

    const nuevoNombre = nombre !== undefined ? String(nombre).trim() : actual.nombre;
    if (!nuevoNombre) {
      return res.status(400).json({ ok: false, error: 'El nombre del potrero no puede estar vacío.' });
    }

    let nuevoPoligono = parsePolygonJson(actual.poligono);
    let nuevaSuperficie = Number(actual.superficie_ha || 0);

    if (poligono !== undefined) {
      nuevoPoligono = parsePolygonJson(poligono);
      const metrics = calculatePolygonMetrics(nuevoPoligono);
      nuevaSuperficie =
        superficie_ha && Number(superficie_ha) > 0
          ? Number(Number(superficie_ha).toFixed(2))
          : metrics.superficie_ha;
    } else if (superficie_ha !== undefined && Number(superficie_ha) > 0) {
      nuevaSuperficie = Number(Number(superficie_ha).toFixed(2));
    }

    const nuevaPastura =
      tipo_pastura !== undefined ? String(tipo_pastura).trim() : actual.tipo_pastura;
    const nuevaDisponibilidad =
      disponibilidad_kg_ms_ha !== undefined
        ? Number(disponibilidad_kg_ms_ha)
        : Number(actual.disponibilidad_kg_ms_ha || 0);
    const nuevoPorcentaje =
      porcentaje_aprovechable !== undefined
        ? Number(porcentaje_aprovechable)
        : Number(actual.porcentaje_aprovechable || 0);
    const nuevasObservaciones =
      observaciones !== undefined ? String(observaciones).trim() : actual.observaciones || '';
    const nuevoEstado = estado_actual !== undefined ? estado_actual : actual.estado_actual;

    if (nuevoPorcentaje < 0 || nuevoPorcentaje > 100) {
      return res.status(400).json({
        ok: false,
        error: 'El porcentaje aprovechable debe estar entre 0% y 100%.'
      });
    }

    await db.query(
      'UPDATE Potrero SET nombre = ?, poligono = ?, superficie_ha = ?, tipo_pastura = ?, disponibilidad_kg_ms_ha = ?, porcentaje_aprovechable = ?, observaciones = ?, estado_actual = ? WHERE id_potrero = ?',
      [
        nuevoNombre,
        JSON.stringify(nuevoPoligono),
        nuevaSuperficie,
        nuevaPastura,
        nuevaDisponibilidad,
        nuevoPorcentaje,
        nuevasObservaciones,
        nuevoEstado,
        idPotrero
      ]
    );

    const [actualizadoRows] = await db.query('SELECT * FROM Potrero WHERE id_potrero = ?', [
      idPotrero
    ]);
    const actualizado = actualizadoRows[0];
    actualizado.poligono = parsePolygonJson(actualizado.poligono);
    actualizado.superficie_ha = Number(actualizado.superficie_ha || 0);
    actualizado.disponibilidad_kg_ms_ha = Number(actualizado.disponibilidad_kg_ms_ha || 0);
    actualizado.porcentaje_aprovechable = Number(actualizado.porcentaje_aprovechable || 0);

    return res.json({
      ok: true,
      mensaje: `Potrero "${actualizado.nombre}" actualizado correctamente.`,
      potrero: actualizado
    });
  } catch (err) {
    console.error('Error en actualizarPotrero:', err);
    return res.status(500).json({ ok: false, error: 'Error al actualizar el potrero.' });
  }
}

/**
 * DELETE /api/potreros/:id
 * Elimina un potrero del establecimiento (HU-002), impidiendo borrar si tiene rodeo activo adentro.
 */
async function eliminarPotrero(req, res) {
  try {
    const idPotrero = Number(req.params.id);
    const [rows] = await db.query('SELECT * FROM Potrero WHERE id_potrero = ?', [idPotrero]);
    const potrero = rows[0];

    if (!potrero) {
      return res.status(404).json({ ok: false, error: 'Potrero no encontrado.' });
    }

    const [usosActivos] = await db.query(
      "SELECT * FROM Uso_Potrero WHERE id_potrero = ? AND estado = 'activo'",
      [idPotrero]
    );

    if (usosActivos.length > 0 && req.query.forzar !== 'true') {
      return res.status(400).json({
        ok: false,
        error: `No se puede eliminar "${potrero.nombre}" mientras tiene un pastoreo activo en curso. Primero rote o finalice el pastoreo actual.`
      });
    }

    await db.query('DELETE FROM Potrero WHERE id_potrero = ?', [idPotrero]);

    return res.json({
      ok: true,
      mensaje: `Potrero "${potrero.nombre}" eliminado correctamente.`
    });
  } catch (err) {
    console.error('Error en eliminarPotrero:', err);
    return res.status(500).json({ ok: false, error: 'Error al eliminar el potrero.' });
  }
}

module.exports = {
  listarPotreros,
  crearPotrero,
  actualizarPotrero,
  eliminarPotrero
};
