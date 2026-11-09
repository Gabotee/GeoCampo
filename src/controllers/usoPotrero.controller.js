const db = require('../config/db');
const {
  calculateGrazingDays,
  calculateSemaphoreStatus,
  formatDateYMD,
  getTodayLocal,
  parseDateLocal
} = require('../utils/grazingCalculator');
const { evaluateSemaphoreAndGenerateAlerts } = require('../services/alert.service');

/**
 * Obtiene el último Historial_Rodeo o genera uno nuevo si no existe o si no coincide con el Rodeo actual (HU-005)
 */
async function ensureLatestHistorialRodeo(conn, rodeo) {
  const [histRows] = await conn.query(
    'SELECT * FROM Historial_Rodeo WHERE id_rodeo = ? ORDER BY fecha_registro DESC, id_historial_rodeo DESC LIMIT 1',
    [rodeo.id_rodeo]
  );

  const ultimo = histRows[0];
  const coincide =
    ultimo &&
    Number(ultimo.cant_vacas_ordene) === Number(rodeo.cant_vacas_ordene) &&
    Number(ultimo.cant_vacas_secas) === Number(rodeo.cant_vacas_secas) &&
    Number(ultimo.cant_vaquillonas) === Number(rodeo.cant_vaquillonas) &&
    Number(ultimo.cant_terneras) === Number(rodeo.cant_terneras) &&
    Number(ultimo.consumo_diario_prom_kg_ms) === Number(rodeo.consumo_diario_prom_kg_ms);

  if (coincide) {
    return ultimo.id_historial_rodeo;
  }

  const [ins] = await conn.query(
    'INSERT INTO Historial_Rodeo (id_rodeo, fecha_registro, cant_vacas_ordene, cant_vacas_secas, cant_vaquillonas, cant_terneras, consumo_diario_prom_kg_ms) VALUES (?, NOW(), ?, ?, ?, ?, ?)',
    [
      rodeo.id_rodeo,
      rodeo.cant_vacas_ordene,
      rodeo.cant_vacas_secas,
      rodeo.cant_vaquillonas,
      rodeo.cant_terneras,
      rodeo.consumo_diario_prom_kg_ms
    ]
  );
  return ins.insertId;
}

/**
 * POST /api/pastoreo/calcular
 * Simulador en vivo de las fórmulas de HU-006 para un potrero antes de confirmar la asignación/rotación.
 */
async function simularCalculoPastoreo(req, res) {
  try {
    const { id_potrero, fecha_ingreso } = req.body;
    const [potRows] = await db.query('SELECT * FROM Potrero WHERE id_potrero = ?', [
      Number(id_potrero)
    ]);
    const potrero = potRows[0];
    if (!potrero) {
      return res.status(404).json({ ok: false, error: 'Potrero no encontrado.' });
    }

    const [rodeoRows] = await db.query('SELECT * FROM Rodeo ORDER BY id_rodeo ASC');
    const rodeo = rodeoRows[0];
    if (!rodeo) {
      return res.status(400).json({ ok: false, error: 'No hay un rodeo registrado en el sistema.' });
    }

    const calculo = calculateGrazingDays(potrero, rodeo, fecha_ingreso);
    return res.json({
      ok: true,
      calculo
    });
  } catch (err) {
    console.error('Error en simularCalculoPastoreo:', err);
    return res.status(500).json({ ok: false, error: 'Error al calcular disponibilidad y días de pastoreo.' });
  }
}

/**
 * POST /api/pastoreo/asignar
 * Asigna el rodeo a un potrero disponible (HU-005) y calcula/guarda días y fecha fin estimada (HU-006).
 */
