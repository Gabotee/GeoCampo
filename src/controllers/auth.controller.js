const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');
const db = require('../config/db');
const {
  validatePasswordPolicy,
  isPasswordInHistory,
  isPasswordExpired
} = require('../utils/passwordValidator');

const MAX_ATTEMPTS = Number(process.env.MAX_LOGIN_ATTEMPTS || 5);
const HISTORY_LIMIT = Number(process.env.PASSWORD_HISTORY_LIMIT || 3);

/**
 * POST /api/auth/login
 * Login único para el Productor con control de bloqueo tras 5 intentos fallidos
 * y verificación de vencimiento semestral de contraseña.
 */
async function login(req, res) {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({
        ok: false,
        error: 'Debe ingresar su correo electrónico y contraseña.'
      });
    }

    const [rows] = await db.query('SELECT * FROM Productor WHERE email = ?', [email.trim()]);
    const productor = rows[0];

    if (!productor) {
      return res.status(401).json({
        ok: false,
        error: 'Credenciales inválidas. Verifique su email y contraseña.'
      });
    }

    if (Boolean(productor.bloqueado)) {
      return res.status(403).json({
        ok: false,
        bloqueado: true,
        intentos_fallidos: productor.intentos_fallidos,
        error: 'Cuenta bloqueada por alcanzar 5 intentos fallidos de inicio de sesión. Utilice la opción "Recuperar / Desbloquear cuenta por token".'
      });
    }

    const passwordMatch = await bcrypt.compare(password, productor.contrasena_hash);

    if (!passwordMatch) {
      const nuevosIntentos = Number(productor.intentos_fallidos || 0) + 1;
      const seBloquea = nuevosIntentos >= MAX_ATTEMPTS;

      await db.query(
        'UPDATE Productor SET intentos_fallidos = ?, bloqueado = ? WHERE id_productor = ?',
        [nuevosIntentos, seBloquea, productor.id_productor]
      );

      if (seBloquea) {
        return res.status(403).json({
          ok: false,
          bloqueado: true,
          intentos_fallidos: nuevosIntentos,
          intentos_restantes: 0,
          error: 'Ha alcanzado los 5 intentos fallidos. Su cuenta ha sido bloqueada por seguridad. Solicite un token de recuperación por correo para desbloquearla.'
        });
      }

      const restantes = MAX_ATTEMPTS - nuevosIntentos;
      return res.status(401).json({
        ok: false,
        bloqueado: false,
        intentos_fallidos: nuevosIntentos,
        intentos_restantes: restantes,
        error: `Contraseña incorrecta. Le quedan ${restantes} intento(s) antes del bloqueo de seguridad.`
      });
    }

    // Login exitoso: reiniciar contador de intentos fallidos
    if (Number(productor.intentos_fallidos) > 0) {
      await db.query('UPDATE Productor SET intentos_fallidos = 0 WHERE id_productor = ?', [
        productor.id_productor
      ]);
    }

    const claveVencida = isPasswordExpired(productor.fecha_ultimo_cambio_clave);
    const secret = process.env.JWT_SECRET || 'geocampo_super_secret_jwt_key_el_aranado_cordoba_2026';
    const expiresIn = process.env.JWT_EXPIRES_IN || '12h';

    const token = jwt.sign(
      {
        id_productor: productor.id_productor,
        nombre: productor.nombre,
        email: productor.email
      },
      secret,
      { expiresIn }
    );

    return res.json({
      ok: true,
      token,
      passwordExpired: claveVencida,
      productor: {
        id_productor: productor.id_productor,
        nombre: productor.nombre,
        email: productor.email,
        fecha_ultimo_cambio_clave: productor.fecha_ultimo_cambio_clave
      }
    });
  } catch (err) {
    console.error('Error en login:', err);
    return res.status(500).json({ ok: false, error: 'Error interno al procesar el inicio de sesión.' });
  }
}

/**
 * POST /api/auth/solicitar-recuperacion
 * Genera token de recuperación/desbloqueo y lo envía por correo (o simula envío si no hay SMTP).
 */
