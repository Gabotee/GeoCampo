const turf = require('@turf/turf');

/**
 * Calcula la superficie en hectáreas y el centroide de un polígono GeoJSON usando Turf.js (HU-001 y HU-002)
 */
function calculatePolygonMetrics(geojsonInput) {
  if (!geojsonInput) {
    return { superficie_ha: 0, ubicacion_lat: -31.738, ubicacion_lng: -62.723 };
  }

  const geojson = typeof geojsonInput === 'string' ? JSON.parse(geojsonInput) : geojsonInput;
  const areaSqMeters = turf.area(geojson);
  const superficie_ha = Number((areaSqMeters / 10000).toFixed(2));

  let ubicacion_lat = -31.738;
  let ubicacion_lng = -62.723;
  try {
    const center = turf.centroid(geojson);
    if (center && center.geometry && Array.isArray(center.geometry.coordinates)) {
      ubicacion_lng = Number(center.geometry.coordinates[0].toFixed(6));
      ubicacion_lat = Number(center.geometry.coordinates[1].toFixed(6));
    }
  } catch (_) {
    // Fallback a coordenadas de El Arañado, Córdoba
  }

  return {
    superficie_ha,
    ubicacion_lat,
    ubicacion_lng
  };
}

/**
 * Calcula la disponibilidad de forraje, consumo diario del rodeo y días de pastoreo (HU-006):
 * - Forraje aprovechable (kg MS) = Superficie (ha) * Disponibilidad (kg MS/ha) * (% Aprovechable / 100)
 * - Consumo diario del rodeo (kg MS) = Total cabezas * consumo_diario_prom_kg_ms
 * - Días de pastoreo = Forraje aprovechable / Consumo diario del rodeo
 */
function calculateGrazingDays(potrero, rodeo, fechaIngresoInput = null) {
  const superficieHa = Number(potrero.superficie_ha || 0);
  const dispKgMsHa = Number(potrero.disponibilidad_kg_ms_ha || 0);
  const porcAprovechable = Number(potrero.porcentaje_aprovechable || 0);

  const forrajeTotalKgMs = Number((superficieHa * dispKgMsHa).toFixed(2));
  const forrajeAprovechableKgMs = Number(
    (superficieHa * dispKgMsHa * (porcAprovechable / 100)).toFixed(2)
  );

  const cantVacasOrdene = Number(rodeo.cant_vacas_ordene || 0);
  const cantVacasSecas = Number(rodeo.cant_vacas_secas || 0);
  const cantVaquillonas = Number(rodeo.cant_vaquillonas || 0);
  const cantTerneras = Number(rodeo.cant_terneras || 0);
  const totalAnimales = cantVacasOrdene + cantVacasSecas + cantVaquillonas + cantTerneras;

  const consumoPromAnimal = Number(rodeo.consumo_diario_prom_kg_ms || 0);
  const consumoDiarioRodeoKgMs = Number((totalAnimales * consumoPromAnimal).toFixed(2));

  let diasExactos = 0;
  let diasEstimados = 0;

  if (forrajeAprovechableKgMs > 0 && consumoDiarioRodeoKgMs > 0) {
    diasExactos = Number((forrajeAprovechableKgMs / consumoDiarioRodeoKgMs).toFixed(2));
    diasEstimados = Math.max(1, Math.floor(diasExactos));
  }

  const fechaIngresoDate = fechaIngresoInput ? parseDateLocal(fechaIngresoInput) : getTodayLocal();
  const fechaFinEstimadaDate = new Date(fechaIngresoDate);
  fechaFinEstimadaDate.setDate(fechaFinEstimadaDate.getDate() + diasEstimados);

  return {
    superficie_ha: superficieHa,
    disponibilidad_kg_ms_ha: dispKgMsHa,
    porcentaje_aprovechable: porcAprovechable,
    forraje_total_kg_ms: forrajeTotalKgMs,
    forraje_aprovechable_kg_ms: forrajeAprovechableKgMs,
    total_animales: totalAnimales,
    consumo_diario_prom_kg_ms: consumoPromAnimal,
    consumo_diario_rodeo_kg_ms: consumoDiarioRodeoKgMs,
    dias_pastoreo_exactos: diasExactos,
    dias_pastoreo_estimados: diasEstimados,
    fecha_ingreso: formatDateYMD(fechaIngresoDate),
    fecha_fin_estimada: formatDateYMD(fechaFinEstimadaDate)
  };
}