async function asignarRodeoAPotrero(req, res) {
  const conn = await db.getConnection();
  try {
    const { id_potrero, fecha_ingreso } = req.body;
    if (!id_potrero) {
      conn.release();
      return res.status(400).json({ ok: false, error: 'Debe seleccionar un potrero de destino.' });
    }

    const [potRows] = await conn.query('SELECT * FROM Potrero WHERE id_potrero = ?', [
      Number(id_potrero)
    ]);
    const potrero = potRows[0];
    if (!potrero) {
      conn.release();
      return res.status(404).json({ ok: false, error: 'El potrero seleccionado no existe.' });
    }

    const [usosActivos] = await conn.query(
      "SELECT * FROM Uso_Potrero WHERE id_potrero = ? AND estado = 'activo'",
      [potrero.id_potrero]
    );
    if (usosActivos.length > 0) {
      conn.release();
      return res.status(400).json({
        ok: false,
        error: `El "${potrero.nombre}" ya tiene un uso de pastoreo activo en curso.`
      });
    }

    // Verificar que el potrero de destino no esté en período de descanso (Rojo sin rodeo)
    const [ultimosFinalizados] = await conn.query(
      "SELECT * FROM Uso_Potrero WHERE id_potrero = ? AND estado = 'finalizado' ORDER BY fecha_fin_real DESC, id_uso_potrero DESC LIMIT 1",
      [potrero.id_potrero]
    );
    const semPotrero = calculateSemaphoreStatus(null, potrero, ultimosFinalizados[0] || null);
    if (semPotrero.en_descanso) {
      conn.release();
      return res.status(400).json({
        ok: false,
        error: `El "${potrero.nombre}" se encuentra en período de descanso y recuperación (lleva ${semPotrero.dias_descanso_transcurridos} de ${semPotrero.dias_descanso_requeridos} días; faltan ${semPotrero.dias_descanso_restantes} días para pasar a Verde).`
      });
    }

    const [rodeoRows] = await conn.query('SELECT * FROM Rodeo ORDER BY id_rodeo ASC');
    const rodeo = rodeoRows[0];
    if (!rodeo) {
      conn.release();
      return res.status(400).json({
        ok: false,
        error: 'Debe registrar la composición del rodeo antes de asignarlo a un potrero (HU-004).'
      });
    }

    // Validar que el rodeo no esté ya asignado a otro potrero activo al mismo tiempo
    const [usosActivosRodeo] = await conn.query(
      "SELECT * FROM Uso_Potrero WHERE id_rodeo = ? AND estado = 'activo'",
      [rodeo.id_rodeo]
    );
    if (usosActivosRodeo.length > 0) {
      const usoActual = usosActivosRodeo[0];
      const [potActualRows] = await conn.query('SELECT * FROM Potrero WHERE id_potrero = ?', [
        usoActual.id_potrero
      ]);
      const nombrePotActual = potActualRows[0] ? potActualRows[0].nombre : `Potrero #${usoActual.id_potrero}`;
      conn.release();
      return res.status(400).json({
        ok: false,
        id_potrero_ocupado: usoActual.id_potrero,
        error: `El rodeo ya se encuentra asignado y pastoreando en "${nombrePotActual}". Un mismo rodeo no puede estar en dos potreros a la vez; utilice la opción "Rotar Rodeo" (HU-009) o finalice el pastoreo actual.`
      });
    }

    const calculo = calculateGrazingDays(potrero, rodeo, fecha_ingreso);
    if (calculo.forraje_aprovechable_kg_ms <= 0) {
      conn.release();
      return res.status(400).json({
        ok: false,
        error: `El "${potrero.nombre}" no tiene disponibilidad de pastura cargada (0 kg MS aprovechables). Registre primero la pastura (HU-003).`
      });
    }

    if (calculo.consumo_diario_rodeo_kg_ms <= 0) {
      conn.release();
      return res.status(400).json({
        ok: false,
        error: 'El rodeo tiene 0 cabezas o 0 kg MS de consumo diario. Actualice los datos del rodeo (HU-004).'
      });
    }

    await conn.beginTransaction();

    // HU-005: Tomar el Historial_Rodeo más reciente (o generar uno nuevo si no hay snapshot actualizado)
    const idHistorialRodeo = await ensureLatestHistorialRodeo(conn, rodeo);

    // HU-005 & HU-006: Crear Uso_Potrero con dias_pastoreo_estimados y fecha_fin_estimada
    const [insUso] = await conn.query(
      "INSERT INTO Uso_Potrero (id_potrero, id_rodeo, id_historial_rodeo, fecha_ingreso, fecha_fin_estimada, fecha_fin_real, dias_pastoreo_estimados, estado) VALUES (?, ?, ?, ?, ?, NULL, ?, 'activo')",
      [
        potrero.id_potrero,
        rodeo.id_rodeo,
        idHistorialRodeo,
        calculo.fecha_ingreso,
        calculo.fecha_fin_estimada,
        calculo.dias_pastoreo_estimados
      ]
    );

    const semaforoInicial = calculateSemaphoreStatus({
      estado: 'activo',
      fecha_ingreso: calculo.fecha_ingreso,
      dias_pastoreo_estimados: calculo.dias_pastoreo_estimados
    });

    const nuevoEstadoPotrero =
      semaforoInicial.color === 'verde' ? 'disponible' : 'advertencia';
    await conn.query('UPDATE Potrero SET estado_actual = ? WHERE id_potrero = ?', [
      nuevoEstadoPotrero,
      potrero.id_potrero
    ]);

    await conn.commit();
    conn.release();

    await evaluateSemaphoreAndGenerateAlerts();

    return res.status(201).json({
      ok: true,
      mensaje: `Rodeo asignado a "${potrero.nombre}". Duración estimada: ${calculo.dias_pastoreo_estimados} días (hasta ${calculo.fecha_fin_estimada}).`,
      id_uso_potrero: insUso.insertId,
      calculo,
      semaforo: semaforoInicial
    });
  } catch (err) {
    await conn.rollback();
    conn.release();
    console.error('Error en asignarRodeoAPotrero:', err);
    return res.status(500).json({ ok: false, error: 'Error al asignar el rodeo al potrero.' });
  }
}

