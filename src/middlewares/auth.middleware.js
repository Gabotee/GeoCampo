const jwt = require('jsonwebtoken');

/**
 * Middleware para proteger los endpoints REST del Productor
 */
function authenticateToken(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      ok: false,
      error: 'Acceso no autorizado. Token de sesión no provisto.'
    });
  }

  const token = authHeader.split(' ')[1];
  try {
    const secret = process.env.JWT_SECRET || 'geocampo_super_secret_jwt_key_el_aranado_cordoba_2026';
    const payload = jwt.verify(token, secret);
    req.user = payload;
    next();
  } catch (err) {
    return res.status(401).json({
      ok: false,
      error: 'Sesión expirada o token inválido. Por favor inicie sesión nuevamente.'
    });
  }
}

module.exports = {
  authenticateToken
};