async function solicitarRecuperacion(req, res) {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ ok: false, error: 'Ingrese el correo electrónico de la cuenta.' });
    }

    const [rows] = await db.query('SELECT * FROM Productor WHERE email = ?', [email.trim()]);
    const productor = rows[0];

    if (!productor) {
      return res.status(404).json({
        ok: false,
        error: 'No se encontró ningún productor registrado con ese correo electrónico.'
      });
    }

    const token = crypto.randomBytes(4).toString('hex').toUpperCase();
    const expiracion = new Date(Date.now() + 60 * 60 * 1000); // 1 hora

    await db.query(
      'UPDATE Productor SET token_recuperacion = ?, token_expiracion = ? WHERE id_productor = ?',
      [token, expiracion, productor.id_productor]
    );

    let enviadoPorSmtp = false;
    if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
      try {
        const transporter = nodemailer.createTransport({
          host: process.env.SMTP_HOST,
          port: Number(process.env.SMTP_PORT || 587),
          secure: false,
          auth: {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASS
          }
        });
        await transporter.sendMail({
          from: process.env.SMTP_FROM || '"GeoCampo" <no-reply@geocampo.agro>',
          to: productor.email,
          subject: 'GeoCampo - Token de Recuperación y Desbloqueo de Cuenta',
          text: `Hola ${productor.nombre},\n\nSu token de recuperación y desbloqueo es: ${token}\nEste código expira en 60 minutos.`
        });
        enviadoPorSmtp = true;
      } catch (mailErr) {
        console.warn('No se pudo enviar correo SMTP, usando modo simulado:', mailErr.message);
      }
    }

    console.log(`📧 [SIMULACIÓN DE CORREO] Token de recuperación para ${productor.email}: ${token}`);

    return res.json({
      ok: true,
      mensaje: enviadoPorSmtp
        ? `Se ha enviado el token de recuperación a ${productor.email}.`
        : `Correo simulado enviado a ${productor.email}. (Modo Demo: use el token ${token})`,
      token_simulado: enviadoPorSmtp ? undefined : token,
      expira_en_minutos: 60
    });
  } catch (err) {
    console.error('Error en solicitarRecuperacion:', err);
    return res.status(500).json({ ok: false, error: 'Error al generar el token de recuperación.' });
  }
}

/**
 * POST /api/auth/restablecer-clave
 * Restablece la contraseña y desbloquea la cuenta validando token, política e historial de últimas 3 claves.
 */
async function restablecerConToken(req, res) {
  try {
    const { token, nuevaContrasena } = req.body;
    if (!token || !nuevaContrasena) {
      return res.status(400).json({
        ok: false,
        error: 'Se requiere el token de recuperación y la nueva contraseña.'
      });
    }

    const [rows] = await db.query('SELECT * FROM Productor WHERE token_recuperacion = ?', [
      token.trim().toUpperCase()
    ]);
    const productor = rows[0];

    if (!productor) {
      return res.status(400).json({
        ok: false,
        error: 'El token de recuperación ingresado es inválido o ya fue utilizado.'
      });
    }

    if (productor.token_expiracion && new Date(productor.token_expiracion) < new Date()) {
      return res.status(400).json({
        ok: false,
        error: 'El token de recuperación ha expirado. Solicite uno nuevo.'
      });
    }

    // Validar política de seguridad de la contraseña
    const policy = validatePasswordPolicy(nuevaContrasena);
    if (!policy.valid) {
      return res.status(400).json({
        ok: false,
        error: `La contraseña no cumple con los requisitos de seguridad: ${policy.errors.join(' ')}`,
        detalles: policy.errors
      });
    }

    // Verificar que no repita ninguna de las últimas 3 contraseñas
    const [historial] = await db.query(
      'SELECT * FROM Historial_Contrasena WHERE id_productor = ? ORDER BY fecha_creacion DESC LIMIT ?',
      [productor.id_productor, HISTORY_LIMIT]
    );
    const matchesCurrent = await bcrypt.compare(nuevaContrasena, productor.contrasena_hash);
    const matchesHistory = await isPasswordInHistory(nuevaContrasena, historial);

    if (matchesCurrent || matchesHistory) {
      return res.status(400).json({
        ok: false,
        error: `Por seguridad, no puede reutilizar ninguna de sus últimas ${HISTORY_LIMIT} contraseñas.`
      });
    }

    const nuevoHash = await bcrypt.hash(nuevaContrasena, 10);

    await db.query(
      'UPDATE Productor SET contrasena_hash = ?, intentos_fallidos = 0, bloqueado = FALSE, token_recuperacion = NULL, token_expiracion = NULL, fecha_ultimo_cambio_clave = NOW() WHERE id_productor = ?',
      [nuevoHash, productor.id_productor]
    );

    await db.query(
      'INSERT INTO Historial_Contrasena (id_productor, contrasena_hash, fecha_creacion) VALUES (?, ?, NOW())',
      [productor.id_productor, nuevoHash]
    );

    return res.json({
      ok: true,
      mensaje: 'Contraseña restablecida y cuenta desbloqueada exitosamente. Ya puede iniciar sesión.'
    });
  } catch (err) {
    console.error('Error en restablecerConToken:', err);
    return res.status(500).json({ ok: false, error: 'Error al restablecer la contraseña.' });
  }
}