/**
 * POST /api/pastoreo/rotar
 * Rota el rodeo desde un potrero con uso activo hacia un nuevo potrero de destino (HU-009):
 * 1) Cierra el Uso_Potrero actual (fecha_fin_real = hoy, estado = 'finalizado').
 * 2) Pasa el potrero saliente a estado_actual = 'descanso'.
 * 3) Crea el nuevo Uso_Potrero en el potrero de destino (repitiendo HU-005 y HU-006).
 */
async function rotarRodeo(req, res) {
  const conn = await db.getConnection();
  try {
    const { id_potrero_origen, id_uso_origen, id_potrero_destino, fecha_ingreso } = req.body;

    if (!id_potrero_destino) {
      conn.release();
      return res.status(400).json({
        ok: false,
        error: 'Debe seleccionar el potrero de destino para realizar la rotación.'
      });
    }

    let usoSaliente = null;
    if (id_uso_origen) {
      const [uRows] = await conn.query('SELECT * FROM Uso_Potrero WHERE id_uso_potrero = ?', [
        Number(id_uso_origen)
      ]);
      usoSaliente = uRows[0];
    } else if (id_potrero_origen) {
      const [uRows] = await conn.query(
        "SELECT * FROM Uso_Potrero WHERE id_potrero = ? AND estado = 'activo'",
        [Number(id_potrero_origen)]
      );
      usoSaliente = uRows[0];
    }

    if (!usoSaliente || usoSaliente.estado !== 'activo') {
      conn.release();
      return res.status(400).json({
        ok: false,
        error: 'No se encontró un pastoreo activo en el potrero de origen para rotar.'
      });
    }

    if (Number(usoSaliente.id_potrero) === Number(id_potrero_destino)) {
      conn.release();
      return res.status(400).json({
        ok: false,
        error: 'El potrero de destino debe ser distinto al potrero de origen.'
      });
    }

    const [potOrigenRows] = await conn.query('SELECT * FROM Potrero WHERE id_potrero = ?', [
      usoSaliente.id_potrero
    ]);
    const potreroOrigen = potOrigenRows[0];

    const [potDestinoRows] = await conn.query('SELECT * FROM Potrero WHERE id_potrero = ?', [
      Number(id_potrero_destino)
    ]);
    const potreroDestino = potDestinoRows[0];
    if (!potreroDestino) {
      conn.release();
      return res.status(404).json({ ok: false, error: 'El potrero de destino no existe.' });
    }

    const [usosActivosDestino] = await conn.query(
      "SELECT * FROM Uso_Potrero WHERE id_potrero = ? AND estado = 'activo'",
      [potreroDestino.id_potrero]
    );
    if (usosActivosDestino.length > 0) {
      conn.release();
      return res.status(400).json({
        ok: false,
        error: `El potrero de destino "${potreroDestino.nombre}" ya se encuentra ocupado con un uso activo.`
      });
    }

    // Verificar que el potrero de destino haya cumplido sus días de descanso y esté en Verde
    const [ultimosFinDestino] = await conn.query(
      "SELECT * FROM Uso_Potrero WHERE id_potrero = ? AND estado = 'finalizado' ORDER BY fecha_fin_real DESC, id_uso_potrero DESC LIMIT 1",
      [potreroDestino.id_potrero]
    );
    const semDestino = calculateSemaphoreStatus(null, potreroDestino, ultimosFinDestino[0] || null);
    if (semDestino.en_descanso) {
      conn.release();
      return res.status(400).json({
        ok: false,
        error: `No se puede rotar hacia "${potreroDestino.nombre}" porque aún está en descanso (faltan ${semDestino.dias_descanso_restantes} de ${semDestino.dias_descanso_requeridos} días para que vuelva a Verde).`
      });
    }

    const [rodeoRows] = await conn.query('SELECT * FROM Rodeo ORDER BY id_rodeo ASC');
    const rodeo = rodeoRows[0];
    if (!rodeo) {
      conn.release();
      return res.status(400).json({ ok: false, error: 'No hay rodeo registrado en el sistema.' });
    }

    const calculoDestino = calculateGrazingDays(potreroDestino, rodeo, fecha_ingreso);
    if (calculoDestino.forraje_aprovechable_kg_ms <= 0) {
      conn.release();
      return res.status(400).json({
        ok: false,
        error: `El potrero de destino "${potreroDestino.nombre}" no tiene disponibilidad de pastura cargada.`
      });
    }

    const hoyYMD = formatDateYMD(getTodayLocal());

    await conn.beginTransaction();

    // 1. Cerrar el Uso_Potrero actual (fecha_fin_real = hoy, estado = 'finalizado')
    await conn.query(
      "UPDATE Uso_Potrero SET fecha_fin_real = ?, estado = 'finalizado' WHERE id_uso_potrero = ?",
      [hoyYMD, usoSaliente.id_uso_potrero]
    );

    // 2. Pasar el potrero saliente a 'descanso' y marcar su alerta de rotación como atendida
    await conn.query('UPDATE Potrero SET estado_actual = ? WHERE id_potrero = ?', [
      'descanso',
      usoSaliente.id_potrero
    ]);
    await conn.query('UPDATE Notificacion SET leida = TRUE WHERE id_uso_potrero = ?', [
      usoSaliente.id_uso_potrero
    ]);

    // 3. Tomar el Historial_Rodeo más reciente (o crear snapshot nuevo)
    const idHistorialRodeo = await ensureLatestHistorialRodeo(conn, rodeo);

    // 4. Crear el nuevo Uso_Potrero para el potrero de destino (HU-005 / HU-006)
    const [insNuevo] = await conn.query(
      "INSERT INTO Uso_Potrero (id_potrero, id_rodeo, id_historial_rodeo, fecha_ingreso, fecha_fin_estimada, fecha_fin_real, dias_pastoreo_estimados, estado) VALUES (?, ?, ?, ?, ?, NULL, ?, 'activo')",
      [
        potreroDestino.id_potrero,
        rodeo.id_rodeo,
        idHistorialRodeo,
        calculoDestino.fecha_ingreso,
        calculoDestino.fecha_fin_estimada,
        calculoDestino.dias_pastoreo_estimados
      ]
    );

    await conn.query('UPDATE Potrero SET estado_actual = ? WHERE id_potrero = ?', [
      'disponible',
      potreroDestino.id_potrero
    ]);

    await conn.commit();
    conn.release();

    await evaluateSemaphoreAndGenerateAlerts();

    return res.json({
      ok: true,
      mensaje: `Rotación completada: Se cerró el pastoreo en "${potreroOrigen ? potreroOrigen.nombre : 'potrero anterior'}" (en descanso) y el rodeo ingresó a "${potreroDestino.nombre}" por ${calculoDestino.dias_pastoreo_estimados} días estimados.`,
      id_uso_finalizado: usoSaliente.id_uso_potrero,
      id_uso_nuevo: insNuevo.insertId,
      calculo_destino: calculoDestino
    });
  } catch (err) {
    await conn.rollback();
    conn.release();
    console.error('Error en rotarRodeo:', err);
    return res.status(500).json({ ok: false, error: 'Error al procesar la rotación del rodeo.' });
  }
}

