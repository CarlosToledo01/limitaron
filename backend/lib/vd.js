// Cálculo de caída de tensión (solo alimentador) según sea monofásico, bifásico o trifásico.
// Fórmulas (de la lámina):
//  - Monofásico (1f-2h):   %e = 2 · I · L · Z / (En · 10)
//  - Bifásico  (2f-3h):    %e =     I · L · Z / (En · 10)
//  - Trifásico (3f-4h):    %e = √3 · I · L · Z / (Ef · 10)
// Donde:
//  - I en amperes
//  - L en metros (longitud total del alimentador)
//  - Z en ohm/km (impedancia eficaz del conductor a FP≈0.85)
//  - En = 120 V (línea-neutro)
//  - Ef = 220 V (línea-línea)
// Nota: Este módulo aplica SOLO para el alimentador (no para los derivados).

const EN = 120; // V de línea a neutro
const EF = 220; // V de línea a línea

// Z eficaz a FP≈0.85 (ohm/km) para conductor de COBRE en conduit PVC (tabla de referencia).
// Valores representativos a 60 Hz y 75 °C.
// Claves aceptadas: "14", "12", ..., "1", "1/0", "2/0", "3/0", "4/0", "250", "300", ..., "1000".
const Z_MAP_CU_PVC = {
  // AWG
  "14": 8.90,
  "12": 6.30,
  "10": 3.60,
  "8": 2.26,
  "6": 1.48,
  "4": 0.98,
  "3": 0.79,
  "2": 0.62,
  "1": 0.52,
  "1/0": 0.43,
  "2/0": 0.36,
  "3/0": 0.33,
  "4/0": 0.30,
  // kcmil
  "250": 0.262,
  "300": 0.240,
  "350": 0.222,
  "400": 0.210,
  "500": 0.187,
  "600": 0.171,
  "750": 0.148,
  "1000": 0.128
};

// Normaliza el calibre a una clave del mapa Z_MAP_CU_PVC.
// Acepta formatos: "14AWG", "14 AWG", "1/0 AWG", "500 kcmil", "500KCMIL", "2 awg", etc.
function parseCalibreKey(calibre) {
  if (!calibre) return null;
  let s = String(calibre).trim().toUpperCase();

  // Quitar espacios intermedios
  s = s.replace(/\s+/g, '');

  // Estandarizar sufijos comunes
  s = s.replace(/MCM$/, 'KCMIL'); // por si vienen como MCM

  // kcmil: 250KCMIL -> "250"
  let m = s.match(/^(\d{2,4})KCMIL$/);
  if (m) return m[1];

  // X/0AWG -> "X/0"
  m = s.match(/^([1234]\/0)AWG$/);
  if (m) return m[1];

  // NN AWG -> "NN"
  m = s.match(/^(\d{1,2})AWG$/);
  if (m) return m[1];

  // Si ya es "X/0"
  if (/^[1234]\/0$/.test(s)) return s;

  // Solo número (ej "250")
  if (/^\d{2,4}$/.test(s)) return s;

  // Alternativas con espacio (por si no se limpió arriba)
  m = String(calibre).trim().toUpperCase().match(/^(\d{1,2})\s*AWG$/);
  if (m) return m[1];
  m = String(calibre).trim().toUpperCase().match(/^([1234]\s*\/\s*0)\s*AWG$/);
  if (m) return m[1].replace(/\s*/g, '');
  m = String(calibre).trim().toUpperCase().match(/^(\d{2,4})\s*KCMIL$/);
  if (m) return m[1];

  return null;
}

// Devuelve Z (ohm/km) para cobre en PVC a FP≈0.85.
// Si no se encuentra el calibre, retorna null.
function getZOhmPerKmFromCalibre(calibre) {
  const key = parseCalibreKey(calibre);
  if (!key) return null;
  return Z_MAP_CU_PVC[key] ?? null;
}

/**
 * Calcula la caída de tensión del alimentador (%).
 *
 * Parámetros:
 *  - sistema: "Monofásico" | "Bifásico" | "Trifásico" (cadenas equivalentes también válidas)
 *  - I: corriente del alimentador en A
 *  - L_m: longitud total del alimentador en metros
 *  - calibre: calibre del conductor (ej. "2AWG", "1/0 AWG", "500 kcmil")
 *
 * Retorna:
 *  { vd_pct: number|null, Z_ohm_km: number|null, Vbase: number|null, formula: string|null }
 */
function computeFeederVDPercent({ sistema, I, L_m, calibre }) {
  const Z = getZOhmPerKmFromCalibre(calibre);
  if (!Z || !isFinite(I) || !isFinite(L_m)) {
    return { vd_pct: null, Z_ohm_km: Z ?? null, Vbase: null, formula: null };
  }

  const Iabs = Math.max(0, Number(I));
  const L = Math.max(0, Number(L_m));

  const sys = String(sistema || '').toLowerCase();
  let vd_pct = null;
  let Vbase = null;
  let formula = null;

  if (sys.includes('mono')) {
    // 1f-2h
    Vbase = EN;
    vd_pct = (2 * Iabs * L * Z) / (EN * 10);
    formula = '%e = (2·I·L·Z) / (En·10)  [1f-2h, En=120]';
  } else if (sys.includes('bi')) {
    // 2f-3h
    Vbase = EN;
    vd_pct = (Iabs * L * Z) / (EN * 10);
    formula = '%e = (I·L·Z) / (En·10)  [2f-3h, En=120]';
  } else if (sys.includes('tri')) {
    // 3f-4h
    Vbase = EF;
    vd_pct = (Math.sqrt(3) * Iabs * L * Z) / (EF * 10);
    formula = '%e = (√3·I·L·Z) / (Ef·10)  [3f-4h, Ef=220]';
  } else {
    // Por defecto, asumir monofásico
    Vbase = EN;
    vd_pct = (2 * Iabs * L * Z) / (EN * 10);
    formula = '%e = (2·I·L·Z) / (En·10)  [default 1f-2h, En=120]';
  }

  return {
    vd_pct: Number.isFinite(vd_pct) ? vd_pct : null,
    Z_ohm_km: Z,
    Vbase,
    formula
  };
}

module.exports = {
  computeFeederVDPercent,
  getZOhmPerKmFromCalibre,
  parseCalibreKey
};
