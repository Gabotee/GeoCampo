const bcrypt = require('bcryptjs');

/**
 * Valida la política obligatoria de contraseñas:
 * - Mínimo 8 caracteres
 * - Al menos 1 letra mayúscula
 * - Al menos 1 letra minúscula
 * - Al menos 1 número
 * - Al menos 1 carácter especial
 */
function validatePasswordPolicy(password) {
  if (typeof password !== 'string') {
    return { valid: false, errors: ['La contraseña es requerida.'] };
  }

  const errors = [];
  if (password.length < 8) {
    errors.push('Debe tener al menos 8 caracteres.');
  }
  if (!/[A-Z]/.test(password)) {
    errors.push('Debe incluir al menos una letra mayúscula (A-Z).');
  }
  if (!/[a-z]/.test(password)) {
    errors.push('Debe incluir al menos una letra minúscula (a-z).');
  }
  if (!/[0-9]/.test(password)) {
    errors.push('Debe incluir al menos un número (0-9).');
  }
  if (!/[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?`~]/.test(password)) {
    errors.push('Debe incluir al menos un carácter especial (ej: !@#$%^&*).');
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Verifica si la nueva contraseña coincide con alguna de las últimas N contraseñas del historial
 */
async function isPasswordInHistory(plainPassword, historyRows = []) {
  for (const row of historyRows) {
    const match = await bcrypt.compare(plainPassword, row.contrasena_hash);
    if (match) {
      return true;
    }
  }
  return false;
}

/**
 * Verifica si transcurrieron más de 6 meses (180 días por defecto) desde el último cambio de contraseña
 */
function isPasswordExpired(fechaUltimoCambio) {
  if (!fechaUltimoCambio) return false;
  const expiryDays = Number(process.env.PASSWORD_EXPIRY_DAYS || 180);
  const lastChange = new Date(fechaUltimoCambio);
  const now = new Date();
  const diffMs = now.getTime() - lastChange.getTime();
  const diffDays = diffMs / (1000 * 60 * 60 * 24);
  return diffDays >= expiryDays;
}

module.exports = {
  validatePasswordPolicy,
  isPasswordInHistory,
  isPasswordExpired
};