/**
 * POST /api/pastoreo/:id/finalizar
 * Finaliza manualmente un Uso_Potrero activo sin reasignar a otro potrero.
 */
async function finalizarUsoPotrero(req, res) {
  try {
    const idUso = Number(req.params.id);
    const [rows] = await db.query('SELECT * FROM Uso_Potrero WHERE id_uso_potrero = ?', [idUso]);
    const uso = rows[0];

    if (!uso || uso.estado !== 'activo') {
      return res.status(404).json({
        ok: false,
        error: 'No se encontró un uso de pastoreo activo con ese identificador.'
      });
    }

    const hoyYMD = formatDateYMD(getTodayLocal());
    await db.query(
      "UPDATE Uso_Potrero SET fecha_fin_real = ?, estado = 'finalizado' WHERE id_uso_potrero = ?",
      [hoyYMD, idUso]
    );
    await db.query('UPDATE Potrero SET estado_actual = ? WHERE id_potrero = ?', [
      'descanso',
      uso.id_potrero
    ]);

    return res.json({
      ok: true,
      mensaje: 'Pastoreo finalizado correctamente y potrero puesto en descanso.'
    });
  } catch (err) {
    console.error('Error en finalizarUsoPotrero:', err);
    return res.status(500).json({ ok: false, error: 'Error al finalizar el pastoreo.' });
  }
}

