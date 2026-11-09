const express = require('express');
const router = express.Router();

const { authenticateToken } = require('../middlewares/auth.middleware');
const authController = require('../controllers/auth.controller');
const establecimientoController = require('../controllers/establecimiento.controller');
const potreroController = require('../controllers/potrero.controller');
const rodeoController = require('../controllers/rodeo.controller');
const usoPotreroController = require('../controllers/usoPotrero.controller');
const notificacionController = require('../controllers/notificacion.controller');

// ============================================================================
// 1. AUTENTICACIÓN Y SEGURIDAD (Login, Bloqueo 5 intentos, Recuperación Token, Clave 6 meses)
// ============================================================================
router.post('/auth/login', authController.login);
router.post('/auth/solicitar-recuperacion', authController.solicitarRecuperacion);
router.post('/auth/restablecer-clave', authController.restablecerConToken);
router.post('/auth/cambiar-clave', authenticateToken, authController.cambiarContrasena);
router.get('/auth/me', authenticateToken, authController.obtenerPerfil);

// ============================================================================
// 2. ESTABLECIMIENTO (HU-001 — Delimitar múltiples establecimientos)
// ============================================================================
router.get('/establecimiento', authenticateToken, establecimientoController.obtenerEstablecimiento);
router.post('/establecimiento', authenticateToken, establecimientoController.guardarEstablecimiento);
router.put('/establecimiento/:id', authenticateToken, establecimientoController.actualizarEstablecimiento);
router.delete('/establecimiento/:id', authenticateToken, establecimientoController.eliminarEstablecimiento);

// ============================================================================
// 3. POTREROS Y PASTURAS (HU-002 — Dividir en potreros, HU-003 — Registrar pastura, HU-007 — Semáforo)
// ============================================================================
router.get('/potreros', authenticateToken, potreroController.listarPotreros);
router.post('/potreros', authenticateToken, potreroController.crearPotrero);
router.put('/potreros/:id', authenticateToken, potreroController.actualizarPotrero);
router.delete('/potreros/:id', authenticateToken, potreroController.eliminarPotrero);
router.get('/potreros/:id/historial', authenticateToken, usoPotreroController.consultarHistorialPorPotrero);

// ============================================================================
// 4. RODEO E HISTORIAL DE COMPOSICIÓN (HU-004 — Registrar rodeo + Snapshot automático)
// ============================================================================
router.get('/rodeo', authenticateToken, rodeoController.obtenerRodeo);
router.put('/rodeo', authenticateToken, rodeoController.actualizarRodeo);

// ============================================================================
// 5. PASTOREO, ROTACIÓN E HISTORIAL DE USO (HU-005, HU-006, HU-009, HU-010)
// ============================================================================
router.post('/pastoreo/calcular', authenticateToken, usoPotreroController.simularCalculoPastoreo);
router.post('/pastoreo/asignar', authenticateToken, usoPotreroController.asignarRodeoAPotrero);
router.post('/pastoreo/rotar', authenticateToken, usoPotreroController.rotarRodeo);
router.post('/pastoreo/:id/finalizar', authenticateToken, usoPotreroController.finalizarUsoPotrero);
router.get('/pastoreo/historial', authenticateToken, usoPotreroController.consultarHistorialGeneral);

// ============================================================================
// 6. NOTIFICACIONES Y ALERTAS DE POTREROS EN ROJO (HU-008)
// ============================================================================
router.get('/notificaciones', authenticateToken, notificacionController.listarNotificaciones);
router.put('/notificaciones/leer-todas', authenticateToken, notificacionController.marcarTodasComoLeidas);
router.put('/notificaciones/:id/leer', authenticateToken, notificacionController.marcarComoLeida);

module.exports = router;
