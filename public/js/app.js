/**
 * GeoCampo - Controlador Principal Frontend (HU-001 a HU-010)
 * Integra Leaflet.js + Esri World Imagery + Leaflet.draw + Turf.js + API REST
 */
document.addEventListener('DOMContentLoaded', async () => {
  if (!API.getToken()) {
    window.location.href = '/login.html';
    return;
  }

  // Estado global en cliente
  const state = {
    establecimientos: [],
    establecimiento: null,
    selectedEstablecimientoId: 'todos',
    potreros: [],
    rodeo: null,
    historialRodeo: [],
    notificaciones: [],
    selectedPotreroId: null,
    semaphoreFilter: 'todos',
    drawMode: null, // 'establecimiento' | 'redibujar_establecimiento' | 'nuevo_potrero' | 'redibujar_potrero'
    pendingPolygonGeoJSON: null,
    pendingAreaHa: 0
  };

  // ==========================================================================
  // 1. INICIALIZACIÓN DE MAPA LEAFLET + ESRI WORLD IMAGERY + LEAFLET.DRAW
  // ==========================================================================
  const DEFAULT_COORDS = [-31.73794, -62.72313]; // El Arañado, Córdoba

  const esriSat = L.tileLayer(
    'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    {
      maxZoom: 19,
      attribution: 'Tiles &copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics'
    }
  );

  const esriLabels = L.tileLayer(
    'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
    {
      maxZoom: 19
    }
  );

  const osmLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap contributors'
  });

  const satelliteWithLabels = L.layerGroup([esriSat, esriLabels]);

  const map = L.map('map', {
    center: DEFAULT_COORDS,
    zoom: 15,
    layers: [satelliteWithLabels]
  });

  L.control
    .layers(
      {
        '🛰️ Satelital Esri World Imagery': satelliteWithLabels,
        '🗺️ Mapa Callejero OSM': osmLayer
      },
      null,
      { position: 'topright' }
    )
    .addTo(map);

  const estLayerGroup = L.featureGroup().addTo(map);
  const potrerosLayerGroup = L.featureGroup().addTo(map);
  const labelsLayerGroup = L.layerGroup().addTo(map);

  // Manejador de dibujo programático con Leaflet.draw
  let activePolygonDrawer = null;

  function startPolygonDrawing(mode, bannerText) {
    cancelPolygonDrawing();
    state.drawMode = mode;
    document.getElementById('drawing-banner-msg').textContent = bannerText;
    document.getElementById('drawing-banner').classList.remove('hidden');

    const color = mode === 'establecimiento' ? '#38bdf8' : '#22c55e';
    activePolygonDrawer = new L.Draw.Polygon(map, {
      allowIntersection: false,
      showArea: true,
      shapeOptions: {
        color,
        weight: 3,
        fillOpacity: 0.35
      }
    });
    activePolygonDrawer.enable();
  }

  function cancelPolygonDrawing() {
    if (activePolygonDrawer) {
      activePolygonDrawer.disable();
      activePolygonDrawer = null;
    }
    state.drawMode = null;
    document.getElementById('drawing-banner').classList.add('hidden');
  }

  document.getElementById('btn-cancel-draw').addEventListener('click', cancelPolygonDrawing);

  // Evento al finalizar dibujo de polígono en Leaflet.draw
  map.on(L.Draw.Event.CREATED, async (event) => {
    const layer = event.layer;
    const geojson = layer.toGeoJSON();

    // Cálculo de superficie en hectáreas con Turf.js (HU-001 y HU-002)
    const areaSqMeters = turf.area(geojson);
    const superficieHa = Number((areaSqMeters / 10000).toFixed(2));
    const currentMode = state.drawMode;
    cancelPolygonDrawing();

    if (currentMode === 'establecimiento') {
      const nro = state.establecimientos.length + 1;
      const nombreSugerido = `Establecimiento ${nro} - El Arañado`;
      const nombre = prompt(
        `Superficie calculada con Turf.js: ${superficieHa} ha.\nIngrese el nombre del nuevo Establecimiento:`,
        nombreSugerido
      );
      if (!nombre) return;

      try {
        const res = await API.post('/api/establecimiento', {
          nombre,
          poligono: geojson,
          superficie_total_ha: superficieHa
        });
        state.selectedEstablecimientoId = String(res.establecimiento.id_establecimiento);
        showToast(res.mensaje);
        await loadAllData(true);
      } catch (err) {
        showToast(err.message, true);
      }
    } else if (currentMode === 'redibujar_establecimiento' && state.selectedEstablecimientoId !== 'todos') {
      try {
        const res = await API.put(`/api/establecimiento/${state.selectedEstablecimientoId}`, {
          poligono: geojson,
          superficie_total_ha: superficieHa
        });
        showToast(res.mensaje);
        await loadAllData(true);
      } catch (err) {
        showToast(err.message, true);
      }
    } else if (currentMode === 'nuevo_potrero') {
      state.pendingPolygonGeoJSON = geojson;
      state.pendingAreaHa = superficieHa;
      document.getElementById('new-potrero-ha-label').textContent = `${superficieHa} ha`;
      document.getElementById('new-potrero-nombre').value = `Potrero ${state.potreros.length + 1}`;
      openModal('modal-new-potrero');
    } else if (currentMode === 'redibujar_potrero' && state.selectedPotreroId) {
      try {
        const pot = state.potreros.find((p) => p.id_potrero === state.selectedPotreroId);
        const res = await API.put(`/api/potreros/${state.selectedPotreroId}`, {
          nombre: pot ? pot.nombre : undefined,
          poligono: geojson,
          superficie_ha: superficieHa
        });
        showToast(`${res.mensaje} Nueva superficie: ${superficieHa} ha.`);
        await loadAllData(false);
        openPotreroDrawer(state.selectedPotreroId);
      } catch (err) {
        showToast(err.message, true);
      }
    }
  });

  // ==========================================================================
  // 2. CARGA DE DATOS INTEGRAL Y RENDERIZADO DE MAPA / SEMÁFORO
  // ==========================================================================
  async function loadAllData(fitBounds = false) {
    try {
      const [estRes, potRes, rodeoRes, notifRes] = await Promise.all([
        API.get('/api/establecimiento'),
        API.get('/api/potreros'),
        API.get('/api/rodeo'),
        API.get('/api/notificaciones')
      ]);

      state.establecimientos = estRes.establecimientos || [];
      if (
        state.selectedEstablecimientoId !== 'todos' &&
        !state.establecimientos.some(
          (e) => String(e.id_establecimiento) === String(state.selectedEstablecimientoId)
        )
      ) {
        state.selectedEstablecimientoId = 'todos';
      }
      state.establecimiento =
        state.selectedEstablecimientoId !== 'todos'
          ? state.establecimientos.find(
              (e) => String(e.id_establecimiento) === String(state.selectedEstablecimientoId)
            ) || state.establecimientos[0] || null
          : state.establecimientos[0] || null;

      state.potreros = potRes.potreros || [];
      state.rodeo = rodeoRes.rodeo;
      state.historialRodeo = rodeoRes.historial || [];
      state.notificaciones = notifRes.notificaciones || [];

      renderTopbarAndSidebarSummary();
      renderMapLayers(fitBounds);
      renderPotrerosSidebarList();
      renderNotificacionesUI(notifRes.no_leidas_count || 0);

      if (state.selectedPotreroId) {
        const stillExists = state.potreros.some((p) => p.id_potrero === state.selectedPotreroId);
        if (stillExists) {
          openPotreroDrawer(state.selectedPotreroId);
        } else {
          closePotreroDrawer();
        }
      }
    } catch (err) {
      showToast(err.message, true);
    }
  }

  function renderTopbarAndSidebarSummary() {
    const ests = state.establecimientos || [];
    const rodeo = state.rodeo;
    const selId = state.selectedEstablecimientoId;
    const selEst =
      selId !== 'todos'
        ? ests.find((e) => String(e.id_establecimiento) === String(selId))
        : null;

    // Poblar selector de establecimientos en la barra lateral
    const selectEl = document.getElementById('select-establecimiento');
    const totalHaGlobal = Number(
      ests.reduce((acc, e) => acc + Number(e.superficie_total_ha || 0), 0).toFixed(2)
    );
    const totalDivididaGlobal = Number(
      ests.reduce((acc, e) => acc + Number(e.superficie_dividida_ha || 0), 0).toFixed(2)
    );

    selectEl.innerHTML =
      `<option value="todos" ${selId === 'todos' ? 'selected' : ''}>📍 Todos los campos (${ests.length})</option>` +
      ests
        .map(
          (e) =>
            `<option value="${e.id_establecimiento}" ${
              String(selId) === String(e.id_establecimiento) ? 'selected' : ''
            }>🏡 ${e.nombre} (${e.superficie_total_ha} ha)</option>`
        )
        .join('');

    const editBtn = document.getElementById('btn-edit-establecimiento');
    const delBtn = document.getElementById('btn-delete-establecimiento');
    if (selEst) {
      editBtn.style.display = 'inline-flex';
      delBtn.style.display = 'inline-flex';
    } else {
      editBtn.style.display = 'none';
      delBtn.style.display = 'none';
    }

    if (ests.length === 0) {
      document.getElementById('top-est-name').innerHTML = '📍 Sin establecimientos delimitados';
      document.getElementById('top-est-area').innerHTML = '📐 0 ha';
      document.getElementById('side-total-ha').textContent = '0 ha';
      document.getElementById('side-potreros-ha').textContent = '0 ha';
    } else if (selEst) {
      const potCount = state.potreros.filter(
        (p) => Number(p.id_establecimiento) === Number(selEst.id_establecimiento)
      ).length;
      document.getElementById('top-est-name').innerHTML = `📍 <strong>${selEst.nombre}</strong>`;
      document.getElementById('top-est-area').innerHTML = `📐 <strong>${selEst.superficie_total_ha} ha</strong>`;
      document.getElementById('side-total-ha').textContent = `${selEst.superficie_total_ha} ha`;
      document.getElementById('side-potreros-ha').textContent = `${selEst.superficie_dividida_ha} ha (${potCount} lotes)`;
    } else {
      document.getElementById('top-est-name').innerHTML =
        ests.length === 1
          ? `📍 <strong>${ests[0].nombre}</strong>`
          : `📍 <strong>${ests.length} Establecimientos</strong>`;
      document.getElementById('top-est-area').innerHTML = `📐 <strong>${totalHaGlobal} ha totales</strong>`;
      document.getElementById('side-total-ha').textContent = `${totalHaGlobal} ha`;
      document.getElementById('side-potreros-ha').textContent = `${totalDivididaGlobal} ha (${state.potreros.length} lotes)`;
    }

    if (rodeo) {
      document.getElementById('top-rodeo-summary').innerHTML =
        `🐄 <strong>${rodeo.total_animales} cab.</strong> (${rodeo.consumo_diario_total_kg_ms} kg MS/día)`;
      document.getElementById('nav-rodeo-heads').textContent = `(${rodeo.total_animales})`;
    } else {
      document.getElementById('top-rodeo-summary').innerHTML = `🐄 <strong>0 cab.</strong> (0 kg MS/día)`;
      document.getElementById('nav-rodeo-heads').textContent = '(0)';
    }
  }

  function renderMapLayers(fitBounds = false) {
    estLayerGroup.clearLayers();
    potrerosLayerGroup.clearLayers();
    labelsLayerGroup.clearLayers();

    // 1. Polígonos perimetrales de TODOS los establecimientos (HU-001)
    let selectedEstBounds = null;
    (state.establecimientos || []).forEach((est) => {
      if (!est.poligono) return;
      const isSelectedEst =
        state.selectedEstablecimientoId !== 'todos' &&
        String(est.id_establecimiento) === String(state.selectedEstablecimientoId);

      const estGeoLayer = L.geoJSON(est.poligono, {
        style: {
          color: isSelectedEst ? '#facc15' : '#38bdf8',
          weight: isSelectedEst ? 4 : 3,
          dashArray: '8, 6',
          fillColor: '#0284c7',
          fillOpacity: isSelectedEst ? 0.1 : 0.05
        }
      });

      estGeoLayer.bindTooltip(`🏡 ${est.nombre} (${est.superficie_total_ha} ha)`, {
        sticky: true,
        direction: 'top'
      });

      estLayerGroup.addLayer(estGeoLayer);
      if (isSelectedEst) {
        selectedEstBounds = estGeoLayer.getBounds();
      }
    });

    // 2. Sub-polígonos de Potreros coloreados por Semáforo (HU-002 y HU-007)
    state.potreros.forEach((p) => {
      if (!p.poligono) return;

      const sem = p.semaforo || { color: 'verde', hex: '#22c55e', en_uso: false };
      const isSelected = p.id_potrero === state.selectedPotreroId;

      let fillColor = '#22c55e';
      let borderColor = '#ffffff';
      let fillOpacity = 0.42;

      if (sem.color === 'rojo') {
        fillColor = '#ef4444';
        borderColor = '#fef2f2';
        fillOpacity = 0.65;
      } else if (sem.color === 'amarillo') {
        fillColor = '#eab308';
        borderColor = '#fefce8';
        fillOpacity = 0.6;
      } else if (sem.en_uso) {
        fillColor = '#16a34a';
        borderColor = '#bbf7d0';
        fillOpacity = 0.55;
      }

      const layer = L.geoJSON(p.poligono, {
        style: {
          color: isSelected ? '#38bdf8' : borderColor,
          weight: isSelected ? 4 : 2,
          fillColor,
          fillOpacity
        }
      });

      layer.on('click', () => {
        openPotreroDrawer(p.id_potrero);
      });

      potrerosLayerGroup.addLayer(layer);

      // Etiqueta central permanente con nombre, hectáreas y días restantes
      try {
        const center = turf.centroid(p.poligono);
        const [lng, lat] = center.geometry.coordinates;
        const diasTxt = sem.en_uso
          ? `🐄 EN USO ${sem.dias_restantes}d rest.`
          : sem.en_descanso
            ? `🌱 Descanso (${sem.dias_descanso_restantes}d)`
            : '✔ Disponible';

        const labelMarker = L.marker([lat, lng], {
          icon: L.divIcon({
            className: 'potrero-map-label',
            html: `<div>${p.nombre}</div><div style="font-weight:400; font-size:10px;">${p.superficie_ha} ha • ${diasTxt}</div>`,
            iconSize: [145, 34],
            iconAnchor: [72, 17]
          }),
          interactive: false
        });
        labelsLayerGroup.addLayer(labelMarker);
      } catch (_) { }
    });

    if (fitBounds) {
      if (selectedEstBounds) {
        map.fitBounds(selectedEstBounds, { padding: [35, 35] });
      } else if (estLayerGroup.getLayers().length > 0) {
        map.fitBounds(estLayerGroup.getBounds(), { padding: [30, 30] });
      } else if (potrerosLayerGroup.getLayers().length > 0) {
        map.fitBounds(potrerosLayerGroup.getBounds(), { padding: [30, 30] });
      }
    }
  }

  function renderPotrerosSidebarList() {
    const container = document.getElementById('potreros-list');
    container.innerHTML = '';

    if (!state.establecimientos || state.establecimientos.length === 0) {
      container.innerHTML = `
        <div style="padding:1.25rem; text-align:center; color:var(--text-muted); font-size:0.86rem;">
          📍 <strong>Sin establecimientos delimitados</strong><br/><br/>
          Navegue en el mapa satelital hasta su campo y haga clic en <strong>"📐 Nuevo Campo"</strong> para dibujar el perímetro de su terreno. Puede agregar todos los establecimientos que necesite.
        </div>
      `;
      return;
    }

    const byEstablecimiento =
      state.selectedEstablecimientoId === 'todos'
        ? state.potreros
        : state.potreros.filter(
            (p) => String(p.id_establecimiento) === String(state.selectedEstablecimientoId)
          );

    if (byEstablecimiento.length === 0) {
      const selEst = state.establecimientos.find(
        (e) => String(e.id_establecimiento) === String(state.selectedEstablecimientoId)
      );
      container.innerHTML = `
        <div style="padding:1.25rem; text-align:center; color:var(--text-muted); font-size:0.86rem;">
          ✅ <strong>${selEst ? selEst.nombre : 'Establecimientos listos'}</strong><br/><br/>
          Aún no hay potreros en esta vista. Haga clic en <strong>"➕ Agregar Potrero"</strong> para dibujar los lotes dentro del campo.
        </div>
      `;
      return;
    }

    const filtered = byEstablecimiento.filter((p) => {
      if (state.semaphoreFilter === 'todos') return true;
      return p.semaforo && p.semaforo.color === state.semaphoreFilter;
    });

    if (filtered.length === 0) {
      container.innerHTML = `
        <div style="padding:1.25rem; text-align:center; color:var(--text-muted); font-size:0.86rem;">
          No hay potreros para el filtro seleccionado.
        </div>
      `;
      return;
    }

    filtered.forEach((p) => {
      const sem = p.semaforo || { color: 'verde', etiqueta: 'Disponible' };
      const card = document.createElement('div');
      card.className = `potrero-item-card sem-${sem.color} ${
        p.id_potrero === state.selectedPotreroId ? 'active' : ''
      }`;

      const badgeText = sem.en_uso
        ? sem.color === 'rojo'
          ? `🔴 Rotar (${sem.dias_restantes}d)`
          : sem.color === 'amarillo'
          ? `🟡 Quedan ${sem.dias_restantes}d`
          : `🟢 Pastoreo (${sem.dias_restantes}d)`
        : sem.en_descanso
        ? `🔴 Descanso (${sem.dias_descanso_restantes}d)`
        : '🟢 Libre';

      const estSub =
        state.establecimientos.length > 1 && p.establecimiento_nombre
          ? `<div style="font-size:0.73rem; color:var(--accent-blue); font-weight:600;">🏡 ${p.establecimiento_nombre}</div>`
          : '';

      card.innerHTML = `
        <div class="potrero-card-header">
          <span>${p.nombre}</span>
          <span class="sem-badge ${sem.color}">${badgeText}</span>
        </div>
        ${estSub}
        <div style="font-size:0.81rem; color:#334155;">
          🌾 ${p.tipo_pastura}
        </div>
        <div class="potrero-card-meta">
          <span>📐 <strong>${p.superficie_ha} ha</strong></span>
          <span>⚖️ ${Number(p.forraje_aprovechable_kg_ms || 0).toLocaleString('es-AR')} kg MS</span>
        </div>
      `;

      card.addEventListener('click', () => {
        openPotreroDrawer(p.id_potrero);
        if (p.poligono) {
          const geo = L.geoJSON(p.poligono);
          map.fitBounds(geo.getBounds(), { maxZoom: 16, padding: [50, 50] });
        }
      });

      container.appendChild(card);
    });
  }

  // ==========================================================================
  // 3. FICHA DE POTRERO LATERAL DERECHA (HU-002, HU-003, HU-005, HU-006, HU-009)
  // ==========================================================================
  function openPotreroDrawer(idPotrero) {
    const potrero = state.potreros.find((p) => p.id_potrero === Number(idPotrero));
    if (!potrero) return;

    state.selectedPotreroId = potrero.id_potrero;
    renderPotrerosSidebarList();
    renderMapLayers(false);

    const drawer = document.getElementById('potrero-drawer');
    drawer.classList.remove('hidden');

    document.getElementById('drawer-title').textContent = potrero.nombre;
    const badge = document.getElementById('drawer-sem-badge');
    badge.className = `sem-badge ${potrero.semaforo.color}`;
    badge.textContent = potrero.semaforo.etiqueta;

    // Cargar formulario de datos y pastura (HU-002 / HU-003)
    document.getElementById('edit-potrero-id').value = potrero.id_potrero;
    document.getElementById('edit-potrero-nombre').value = potrero.nombre;
    document.getElementById('edit-potrero-ha').value = potrero.superficie_ha;
    document.getElementById('edit-potrero-pastura').value = potrero.tipo_pastura;
    document.getElementById('edit-potrero-disp').value = potrero.disponibilidad_kg_ms_ha;
    document.getElementById('edit-potrero-porc').value = potrero.porcentaje_aprovechable;
    document.getElementById('edit-potrero-obs').value = potrero.observaciones || '';

    updateLivePasturePreview();
    renderDrawerGrazingSection(potrero);
  }

  function closePotreroDrawer() {
    state.selectedPotreroId = null;
    document.getElementById('potrero-drawer').classList.add('hidden');
    renderPotrerosSidebarList();
    renderMapLayers(false);
  }

  document.getElementById('btn-close-drawer').addEventListener('click', closePotreroDrawer);

  function updateLivePasturePreview() {
    const ha = Number(document.getElementById('edit-potrero-ha').value || 0);
    const disp = Number(document.getElementById('edit-potrero-disp').value || 0);
    const porc = Number(document.getElementById('edit-potrero-porc').value || 0);
    const forrajeAprov = Math.round(ha * disp * (porc / 100));

    const consumoDiarioRodeo = state.rodeo
      ? Number(state.rodeo.consumo_diario_total_kg_ms || 0)
      : 0;
    const diasEst =
      forrajeAprov > 0 && consumoDiarioRodeo > 0
        ? Math.max(1, Math.floor(forrajeAprov / consumoDiarioRodeo))
        : 0;

    document.getElementById('live-forraje-aprov').textContent =
      `${forrajeAprov.toLocaleString('es-AR')} kg MS`;
    document.getElementById('live-dias-est').textContent = `${diasEst} días`;
  }

  ['edit-potrero-disp', 'edit-potrero-porc'].forEach((id) => {
    document.getElementById(id).addEventListener('input', updateLivePasturePreview);
  });

  function renderDrawerGrazingSection(potrero) {
    const box = document.getElementById('drawer-grazing-content');
    const sem = potrero.semaforo;
    const rodeo = state.rodeo || { total_animales: 0, consumo_diario_total_kg_ms: 0 };
    const todayStr = new Date().toISOString().split('T')[0];

    if (potrero.uso_activo) {
      const u = potrero.uso_activo;
      const alertClass =
        sem.color === 'rojo'
          ? 'alert-error'
          : sem.color === 'amarillo'
            ? 'alert-warning'
            : 'alert-success';

      box.innerHTML = `
        <div class="alert-box ${alertClass}" style="margin-bottom:0.75rem;">
          <strong>${sem.etiqueta}</strong><br/>
          Ingreso: <strong>${u.fecha_ingreso}</strong> • Fin Est.: <strong>${u.fecha_fin_estimada}</strong>
        </div>
        <div class="calc-grid">
          <div class="calc-box">
            <span>Días Estimados</span>
            <strong>${u.dias_pastoreo_estimados} días</strong>
          </div>
          <div class="calc-box">
            <span>Días Restantes</span>
            <strong style="color:${sem.hex};">${sem.dias_restantes} día(s)</strong>
          </div>
        </div>
        <div style="display:flex; gap:0.5rem; margin-top:0.75rem;">
          <button type="button" id="btn-drawer-rotar" class="btn btn-primary" style="flex:1;">
            🔄 Rotar Rodeo a otro Potrero
          </button>
          <button type="button" id="btn-drawer-finalizar" class="btn btn-secondary btn-sm">
            ⏹️ Finalizar
          </button>
        </div>
      `;

      document.getElementById('btn-drawer-rotar').addEventListener('click', () => {
        openRotarModal(potrero.id_potrero);
      });

      document.getElementById('btn-drawer-finalizar').addEventListener('click', async () => {
        if (!confirm(`¿Desea finalizar manualmente el pastoreo en "${potrero.nombre}" y pasarlo a descanso?`)) {
          return;
        }
        try {
          const res = await API.post(`/api/pastoreo/${u.id_uso_potrero}/finalizar`, {});
          showToast(res.mensaje);
          await loadAllData(false);
        } catch (err) {
          showToast(err.message, true);
        }
      });
    } else if (sem.en_descanso) {
      // Potrero recién rotado en período de descanso (se mantiene en color ROJO hasta cumplir los días de recuperación)
      const notaAnticipada =
        sem.dias_rotacion_anticipada > 0
          ? `<br/><span style="color:#166534;">✔ Rotado <strong>${sem.dias_rotacion_anticipada} día(s) antes</strong>: descanso reducido de ${sem.dias_descanso_base} a <strong>${sem.dias_descanso_requeridos} días</strong>.</span>`
          : '';

      box.innerHTML = `
        <div class="alert-box alert-error" style="margin-bottom:0.75rem;">
          🌱 <strong>Potrero en Período de Descanso (Estado ROJO):</strong><br/>
          El rodeo salió de este lote el <strong>${sem.fecha_inicio_descanso || 'hoy'}</strong>.${notaAnticipada}
        </div>
        <div class="calc-grid">
          <div class="calc-box">
            <span>Días de Descanso Cumplidos</span>
            <strong>${sem.dias_descanso_transcurridos} de ${sem.dias_descanso_requeridos} días</strong>
          </div>
          <div class="calc-box">
            <span>Faltan para pasar a Verde</span>
            <strong style="color:var(--sem-red);">${sem.dias_descanso_restantes} día(s)</strong>
          </div>
        </div>
        <p style="font-size:0.78rem; color:var(--text-muted); margin-top:0.5rem;">
          🔒 Este potrero permanecerá en Rojo y bloqueado para ingreso del rodeo hasta completar los ${sem.dias_descanso_requeridos} días de rebrote.
        </p>
      `;
    } else {
      // Potrero libre y disponible en Verde: verificar si el rodeo ya está ocupando otro potrero en el establecimiento
      const potreroConRodeo = state.potreros.find((p) => p.uso_activo);

      if (potreroConRodeo) {
        box.innerHTML = `
          <div class="alert-box alert-warning" style="margin-bottom:0.65rem;">
            📍 <strong>Rodeo actualmente en otro lote:</strong><br/>
            El rodeo está pastoreando en <strong>${potreroConRodeo.nombre}</strong> (${potreroConRodeo.semaforo.etiqueta}). Para traerlo a este lote, realice la rotación.
          </div>
          <div class="calc-grid">
            <div class="calc-box">
              <span>Forraje Aprovechable</span>
              <strong>${Number(potrero.forraje_aprovechable_kg_ms || 0).toLocaleString('es-AR')} kg MS</strong>
            </div>
            <div class="calc-box">
              <span>Duración Est. al Rotar</span>
              <strong style="color:var(--primary);">${potrero.dias_estimados_con_rodeo_actual} días</strong>
            </div>
          </div>
          <button type="button" id="btn-drawer-rotar-aqui" class="btn btn-primary btn-block" style="margin-top:0.65rem;">
            🔄 Rotar Rodeo hacia este Potrero
          </button>
        `;

        document.getElementById('btn-drawer-rotar-aqui').addEventListener('click', () => {
          openRotarModal(potreroConRodeo.id_potrero, potrero.id_potrero);
        });
      } else {
        // El rodeo no está asignado a ningún potrero activo: permitir Asignar Rodeo (HU-005)
        box.innerHTML = `
          <p style="font-size:0.82rem; color:var(--text-muted); margin-bottom:0.6rem;">
            Cálculo automático para asignar el rodeo actual (<strong>${rodeo.total_animales} cabezas</strong>):
          </p>
          <div class="calc-grid">
            <div class="calc-box">
              <span>Forraje Aprovechable</span>
              <strong>${Number(potrero.forraje_aprovechable_kg_ms || 0).toLocaleString('es-AR')} kg MS</strong>
            </div>
            <div class="calc-box">
              <span>Consumo Diario Rodeo</span>
              <strong>${Number(rodeo.consumo_diario_total_kg_ms || 0).toLocaleString('es-AR')} kg MS/d</strong>
            </div>
          </div>
          <div class="alert-box alert-success" style="margin:0.6rem 0;">
            ⏱️ <strong>Días de pastoreo estimados: ${potrero.dias_estimados_con_rodeo_actual} días</strong>
          </div>
          <div class="form-group" style="margin-bottom:0.65rem;">
            <label for="assign-fecha-ingreso">Fecha de Ingreso del Rodeo</label>
            <input type="date" id="assign-fecha-ingreso" class="input-control" value="${todayStr}" />
          </div>
          <button type="button" id="btn-drawer-asignar" class="btn btn-primary btn-block">
            🐄 Asignar Rodeo a este Potrero
          </button>
        `;

        document.getElementById('btn-drawer-asignar').addEventListener('click', async () => {
          const fechaIngreso = document.getElementById('assign-fecha-ingreso').value;
          try {
            const res = await API.post('/api/pastoreo/asignar', {
              id_potrero: potrero.id_potrero,
              fecha_ingreso: fechaIngreso
            });
            showToast(res.mensaje);
            await loadAllData(false);
          } catch (err) {
            showToast(err.message, true);
          }
        });
      }
    }
  }

  // Guardar cambios de Potrero y Pastura (HU-002 / HU-003)
  document.getElementById('form-edit-potrero').addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = Number(document.getElementById('edit-potrero-id').value);
    try {
      const res = await API.put(`/api/potreros/${id}`, {
        nombre: document.getElementById('edit-potrero-nombre').value.trim(),
        tipo_pastura: document.getElementById('edit-potrero-pastura').value.trim(),
        disponibilidad_kg_ms_ha: Number(document.getElementById('edit-potrero-disp').value),
        porcentaje_aprovechable: Number(document.getElementById('edit-potrero-porc').value),
        observaciones: document.getElementById('edit-potrero-obs').value.trim()
      });
      showToast(res.mensaje);
      await loadAllData(false);
    } catch (err) {
      showToast(err.message, true);
    }
  });

  // Redibujar polígono de potrero existente (HU-002)
  document.getElementById('btn-redraw-potrero').addEventListener('click', () => {
    if (!state.selectedPotreroId) return;
    startPolygonDrawing(
      'redibujar_potrero',
      'Dibuje el nuevo polígono para actualizar la geometría y hectáreas del potrero seleccionado...'
    );
  });

  // Eliminar potrero (HU-002)
  document.getElementById('btn-delete-potrero').addEventListener('click', async () => {
    if (!state.selectedPotreroId) return;
    const pot = state.potreros.find((p) => p.id_potrero === state.selectedPotreroId);
    if (!pot) return;

    if (!confirm(`¿Está seguro de eliminar el "${pot.nombre}" (${pot.superficie_ha} ha)?`)) {
      return;
    }

    try {
      const res = await API.delete(`/api/potreros/${pot.id_potrero}`);
      showToast(res.mensaje);
      closePotreroDrawer();
      await loadAllData(false);
    } catch (err) {
      showToast(err.message, true);
    }
  });

  // ==========================================================================
  // 4. CONTROLES DE DIBUJO EN MAPA Y CREACIÓN DE POTREROS (HU-001 / HU-002)
  // ==========================================================================
  document.getElementById('select-establecimiento').addEventListener('change', (e) => {
    state.selectedEstablecimientoId = e.target.value;
    state.establecimiento =
      state.selectedEstablecimientoId !== 'todos'
        ? state.establecimientos.find(
            (est) => String(est.id_establecimiento) === String(state.selectedEstablecimientoId)
          ) || state.establecimientos[0] || null
        : state.establecimientos[0] || null;
    renderTopbarAndSidebarSummary();
    renderMapLayers(true);
    renderPotrerosSidebarList();
  });

  document.getElementById('btn-edit-establecimiento').addEventListener('click', async () => {
    if (state.selectedEstablecimientoId === 'todos') return;
    const est = state.establecimientos.find(
      (e) => String(e.id_establecimiento) === String(state.selectedEstablecimientoId)
    );
    if (!est) return;

    const nuevoNombre = prompt(
      `Editar nombre del establecimiento (o deje igual y presione Aceptar):`,
      est.nombre
    );
    if (nuevoNombre === null) return;

    if (nuevoNombre.trim() && nuevoNombre.trim() !== est.nombre) {
      try {
        const res = await API.put(`/api/establecimiento/${est.id_establecimiento}`, {
          nombre: nuevoNombre.trim()
        });
        showToast(res.mensaje);
        await loadAllData(false);
      } catch (err) {
        showToast(err.message, true);
      }
    }

    if (confirm(`¿Desea también redibujar el polígono perimetral de "${nuevoNombre || est.nombre}" en el mapa?`)) {
      startPolygonDrawing(
        'redibujar_establecimiento',
        `Redibuje el nuevo perímetro para "${nuevoNombre || est.nombre}"...`
      );
    }
  });

  document.getElementById('btn-delete-establecimiento').addEventListener('click', async () => {
    if (state.selectedEstablecimientoId === 'todos') return;
    const est = state.establecimientos.find(
      (e) => String(e.id_establecimiento) === String(state.selectedEstablecimientoId)
    );
    if (!est) return;

    if (
      !confirm(
        `¿Está seguro de eliminar el establecimiento "${est.nombre}" (${est.superficie_total_ha} ha) y todos sus potreros?`
      )
    ) {
      return;
    }

    try {
      const res = await API.delete(`/api/establecimiento/${est.id_establecimiento}`);
      state.selectedEstablecimientoId = 'todos';
      showToast(res.mensaje);
      await loadAllData(true);
    } catch (err) {
      showToast(err.message, true);
    }
  });

  document.getElementById('btn-draw-establecimiento').addEventListener('click', () => {
    startPolygonDrawing(
      'establecimiento',
      'Haga clic en el mapa satelital para delimitar los vértices del nuevo Establecimiento...'
    );
  });

  document.getElementById('btn-draw-potrero').addEventListener('click', () => {
    if (!state.establecimientos || state.establecimientos.length === 0) {
      showToast('Primero debe delimitar al menos un establecimiento usando el botón "📐 Nuevo Campo".', true);
      return;
    }
    startPolygonDrawing(
      'nuevo_potrero',
      'Dibuje el sub-polígono del nuevo Potrero dentro de cualquiera de sus establecimientos...'
    );
  });

  document.getElementById('btn-center-map').addEventListener('click', () => {
    renderMapLayers(true);
  });

  document.getElementById('form-new-potrero').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!state.pendingPolygonGeoJSON) {
      showToast('No hay polígono dibujado.', true);
      return;
    }

    try {
      const res = await API.post('/api/potreros', {
        id_establecimiento:
          state.selectedEstablecimientoId !== 'todos'
            ? Number(state.selectedEstablecimientoId)
            : undefined,
        nombre: document.getElementById('new-potrero-nombre').value.trim(),
        poligono: state.pendingPolygonGeoJSON,
        superficie_ha: state.pendingAreaHa,
        tipo_pastura: document.getElementById('new-potrero-pastura').value.trim(),
        disponibilidad_kg_ms_ha: Number(document.getElementById('new-potrero-disp').value),
        porcentaje_aprovechable: Number(document.getElementById('new-potrero-porc').value),
        observaciones: document.getElementById('new-potrero-obs').value.trim()
      });

      closeModal('modal-new-potrero');
      state.pendingPolygonGeoJSON = null;
      showToast(res.mensaje);
      await loadAllData(false);
      openPotreroDrawer(res.potrero.id_potrero);
    } catch (err) {
      showToast(err.message, true);
    }
  });

  // Filtros del semáforo en sidebar
  document.querySelectorAll('.filter-sem-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.semaphoreFilter = btn.getAttribute('data-filter');
      renderPotrerosSidebarList();
    });
  });

  // ==========================================================================
  // 5. ROTACIÓN DE RODEO ENTRE POTREROS (HU-009, HU-005, HU-006)
  // ==========================================================================
  async function openRotarModal(preferredOriginPotreroId = null, preferredDestPotreroId = null) {
    const ocupados = state.potreros.filter((p) => p.uso_activo);
    const disponibles = state.potreros.filter(
      (p) => !p.uso_activo && (!p.semaforo || !p.semaforo.en_descanso)
    );

    if (ocupados.length === 0) {
      showToast('No hay ningún potrero con pastoreo activo para rotar.', true);
      return;
    }
    if (disponibles.length === 0) {
      showToast('No hay potreros libres disponibles para recibir la rotación.', true);
      return;
    }

    const origenSelect = document.getElementById('rotar-origen-select');
    const destinoSelect = document.getElementById('rotar-destino-select');
    const fechaInput = document.getElementById('rotar-fecha-ingreso');
    fechaInput.value = new Date().toISOString().split('T')[0];

    const multiEst = state.establecimientos && state.establecimientos.length > 1;

    origenSelect.innerHTML = ocupados
      .map((p) => {
        const prefix = multiEst && p.establecimiento_nombre ? `[${p.establecimiento_nombre}] ` : '';
        return `<option value="${p.id_potrero}" ${
          Number(preferredOriginPotreroId) === p.id_potrero ? 'selected' : ''
        }>${prefix}${p.nombre} (${p.semaforo.etiqueta})</option>`;
      })
      .join('');

    destinoSelect.innerHTML = disponibles
      .map((p) => {
        const prefix = multiEst && p.establecimiento_nombre ? `[${p.establecimiento_nombre}] ` : '';
        return `<option value="${p.id_potrero}" ${
          Number(preferredDestPotreroId) === p.id_potrero ? 'selected' : ''
        }>${prefix}${p.nombre} — ${p.tipo_pastura} (${p.superficie_ha} ha • ~${p.dias_estimados_con_rodeo_actual} días)</option>`;
      })
      .join('');

    await updateRotationPreview();
    openModal('modal-rotar');
  }

  async function updateRotationPreview() {
    const idDestino = Number(document.getElementById('rotar-destino-select').value);
    const fechaIngreso = document.getElementById('rotar-fecha-ingreso').value;
    if (!idDestino) return;

    try {
      const res = await API.post('/api/pastoreo/calcular', {
        id_potrero: idDestino,
        fecha_ingreso: fechaIngreso
      });
      const c = res.calculo;
      document.getElementById('rot-prev-forraje').textContent =
        `${c.forraje_aprovechable_kg_ms.toLocaleString('es-AR')} kg MS`;
      document.getElementById('rot-prev-consumo').textContent =
        `${c.consumo_diario_rodeo_kg_ms.toLocaleString('es-AR')} kg MS/d`;
      document.getElementById('rot-prev-dias').textContent = `${c.dias_pastoreo_estimados} días`;
      document.getElementById('rot-prev-fin').textContent = c.fecha_fin_estimada;
    } catch (_) { }
  }

  document.getElementById('rotar-destino-select').addEventListener('change', updateRotationPreview);
  document.getElementById('rotar-fecha-ingreso').addEventListener('change', updateRotationPreview);

  document.getElementById('form-rotar-rodeo').addEventListener('submit', async (e) => {
    e.preventDefault();
    const idOrigen = Number(document.getElementById('rotar-origen-select').value);
    const idDestino = Number(document.getElementById('rotar-destino-select').value);
    const fechaIngreso = document.getElementById('rotar-fecha-ingreso').value;

    try {
      const res = await API.post('/api/pastoreo/rotar', {
        id_potrero_origen: idOrigen,
        id_potrero_destino: idDestino,
        fecha_ingreso: fechaIngreso
      });
      closeModal('modal-rotar');
      showToast(res.mensaje);
      await loadAllData(false);
      openPotreroDrawer(idDestino);
    } catch (err) {
      showToast(err.message, true);
    }
  });

  // ==========================================================================
  // 6. GESTIÓN DE RODEO E HISTORIAL DE SNAPSHOTS (HU-004)
  // ==========================================================================
  function openRodeoModal() {
    if (!state.establecimiento) {
      showToast('Primero debe delimitar el Establecimiento en el mapa antes de cargar el rodeo.', true);
      return;
    }
    if (state.rodeo) {
      document.getElementById('rodeo-ordene').value = state.rodeo.cant_vacas_ordene;
      document.getElementById('rodeo-secas').value = state.rodeo.cant_vacas_secas;
      document.getElementById('rodeo-vaquillonas').value = state.rodeo.cant_vaquillonas;
      document.getElementById('rodeo-terneras').value = state.rodeo.cant_terneras;
      document.getElementById('rodeo-consumo').value = state.rodeo.consumo_diario_prom_kg_ms;
    } else {
      document.getElementById('rodeo-ordene').value = 0;
      document.getElementById('rodeo-secas').value = 0;
      document.getElementById('rodeo-vaquillonas').value = 0;
      document.getElementById('rodeo-terneras').value = 0;
      document.getElementById('rodeo-consumo').value = 15;
    }
    updateRodeoModalPreview();
    renderRodeoHistorialTable();
    openModal('modal-rodeo');
  }

  function updateRodeoModalPreview() {
    const ord = Number(document.getElementById('rodeo-ordene').value || 0);
    const sec = Number(document.getElementById('rodeo-secas').value || 0);
    const vaq = Number(document.getElementById('rodeo-vaquillonas').value || 0);
    const ter = Number(document.getElementById('rodeo-terneras').value || 0);
    const cons = Number(document.getElementById('rodeo-consumo').value || 0);

    const totalCab = ord + sec + vaq + ter;
    const totalCons = Number((totalCab * cons).toFixed(2));

    document.getElementById('rodeo-total-cabezas').textContent = `${totalCab} cabezas`;
    document.getElementById('rodeo-total-consumo').textContent =
      `${totalCons.toLocaleString('es-AR')} kg MS / día`;
  }

  ['rodeo-ordene', 'rodeo-secas', 'rodeo-vaquillonas', 'rodeo-terneras', 'rodeo-consumo'].forEach(
    (id) => {
      document.getElementById(id).addEventListener('input', updateRodeoModalPreview);
    }
  );

  function renderRodeoHistorialTable() {
    const tbody = document.getElementById('rodeo-historial-tbody');
    tbody.innerHTML = state.historialRodeo
      .map((h) => {
        const fechaStr = String(h.fecha_registro || '').replace('T', ' ').slice(0, 16);
        return `
          <tr>
            <td><strong>#${h.id_historial_rodeo}</strong></td>
            <td>${fechaStr}</td>
            <td>${h.cant_vacas_ordene}</td>
            <td>${h.cant_vacas_secas}</td>
            <td>${h.cant_vaquillonas}</td>
            <td>${h.cant_terneras}</td>
            <td><strong>${h.total_animales}</strong></td>
            <td>${h.consumo_diario_prom_kg_ms} kg</td>
            <td><strong>${Number(h.consumo_diario_total_kg_ms).toLocaleString('es-AR')} kg MS/d</strong></td>
          </tr>
        `;
      })
      .join('');
  }

  document.getElementById('btn-open-rodeo').addEventListener('click', openRodeoModal);

  document.getElementById('form-rodeo').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const res = await API.put('/api/rodeo', {
        cant_vacas_ordene: Number(document.getElementById('rodeo-ordene').value),
        cant_vacas_secas: Number(document.getElementById('rodeo-secas').value),
        cant_vaquillonas: Number(document.getElementById('rodeo-vaquillonas').value),
        cant_terneras: Number(document.getElementById('rodeo-terneras').value),
        consumo_diario_prom_kg_ms: Number(document.getElementById('rodeo-consumo').value)
      });
      showToast(res.mensaje);
      await loadAllData(false);
      renderRodeoHistorialTable();
    } catch (err) {
      showToast(err.message, true);
    }
  });

  // ==========================================================================
  // 7. CONSULTAR HISTORIAL DE USO POR POTRERO (HU-010)
  // ==========================================================================
  async function openHistorialUsoModal(potreroIdFilter = 'todos') {
    const select = document.getElementById('historial-potrero-filter');
    select.innerHTML =
      `<option value="todos">Todos los potreros del establecimiento</option>` +
      state.potreros
        .map(
          (p) =>
            `<option value="${p.id_potrero}" ${String(potreroIdFilter) === String(p.id_potrero) ? 'selected' : ''
            }>${p.nombre}</option>`
        )
        .join('');

    await loadAndRenderHistorialTable(potreroIdFilter);
    openModal('modal-historial');
  }

  async function loadAndRenderHistorialTable(potreroIdFilter) {
    try {
      const endpoint =
        potreroIdFilter && potreroIdFilter !== 'todos'
          ? `/api/potreros/${potreroIdFilter}/historial`
          : '/api/pastoreo/historial';

      const res = await API.get(endpoint);
      const rows = res.historial || [];
      document.getElementById('historial-count-badge').textContent = `${rows.length} registro(s)`;

      const tbody = document.getElementById('historial-uso-tbody');
      if (rows.length === 0) {
        tbody.innerHTML = `<tr><td colspan="8" style="text-align:center; padding:1.5rem; color:var(--text-muted);">No hay registros de uso para este filtro.</td></tr>`;
        return;
      }

      tbody.innerHTML = rows
        .map((r) => {
          const estadoBadge =
            r.estado === 'activo'
              ? '<span class="sem-badge amarillo">En Curso</span>'
              : '<span class="sem-badge verde">Finalizado</span>';

          return `
            <tr>
              <td><strong>${r.potrero_nombre}</strong><br/><span style="font-size:0.75rem; color:var(--text-muted);">${r.tipo_pastura}</span></td>
              <td>${estadoBadge}</td>
              <td>${r.fecha_ingreso}</td>
              <td>${r.fecha_fin_estimada}</td>
              <td>${r.fecha_fin_real || '<em>En pastoreo</em>'}</td>
              <td>${r.dias_pastoreo_estimados}d est. / <strong>${r.dias_reales_transcurridos}d real</strong></td>
              <td>
                <strong>${r.total_animales_snapshot} cabezas</strong> <br/>
                <span style="font-size:0.76rem; color:var(--text-muted);">
                  Ord: ${r.cant_vacas_ordene} | Sec: ${r.cant_vacas_secas} | Vaq: ${r.cant_vaquillonas} | Tern: ${r.cant_terneras}
                </span>
              </td>
              <td>${Number(r.consumo_diario_rodeo_snapshot_kg_ms).toLocaleString('es-AR')} kg MS/d</td>
            </tr>
          `;
        })
        .join('');
    } catch (err) {
      showToast(err.message, true);
    }
  }

  document.getElementById('btn-open-historial').addEventListener('click', () => {
    openHistorialUsoModal('todos');
  });

  document.getElementById('btn-drawer-historial').addEventListener('click', () => {
    if (state.selectedPotreroId) {
      openHistorialUsoModal(state.selectedPotreroId);
    }
  });

  document.getElementById('historial-potrero-filter').addEventListener('change', (e) => {
    loadAndRenderHistorialTable(e.target.value);
  });

  // ==========================================================================
  // 8. NOTIFICACIONES Y BANNER DE ALERTA EN ROJO (HU-008)
  // ==========================================================================
  function renderNotificacionesUI(unreadCount) {
    const badge = document.getElementById('notif-badge');
    if (unreadCount > 0) {
      badge.style.display = 'inline-block';
      badge.textContent = unreadCount;
    } else {
      badge.style.display = 'none';
    }

    // Banner superior si hay potreros en estado ROJO con rodeo adentro que requieren rotación
    const potrerosEnRojo = state.potreros.filter(
      (p) => p.semaforo && p.semaforo.requiere_rotacion
    );
    const banner = document.getElementById('critical-banner');

    if (potrerosEnRojo.length > 0 || unreadCount > 0) {
      banner.classList.remove('hidden');
      const nombresRojo = potrerosEnRojo.map((p) => p.nombre).join(', ');
      document.getElementById('critical-banner-text').innerHTML =
        potrerosEnRojo.length > 0
          ? `🚨 <strong>ALERTA DE ROTACIÓN :</strong> ${nombresRojo} alcanzó 0 días restantes (Estado ROJO). Rote el rodeo a un potrero disponible.`
          : `🔔 Tiene <strong>${unreadCount}</strong> notificación(es) de pastoreo sin leer.`;

      document.getElementById('banner-rotate-btn').onclick = () => {
        const firstRed = potrerosEnRojo[0];
        openRotarModal(firstRed ? firstRed.id_potrero : null);
      };
    } else {
      banner.classList.add('hidden');
    }

    // Renderizar listado dentro del modal de notificaciones
    const listEl = document.getElementById('notificaciones-list');
    if (state.notificaciones.length === 0) {
      listEl.innerHTML = `<div style="padding:1.5rem; text-align:center; color:var(--text-muted);">No hay notificaciones registradas.</div>`;
      return;
    }

    listEl.innerHTML = state.notificaciones
      .map((n) => {
        const fechaStr = String(n.fecha || '').replace('T', ' ').slice(0, 16);
        return `
          <div class="drawer-card" style="margin-bottom:0; border-left:4px solid ${n.leida ? '#94a3b8' : '#ef4444'
          }; background:${n.leida ? '#f8fafc' : '#fef2f2'};">
            <div style="display:flex; justify-content:space-between; align-items:start; gap:0.75rem;">
              <div>
                <div style="font-size:0.76rem; color:var(--text-muted); margin-bottom:0.2rem;">
                  📅 ${fechaStr} • <strong>${n.potrero_nombre}</strong>
                </div>
                <div style="font-size:0.88rem; color:#0f172a;">${n.mensaje}</div>
              </div>
              <div style="display:flex; gap:0.4rem; flex-shrink:0;">
                ${!n.leida
            ? `<button type="button" class="btn btn-secondary btn-sm mark-read-btn" data-id="${n.id_notificacion}">Marcar leída</button>`
            : `<span class="sem-badge verde">Leída</span>`
          }
              </div>
            </div>
          </div>
        `;
      })
      .join('');

    listEl.querySelectorAll('.mark-read-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = btn.getAttribute('data-id');
        try {
          await API.put(`/api/notificaciones/${id}/leer`, {});
          await loadAllData(false);
        } catch (err) {
          showToast(err.message, true);
        }
      });
    });
  }

  document.getElementById('btn-open-notificaciones').addEventListener('click', () => {
    openModal('modal-notificaciones');
  });

  document.getElementById('banner-view-alerts-btn').addEventListener('click', () => {
    openModal('modal-notificaciones');
  });

  document.getElementById('btn-mark-all-read').addEventListener('click', async () => {
    try {
      await API.put('/api/notificaciones/leer-todas', {});
      showToast('Todas las notificaciones marcadas como leídas.');
      await loadAllData(false);
    } catch (err) {
      showToast(err.message, true);
    }
  });

  // ==========================================================================
  // 9. SEGURIDAD: CAMBIO DE CLAVE Y VENCIMIENTO SEMESTRAL
  // ==========================================================================
  const secNewPass = document.getElementById('sec-new-pass');
  const secPolicyList = document.getElementById('sec-policy-list');

  secNewPass.addEventListener('input', () => {
    const rules = evaluatePasswordRules(secNewPass.value);
    secPolicyList.querySelectorAll('li').forEach((li) => {
      const r = li.getAttribute('data-rule');
      if (rules[r]) {
        li.classList.add('ok');
        li.textContent = '✔ ' + li.textContent.slice(2);
      } else {
        li.classList.remove('ok');
        li.textContent = '○ ' + li.textContent.slice(2);
      }
    });
  });

  document.getElementById('btn-open-seguridad').addEventListener('click', () => {
    openModal('modal-seguridad');
  });

  document.getElementById('form-cambiar-clave').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const res = await API.post('/api/auth/cambiar-clave', {
        contrasenaActual: document.getElementById('sec-current-pass').value,
        nuevaContrasena: secNewPass.value
      });
      localStorage.removeItem('geocampo_pwd_expired');
      document.getElementById('pwd-expired-warning').style.display = 'none';
      document.getElementById('form-cambiar-clave').reset();
      closeModal('modal-seguridad');
      showToast(res.mensaje);
    } catch (err) {
      showToast(err.message, true);
    }
  });

  document.getElementById('btn-logout').addEventListener('click', () => {
    API.clearSession();
    window.location.href = '/login.html';
  });

  // Helpers de Modales
  function openModal(id) {
    document.getElementById(id).classList.remove('hidden');
  }

  function closeModal(id) {
    document.getElementById(id).classList.add('hidden');
  }

  document.querySelectorAll('[data-close]').forEach((btn) => {
    btn.addEventListener('click', () => {
      closeModal(btn.getAttribute('data-close'));
    });
  });

  // Si la contraseña tiene más de 6 meses de antigüedad, abrir aviso de renovación
  if (localStorage.getItem('geocampo_pwd_expired') === 'true') {
    document.getElementById('pwd-expired-warning').style.display = 'block';
    openModal('modal-seguridad');
  }

  // Carga inicial completa centrando el mapa en El Arañado, Córdoba
  await loadAllData(true);
});