/**
 * POST /api/auth/cambiar-clave
 * Permite al productor autenticado actualizar su contraseña (ej. por vencimiento cada 6 meses),
 * validando que no repita las últimas 3 contraseñas.
 */
async function cambiarContrasena(req, res) {
  try {
    const { contrasenaActual, nuevaContrasena } = req.body;
    const idProductor = req.user.id_productor;

    if (!contrasenaActual || !nuevaContrasena) {
      return res.status(400).json({
        ok: false,
        error: 'Debe ingresar su contraseña actual y la nueva contraseña.'
      });
    }

    const [rows] = await db.query('SELECT * FROM Productor WHERE id_productor = ?', [idProductor]);
    const productor = rows[0];
    if (!productor) {
      return res.status(404).json({ ok: false, error: 'Productor no encontrado.' });
    }

    const actualValida = await bcrypt.compare(contrasenaActual, productor.contrasena_hash);
    if (!actualValida) {
      return res.status(401).json({ ok: false, error: 'La contraseña actual ingresada es incorrecta.' });
    }

    const policy = validatePasswordPolicy(nuevaContrasena);
    if (!policy.valid) {
      return res.status(400).json({
        ok: false,
        error: `La nueva contraseña no cumple la política: ${policy.errors.join(' ')}`,
        detalles: policy.errors
      });
    }

    const [historial] = await db.query(
      'SELECT * FROM Historial_Contrasena WHERE id_productor = ? ORDER BY fecha_creacion DESC LIMIT ?',
      [idProductor, HISTORY_LIMIT]
    );
    const matchesCurrent = await bcrypt.compare(nuevaContrasena, productor.contrasena_hash);
    const matchesHistory = await isPasswordInHistory(nuevaContrasena, historial);

    if (matchesCurrent || matchesHistory) {
      return res.status(400).json({
        ok: false,
        error: `Por seguridad, no puede repetir ninguna de sus últimas ${HISTORY_LIMIT} contraseñas.`
      });
    }

    const nuevoHash = await bcrypt.hash(nuevaContrasena, 10);

    await db.query(
      'UPDATE Productor SET contrasena_hash = ?, intentos_fallidos = 0, bloqueado = FALSE, token_recuperacion = NULL, token_expiracion = NULL, fecha_ultimo_cambio_clave = NOW() WHERE id_productor = ?',
      [nuevoHash, idProductor]
    );

    await db.query(
      'INSERT INTO Historial_Contrasena (id_productor, contrasena_hash, fecha_creacion) VALUES (?, ?, NOW())',
      [idProductor, nuevoHash]
    );

    return res.json({
      ok: true,
      mensaje: 'Contraseña actualizada exitosamente. Su vigencia se renovó por 6 meses.'
    });
  } catch (err) {
    console.error('Error en cambiarContrasena:', err);
    return res.status(500).json({ ok: false, error: 'Error al cambiar la contraseña.' });
  }
}

/**
 * GET /api/auth/me
 * Devuelve el perfil del productor autenticado y estado del motor de base de datos.
 */
async function obtenerPerfil(req, res) {
  try {
    const [rows] = await db.query('SELECT * FROM Productor WHERE id_productor = ?', [
      req.user.id_productor
    ]);
    const productor = rows[0];
    if (!productor) {
      return res.status(404).json({ ok: false, error: 'Productor no encontrado.' });
    }

    return res.json({
      ok: true,
      productor: {
        id_productor: productor.id_productor,
        nombre: productor.nombre,
        email: productor.email,
        fecha_ultimo_cambio_clave: productor.fecha_ultimo_cambio_clave,
        passwordExpired: isPasswordExpired(productor.fecha_ultimo_cambio_clave)
      },
      dbStatus: db.getEngineStatus()
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: 'Error al obtener perfil.' });
  }
}

module.exports = {
  login,
  solicitarRecuperacion,
  restablecerConToken,
  cambiarContrasena,
  obtenerPerfil
};
