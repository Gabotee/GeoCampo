const assert = require('assert');
const { app } = require('../server');
const db = require('../config/db');

async function runVerification() {
  console.log('🧪 Iniciando verificación integral de Seguridad y de las 10 Historias de Usuario...');
  await db.initDatabase();

  // Reiniciar a datos semilla limpios antes de la prueba
  db.localDbEngine.resetToSeed();

  const server = app.listen(0);
  const port = server.address().port;
  const baseUrl = `http://localhost:${port}`;

  async function req(path, method = 'GET', body = null, token = null) {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(`${baseUrl}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined
    });
    const data = await res.json();
    return { status: res.status, data };
  }

  try {
    // 1. SEGURIDAD: Bloqueo a los 5 intentos fallidos + Recuperación por Token + No repetir últimas 3 claves
    console.log('  🔹 Probando Seguridad (5 intentos fallidos -> bloqueo -> recuperación por token)...');
    for (let i = 1; i <= 5; i++) {
      const r = await req('/api/auth/login', 'POST', {
        email: 'productor@elaranado.com',
        password: 'ClaveIncorrecta123!'
      });
      if (i < 5) {
        assert.strictEqual(r.status, 401);
      } else {
        assert.strictEqual(r.status, 403);
        assert.strictEqual(r.data.bloqueado, true);
      }
    }

    // Solicitar token de recuperación
    const recReq = await req('/api/auth/solicitar-recuperacion', 'POST', {
      email: 'productor@elaranado.com'
    });
    assert.strictEqual(recReq.status, 200);
    const recoveryToken = recReq.data.token_simulado;
    assert.ok(recoveryToken, 'Debe existir token_simulado');

    // Intentar usar la misma contraseña anterior (debe fallar por historial de últimas 3)
    const samePassRes = await req('/api/auth/restablecer-clave', 'POST', {
      token: recoveryToken,
      nuevaContrasena: 'Campo2026!'
    });
    assert.strictEqual(samePassRes.status, 400);

    // Restablecer con nueva contraseña válida
    const newPassRes = await req('/api/auth/restablecer-clave', 'POST', {
      token: recoveryToken,
      nuevaContrasena: 'TamboCordoba2026#'
    });
    assert.strictEqual(newPassRes.status, 200);

    // Login exitoso con nueva contraseña
    const loginRes = await req('/api/auth/login', 'POST', {
      email: 'productor@elaranado.com',
      password: 'TamboCordoba2026#'
    });
    assert.strictEqual(loginRes.status, 200);
    const token = loginRes.data.token;
    assert.ok(token, 'Token JWT emitido');
    console.log('  ✅ Seguridad verificada correctamente.');

    // 2. HU-001 — Delimitar establecimiento
    console.log('  🔹 Probando HU-001 (Delimitar establecimiento + Turf.js)...');
    const estGet = await req('/api/establecimiento', 'GET', null, token);
    assert.strictEqual(estGet.status, 200);
    assert.strictEqual(estGet.data.establecimiento.superficie_total_ha, 117);
    console.log('  ✅ HU-001 verificada.');

    // 3. HU-002 y HU-003 — Dividir en potreros y Registrar pastura
    console.log('  🔹 Probando HU-002 y HU-003 (Crear potrero, calcular ha con Turf.js y editar pastura)...');
    const nuevoPotreroPoly = {
      type: 'Feature',
      properties: {},
      geometry: {
        type: 'Polygon',
        coordinates: [[
          [-62.7295, -31.7345],
          [-62.7275, -31.7345],
          [-62.7275, -31.7365],
          [-62.7295, -31.7365],
          [-62.7295, -31.7345]
        ]]
      }
    };
    const createPot = await req(
      '/api/potreros',
      'POST',
      {
        nombre: 'Potrero 7 - Prueba Experimental',
        poligono: nuevoPotreroPoly,
        tipo_pastura: 'Alfalfa Grupo 9',
        disponibilidad_kg_ms_ha: 2500,
        porcentaje_aprovechable: 80,
        observaciones: 'Lote experimental'
      },
      token
    );
    assert.strictEqual(createPot.status, 201);
    const idPotrero7 = createPot.data.potrero.id_potrero;
    assert.ok(createPot.data.potrero.superficie_ha > 0, 'Turf.js calculó superficie_ha > 0');

    const editPot = await req(
      `/api/potreros/${idPotrero7}`,
      'PUT',
      {
        nombre: 'Potrero 7 - Alfalfa Editada',
        disponibilidad_kg_ms_ha: 3000,
        porcentaje_aprovechable: 75
      },
      token
    );
    assert.strictEqual(editPot.status, 200);
    assert.strictEqual(Number(editPot.data.potrero.disponibilidad_kg_ms_ha), 3000);
    console.log('  ✅ HU-002 y HU-003 verificadas.');

    // 4. HU-004 — Registrar rodeo y generar snapshot automático en Historial_Rodeo
    console.log('  🔹 Probando HU-004 (Actualizar rodeo + snapshot automático en Historial_Rodeo)...');
    const rodeoPut = await req(
      '/api/rodeo',
      'PUT',
      {
        cant_vacas_ordene: 90,
        cant_vacas_secas: 20,
        cant_vaquillonas: 25,
        cant_terneras: 25,
        consumo_diario_prom_kg_ms: 15.0
      },
      token
    );
    assert.strictEqual(rodeoPut.status, 200);
    assert.strictEqual(rodeoPut.data.rodeo.total_animales, 160);
    assert.strictEqual(rodeoPut.data.rodeo.consumo_diario_total_kg_ms, 2400);
    assert.ok(rodeoPut.data.id_historial_generado >= 4, 'Snapshot creado en Historial_Rodeo');
    console.log('  ✅ HU-004 verificada.');

    // 5. HU-007 y HU-008 — Semáforo de colores y Notificaciones en estado Rojo
    console.log('  🔹 Probando HU-007 (Semáforo) y HU-008 (Notificaciones)...');
    const potList = await req('/api/potreros', 'GET', null, token);
    assert.strictEqual(potList.status, 200);
    const coloresPresentes = new Set(potList.data.potreros.map((p) => p.semaforo.color));
    assert.ok(coloresPresentes.has('rojo'), 'Existe potrero en rojo');
    assert.ok(coloresPresentes.has('verde'), 'Existe potrero en verde');

    const notifList = await req('/api/notificaciones', 'GET', null, token);
    assert.strictEqual(notifList.status, 200);
    assert.ok(notifList.data.notificaciones.length > 0, 'Notificación generada para potrero en rojo');
    console.log('  ✅ HU-007 y HU-008 verificadas.');

    // 6. Validar restricción de Rodeo Único (no permitir doble asignación simultánea)
    console.log('  🔹 Probando restricción de Rodeo Único (rechazar doble asignación simultánea)...');
    const dobleAsignacion = await req(
      '/api/pastoreo/asignar',
      'POST',
      { id_potrero: idPotrero7 },
      token
    );
    assert.strictEqual(dobleAsignacion.status, 400, 'Debe rechazar asignar si el rodeo ya está en otro potrero');
    console.log('  ✅ Restricción de Rodeo Único verificada.');

    // 7. HU-009 y HU-010 — Rotar rodeo y Consultar historial de uso + Período de Descanso en Rojo
    console.log('  🔹 Probando HU-009 (Rotar rodeo, verificar que el lote saliente queda en ROJO por descanso) y HU-010...');
    const rotarRes = await req(
      '/api/pastoreo/rotar',
      'POST',
      {
        id_potrero_origen: 1, // Potrero 1 (en rojo)
        id_potrero_destino: 5 // Potrero 5 (disponible en verde)
      },
      token
    );
    assert.strictEqual(rotarRes.status, 200);
    const idUsoNuevo = rotarRes.data.id_uso_nuevo;

    // Verificar que Potrero 1 NO pasó a verde, sino que sigue en ROJO por descanso (30 días restantes)
    const potListPostRot = await req('/api/potreros', 'GET', null, token);
    const pot1Post = potListPostRot.data.potreros.find((p) => Number(p.id_potrero) === 1);
    assert.strictEqual(pot1Post.semaforo.color, 'rojo', 'Potrero recién rotado debe permanecer en ROJO');
    assert.strictEqual(pot1Post.semaforo.en_descanso, true, 'Potrero recién rotado debe estar en descanso');
    assert.strictEqual(pot1Post.semaforo.dias_descanso_restantes, 30, 'Deben faltar 30 días de descanso');

    // Verificar que no se puede rotar hacia un potrero que aún está en descanso (ej. Potrero 1 o Potrero 4)
    const rotarADescanso = await req(
      '/api/pastoreo/rotar',
      'POST',
      {
        id_potrero_origen: 5,
        id_potrero_destino: 1
      },
      token
    );
    assert.strictEqual(rotarADescanso.status, 400, 'Debe bloquear rotar hacia un potrero en descanso');

    const histPot1 = await req('/api/potreros/1/historial', 'GET', null, token);
    assert.strictEqual(histPot1.status, 200);
    assert.strictEqual(histPot1.data.historial[0].estado, 'finalizado');
    assert.ok(histPot1.data.historial[0].fecha_fin_real, 'fecha_fin_real registrada al rotar');
    console.log('  ✅ HU-009, Período de Descanso en Rojo y HU-010 verificadas.');

    // 8. HU-005 y HU-006 — Finalizar uso activo y Asignar rodeo libre a nuevo potrero
    console.log('  🔹 Probando HU-005 y HU-006 (Asignar rodeo libre y calcular días de pastoreo)...');
    const finRes = await req(`/api/pastoreo/${idUsoNuevo}/finalizar`, 'POST', {}, token);
    assert.strictEqual(finRes.status, 200);

    const asignarRes = await req(
      '/api/pastoreo/asignar',
      'POST',
      {
        id_potrero: idPotrero7
      },
      token
    );
    assert.strictEqual(asignarRes.status, 201);
    assert.ok(asignarRes.data.calculo.dias_pastoreo_estimados > 0);
    console.log('  ✅ HU-005 y HU-006 verificadas.');

    // Restaurar datos semilla originales para dejar la app lista con credenciales demo (Campo2026!)
    db.localDbEngine.resetToSeed();
    console.log('\n🎉 TODAS LAS PRUEBAS (SEGURIDAD + HU-001 A HU-010) PASARON EXITOSAMENTE.');
  } finally {
    server.close();
    process.exit(0);
  }
}

runVerification().catch((err) => {
  console.error('❌ Falló la verificación:', err);
  process.exit(1);
});