/**
 * GET /api/potreros/:id/historial
 * Consulta el historial de uso de un potrero específico junto con la composición del rodeo
 * asignado en ese momento vía Historial_Rodeo (HU-010).
 */
async function consultarHistorialPorPotrero(req, res) {
  try {
    const idPotrero = Number(req.params.id);
    const [rows] = await db.query(
      `SELECT up.*, p.nombre AS potrero_nombre, p.tipo_pastura, p.superficie_ha,
              hr.fecha_registro AS fecha_snapshot, hr.cant_vacas_ordene, hr.cant_vacas_secas,
              hr.cant_vaquillonas, hr.cant_terneras, hr.consumo_diario_prom_kg_ms
       FROM Uso_Potrero up
       JOIN Potrero p ON up.id_potrero = p.id_potrero
       JOIN Historial_Rodeo hr ON up.id_historial_rodeo = hr.id_historial_rodeo
       WHERE up.id_potrero = ?
       ORDER BY up.fecha_ingreso DESC, up.id_uso_potrero DESC`,
      [idPotrero]
    );

    const historial = rows.map(formatHistorialRow);
    return res.json({
      ok: true,
      historial
    });
  } catch (err) {
    console.error('Error en consultarHistorialPorPotrero:', err);
    return res.status(500).json({ ok: false, error: 'Error al consultar el historial del potrero.' });
  }
}

/**
 * GET /api/pastoreo/historial
 * Consulta el historial de uso de todos los potreros del establecimiento (HU-010).
 */
async function consultarHistorialGeneral(req, res) {
  try {
    const [estRows] = await db.query(
      'SELECT * FROM Establecimiento WHERE id_productor = ? ORDER BY id_establecimiento ASC',
      [req.user.id_productor]
    );
    if (estRows.length === 0) {
      return res.json({ ok: true, historial: [] });
    }

    const todos = [];
    for (const est of estRows) {
      const [rows] = await db.query(
        `SELECT up.*, p.nombre AS potrero_nombre, p.tipo_pastura, p.superficie_ha,
                hr.fecha_registro AS fecha_snapshot, hr.cant_vacas_ordene, hr.cant_vacas_secas,
                hr.cant_vaquillonas, hr.cant_terneras, hr.consumo_diario_prom_kg_ms
         FROM Uso_Potrero up
         JOIN Potrero p ON up.id_potrero = p.id_potrero
         JOIN Historial_Rodeo hr ON up.id_historial_rodeo = hr.id_historial_rodeo
         WHERE p.id_establecimiento = ?
         ORDER BY up.fecha_ingreso DESC, up.id_uso_potrero DESC`,
        [est.id_establecimiento]
      );
      rows.forEach((r) => {
        todos.push({
          ...formatHistorialRow(r),
          establecimiento_nombre: est.nombre
        });
      });
    }

    todos.sort((a, b) => {
      const diff = new Date(b.fecha_ingreso) - new Date(a.fecha_ingreso);
      return diff !== 0 ? diff : Number(b.id_uso_potrero) - Number(a.id_uso_potrero);
    });

    return res.json({
      ok: true,
      historial: todos
    });
  } catch (err) {
    console.error('Error en consultarHistorialGeneral:', err);
    return res.status(500).json({ ok: false, error: 'Error al consultar el historial general.' });
  }
}

function formatHistorialRow(r) {
  const totalAnimales =
    Number(r.cant_vacas_ordene || 0) +
    Number(r.cant_vacas_secas || 0) +
    Number(r.cant_vaquillonas || 0) +
    Number(r.cant_terneras || 0);
  const consumoProm = Number(r.consumo_diario_prom_kg_ms || 0);
  const consumoTotalRodeo = Number((totalAnimales * consumoProm).toFixed(2));

  const fIngreso = parseDateLocal(r.fecha_ingreso);
  const fFinRef = r.fecha_fin_real ? parseDateLocal(r.fecha_fin_real) : getTodayLocal();
  const diasReales = Math.max(
    0,
    Math.floor((fFinRef.getTime() - fIngreso.getTime()) / (1000 * 60 * 60 * 24))
  );

  return {
    ...r,
    total_animales_snapshot: totalAnimales,
    consumo_diario_rodeo_snapshot_kg_ms: consumoTotalRodeo,
    dias_reales_transcurridos: diasReales
  };
}

module.exports = {
  simularCalculoPastoreo,
  asignarRodeoAPotrero,
  rotarRodeo,
  finalizarUsoPotrero,
  consultarHistorialPorPotrero,
  consultarHistorialGeneral
};
