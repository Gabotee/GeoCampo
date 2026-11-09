const db = require('../config/db');
const { evaluateSemaphoreAndGenerateAlerts } = require('../services/alert.service');

/**
 * GET /api/notificaciones
 * Ejecuta el chequeo de potreros en rojo y devuelve las notificaciones del establecimiento (HU-008).
 */
async function listarNotificaciones(req, res) {
  try {
    await evaluateSemaphoreAndGenerateAlerts();

    const [estRows] = await db.query(
      'SELECT * FROM Establecimiento WHERE id_productor = ? ORDER BY id_establecimiento ASC',
      [req.user.id_productor]
    );
    if (estRows.length === 0) {
      return res.json({
        ok: true,
        no_leidas_count: 0,
        notificaciones: []
      });
    }

    const notificaciones = [];
    for (const est of estRows) {
      const [rows] = await db.query(
        `SELECT n.id_notificacion, n.id_uso_potrero, n.fecha, n.mensaje, n.leida,
                p.id_potrero, p.nombre AS potrero_nombre,
                up.fecha_ingreso, up.fecha_fin_estimada, up.estado AS estado_uso
         FROM Notificacion n
         JOIN Uso_Potrero up ON n.id_uso_potrero = up.id_uso_potrero
         JOIN Potrero p ON up.id_potrero = p.id_potrero
         WHERE p.id_establecimiento = ?
         ORDER BY n.fecha DESC, n.id_notificacion DESC`,
        [est.id_establecimiento]
      );
      rows.forEach((r) => {
        notificaciones.push({
          ...r,
          establecimiento_nombre: est.nombre,
          leida: Boolean(r.leida)
        });
      });
    }

    notificaciones.sort((a, b) => new Date(b.fecha) - new Date(a.fecha));
    const noLeidasCount = notificaciones.filter((n) => !n.leida).length;

    return res.json({
      ok: true,
      no_leidas_count: noLeidasCount,
      notificaciones
    });
  } catch (err) {
    console.error('Error en listarNotificaciones:', err);
    return res.status(500).json({ ok: false, error: 'Error al consultar las notificaciones.' });
  }
}

/**
 * PUT /api/notificaciones/:id/leer
 * Marca una notificación individual como leída (HU-008).
 */
async function marcarComoLeida(req, res) {
  try {
    const idNotificacion = Number(req.params.id);
    await db.query('UPDATE Notificacion SET leida = TRUE WHERE id_notificacion = ?', [
      idNotificacion
    ]);
    return res.json({
      ok: true,
      mensaje: 'Notificación marcada como leída.'
    });
  } catch (err) {
    console.error('Error en marcarComoLeida:', err);
    return res.status(500).json({ ok: false, error: 'Error al actualizar la notificación.' });
  }
}

/**
 * PUT /api/notificaciones/leer-todas
 * Marca todas las notificaciones pendientes como leídas (HU-008).
 */
async function marcarTodasComoLeidas(req, res) {
  try {
    await db.query('UPDATE Notificacion SET leida = TRUE WHERE leida = FALSE');
    return res.json({
      ok: true,
      mensaje: 'Todas las notificaciones fueron marcadas como leídas.'
    });
  } catch (err) {
    console.error('Error en marcarTodasComoLeidas:', err);
    return res.status(500).json({ ok: false, error: 'Error al marcar las notificaciones.' });
  }
}

module.exports = {
  listarNotificaciones,
  marcarComoLeida,
  marcarTodasComoLeidas
};
