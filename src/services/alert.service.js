const db = require('../config/db');
const { calculateSemaphoreStatus } = require('../utils/grazingCalculator');

/**
 * Servicio de verificación de semáforo y generación automática de Notificaciones (HU-007 y HU-008)
 * Se ejecuta tanto mediante cron job programado como al cargar la aplicación/potreros.
 */
async function evaluateSemaphoreAndGenerateAlerts() {
  try {
    const [usosActivos] = await db.query("SELECT * FROM Uso_Potrero WHERE estado = 'activo'");
    let nuevasNotificaciones = 0;

    for (const uso of usosActivos) {
      const semaforo = calculateSemaphoreStatus(uso);
      const [potreros] = await db.query('SELECT * FROM Potrero WHERE id_potrero = ?', [uso.id_potrero]);
      const potrero = potreros[0];
      if (!potrero) continue;

      // Sincronizar estado_actual del potrero según semáforo si está en amarillo o rojo
      if ((semaforo.color === 'rojo' || semaforo.color === 'amarillo') && potrero.estado_actual !== 'advertencia') {
        await db.query('UPDATE Potrero SET estado_actual = ? WHERE id_potrero = ?', ['advertencia', potrero.id_potrero]);
      }

      // HU-008: Cuando un potrero pasa a ROJO (dias_restantes <= 0), generar registro en Notificacion
      if (semaforo.color === 'rojo') {
        const [existentes] = await db.query(
          'SELECT * FROM Notificacion WHERE id_uso_potrero = ?',
          [uso.id_uso_potrero]
        );

        if (existentes.length === 0) {
          const diasVencidos = Math.abs(semaforo.dias_restantes);
          const detalleVencimiento =
            diasVencidos === 0
              ? 'ha alcanzado su fecha límite de pastoreo hoy (0 días restantes)'
              : `lleva ${diasVencidos} día(s) excedido de su tiempo estimado de pastoreo`;

          const mensaje = `ALERTA DE ROTACIÓN: El "${potrero.nombre}" ${detalleVencimiento} (Estado ROJO). Se recomienda rotar el rodeo de inmediato.`;

          await db.query(
            'INSERT INTO Notificacion (id_uso_potrero, fecha, mensaje, leida) VALUES (?, NOW(), ?, FALSE)',
            [uso.id_uso_potrero, mensaje]
          );
          nuevasNotificaciones++;
        }
      }
    }

    return { ok: true, nuevasNotificaciones };
  } catch (err) {
    console.error('Error evaluando alertas de pastoreo (HU-008):', err.message);
    return { ok: false, error: err.message };
  }
}

module.exports = {
  evaluateSemaphoreAndGenerateAlerts
};