/**
 * Calcula el estado del semáforo de un potrero según HU-007 y período de descanso post-rotación:
 * 1) Si tiene uso activo:
 *    dias_restantes = dias_pastoreo_estimados - (hoy - fecha_ingreso)
 *    - Verde: dias_restantes > 2
 *    - Amarillo: 0 < dias_restantes <= 2
 *    - Rojo: dias_restantes <= 0 (requiere rotación)
 * 2) Si NO tiene uso activo:
 *    - Si salió de pastoreo hace menos de DIAS_DESCANSO_POTRERO (30 días por defecto desde fecha_fin_real),
 *      se mantiene en color ROJO (en descanso / recuperación de pastura) y no está disponible aún.
 *    - Una vez cumplidos los días de descanso (o si nunca fue pastoreado), pasa automáticamente a VERDE (disponible).
 */
function calculateSemaphoreStatus(usoActivo = null, potrero = null, ultimoUsoFinalizado = null) {
  const diasDescansoBase = Number(process.env.DIAS_DESCANSO_POTRERO || 30);
  const hoy = getTodayLocal();

  if (!usoActivo || usoActivo.estado !== 'activo') {
    if (ultimoUsoFinalizado && ultimoUsoFinalizado.fecha_fin_real) {
      const fechaIngresoAnt = parseDateLocal(ultimoUsoFinalizado.fecha_ingreso);
      const fechaFin = parseDateLocal(ultimoUsoFinalizado.fecha_fin_real);

      // Calcular cuántos días antes se rotó (días estimados - días reales de pastoreo)
      const diasRealesPastoreo = Math.max(
        0,
        Math.floor((fechaFin.getTime() - fechaIngresoAnt.getTime()) / (1000 * 60 * 60 * 24))
      );
      const diasEstimadosAnt = Number(ultimoUsoFinalizado.dias_pastoreo_estimados || 0);
      const diasRotacionAnticipada = Math.max(0, diasEstimadosAnt - diasRealesPastoreo);

      // Restar a los 30 días fijos los días que quedaron sin consumir al rotar antes
      const diasDescansoRequeridos = Math.max(1, diasDescansoBase - diasRotacionAnticipada);

      const diffMs = hoy.getTime() - fechaFin.getTime();
      const diasDescansoTranscurridos = Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));
      const diasDescansoRestantes = diasDescansoRequeridos - diasDescansoTranscurridos;

      if (diasDescansoRestantes > 0) {
        return {
          en_uso: false,
          en_descanso: true,
          descanso_cumplido: false,
          color: 'rojo',
          hex: '#ef4444',
          etiqueta: `En Descanso (faltan ${diasDescansoRestantes}d para Verde)`,
          dias_transcurridos: 0,
          dias_restantes: null,
          dias_pastoreo_estimados: null,
          dias_descanso_base: diasDescansoBase,
          dias_rotacion_anticipada: diasRotacionAnticipada,
          dias_descanso_transcurridos: diasDescansoTranscurridos,
          dias_descanso_restantes: diasDescansoRestantes,
          dias_descanso_requeridos: diasDescansoRequeridos,
          fecha_inicio_descanso: ultimoUsoFinalizado.fecha_fin_real,
          requiere_rotacion: false
        };
      }

      return {
        en_uso: false,
        en_descanso: false,
        descanso_cumplido: true,
        color: 'verde',
        hex: '#22c55e',
        etiqueta: 'Disponible (Verde)',
        dias_transcurridos: 0,
        dias_restantes: null,
        dias_pastoreo_estimados: null,
        dias_descanso_base: diasDescansoBase,
        dias_rotacion_anticipada: diasRotacionAnticipada,
        dias_descanso_transcurridos: diasDescansoTranscurridos,
        dias_descanso_restantes: 0,
        dias_descanso_requeridos: diasDescansoRequeridos,
        requiere_rotacion: false
      };
    }

    if (potrero && potrero.estado_actual === 'descanso') {
      return {
        en_uso: false,
        en_descanso: true,
        descanso_cumplido: false,
        color: 'rojo',
        hex: '#ef4444',
        etiqueta: `En Descanso (faltan ${diasDescansoBase}d para Verde)`,
        dias_transcurridos: 0,
        dias_restantes: null,
        dias_pastoreo_estimados: null,
        dias_descanso_base: diasDescansoBase,
        dias_rotacion_anticipada: 0,
        dias_descanso_transcurridos: 0,
        dias_descanso_restantes: diasDescansoBase,
        dias_descanso_requeridos: diasDescansoBase,
        requiere_rotacion: false
      };
    }

    return {
      en_uso: false,
      en_descanso: false,
      descanso_cumplido: true,
      color: 'verde',
      hex: '#22c55e',
      etiqueta: 'Disponible (Verde)',
      dias_transcurridos: 0,
      dias_restantes: null,
      dias_pastoreo_estimados: null,
      dias_descanso_base: diasDescansoBase,
      dias_rotacion_anticipada: 0,
      dias_descanso_transcurridos: null,
      dias_descanso_restantes: 0,
      dias_descanso_requeridos: diasDescansoBase,
      requiere_rotacion: false
    };
  }

  const fechaIngreso = parseDateLocal(usoActivo.fecha_ingreso);
  const diffMs = hoy.getTime() - fechaIngreso.getTime();
  const diasTranscurridos = Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));
  const diasEstimados = Number(usoActivo.dias_pastoreo_estimados || 0);
  const diasRestantes = diasEstimados - diasTranscurridos;

  if (diasRestantes <= 0) {
    return {
      en_uso: true,
      en_descanso: false,
      color: 'rojo',
      hex: '#ef4444',
      etiqueta: 'Agotado / Rotar (Rojo)',
      dias_transcurridos: diasTranscurridos,
      dias_restantes: diasRestantes,
      dias_pastoreo_estimados: diasEstimados,
      requiere_rotacion: true
    };
  }

  if (diasRestantes <= 2) {
    return {
      en_uso: true,
      en_descanso: false,
      color: 'amarillo',
      hex: '#eab308',
      etiqueta: `Alerta Próxima Rotación (${diasRestantes}d)`,
      dias_transcurridos: diasTranscurridos,
      dias_restantes: diasRestantes,
      dias_pastoreo_estimados: diasEstimados,
      requiere_rotacion: false
    };
  }

  return {
    en_uso: true,
    en_descanso: false,
    color: 'verde',
    hex: '#16a34a',
    etiqueta: `En Pastoreo Óptimo (${diasRestantes}d rest.)`,
    dias_transcurridos: diasTranscurridos,
    dias_restantes: diasRestantes,
    dias_pastoreo_estimados: diasEstimados,
    requiere_rotacion: false
  };
}

function getTodayLocal() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function parseDateLocal(dateStrOrObj) {
  if (!dateStrOrObj) return getTodayLocal();
  if (dateStrOrObj instanceof Date) {
    return new Date(dateStrOrObj.getFullYear(), dateStrOrObj.getMonth(), dateStrOrObj.getDate());
  }
  const str = String(dateStrOrObj).split('T')[0];
  const parts = str.split('-').map(Number);
  if (parts.length === 3 && !parts.some(isNaN)) {
    return new Date(parts[0], parts[1] - 1, parts[2]);
  }
  const d = new Date(dateStrOrObj);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function formatDateYMD(dateObj) {
  const y = dateObj.getFullYear();
  const m = String(dateObj.getMonth() + 1).padStart(2, '0');
  const d = String(dateObj.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

module.exports = {
  calculatePolygonMetrics,
  calculateGrazingDays,
  calculateSemaphoreStatus,
  formatDateYMD,
  getTodayLocal,
  parseDateLocal
};
