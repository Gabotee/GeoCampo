/**
 * GeoCampo - Lógica de Login, Bloqueo tras 5 intentos y Recuperación por Token
 */
document.addEventListener('DOMContentLoaded', () => {
  // Si ya tiene sesión activa, redirigir al mapa principal
  if (API.getToken()) {
    window.location.href = '/index.html';
    return;
  }

  const loginForm = document.getElementById('login-form');
  const emailInput = document.getElementById('email');
  const passwordInput = document.getElementById('password');
  const togglePassBtn = document.getElementById('toggle-pass-btn');
  const loginAlert = document.getElementById('login-alert');
  const fillDemoBtn = document.getElementById('fill-demo-btn');

  const recoveryModal = document.getElementById('recovery-modal');
  const openRecoveryBtn = document.getElementById('open-recovery-btn');
  const closeRecoveryBtn = document.getElementById('close-recovery-btn');
  const recEmailInput = document.getElementById('rec-email');
  const sendTokenBtn = document.getElementById('send-token-btn');
  const recTokenInput = document.getElementById('rec-token');
  const recNewPassInput = document.getElementById('rec-new-pass');
  const resetPasswordForm = document.getElementById('reset-password-form');
  const recoveryAlert = document.getElementById('recovery-alert');
  const recPolicyList = document.getElementById('rec-policy-list');

  function showAlert(el, msg, type = 'error') {
    el.style.display = 'block';
    el.className = `alert-box alert-${type}`;
    el.innerHTML = msg;
  }

  togglePassBtn.addEventListener('click', () => {
    const isPassword = passwordInput.type === 'password';
    passwordInput.type = isPassword ? 'text' : 'password';
    togglePassBtn.textContent = isPassword ? 'Ocultar' : 'Mostrar';
  });

  fillDemoBtn.addEventListener('click', () => {
    emailInput.value = 'productor@elaranado.com';
    passwordInput.value = 'Campo2026!';
    showToast('Credenciales del Tambo El Arañado cargadas.');
  });

  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    loginAlert.style.display = 'none';

    try {
      const res = await API.post('/api/auth/login', {
        email: emailInput.value.trim(),
        password: passwordInput.value
      });

      API.setSession(res.token, res.productor);
      if (res.passwordExpired) {
        localStorage.setItem('geocampo_pwd_expired', 'true');
      } else {
        localStorage.removeItem('geocampo_pwd_expired');
      }
      window.location.href = '/index.html';
    } catch (err) {
      const data = err.data || {};
      if (data.bloqueado) {
        showAlert(
          loginAlert,
          `🔒 <strong>CUENTA BLOQUEADA:</strong> ${err.message} <br/><button type="button" id="inline-recover-link" class="btn btn-danger btn-sm" style="margin-top:0.5rem;">Desbloquear con Token ahora</button>`,
          'error'
        );
        const btn = document.getElementById('inline-recover-link');
        if (btn) {
          btn.addEventListener('click', () => {
            recEmailInput.value = emailInput.value.trim();
            recoveryModal.classList.remove('hidden');
          });
        }
      } else {
        showAlert(loginAlert, `⚠️ ${err.message}`, 'error');
      }
    }
  });

  // Abrir / cerrar modal de recuperación
  openRecoveryBtn.addEventListener('click', () => {
    recEmailInput.value = emailInput.value.trim() || 'productor@elaranado.com';
    recoveryModal.classList.remove('hidden');
  });

  closeRecoveryBtn.addEventListener('click', () => {
    recoveryModal.classList.add('hidden');
  });

  // Checklist en vivo de política de contraseña
  recNewPassInput.addEventListener('input', () => {
    const rules = evaluatePasswordRules(recNewPassInput.value);
    recPolicyList.querySelectorAll('li').forEach((li) => {
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

  // Paso 1: Solicitar token de recuperación
  sendTokenBtn.addEventListener('click', async () => {
    const email = recEmailInput.value.trim();
    if (!email) {
      showAlert(recoveryAlert, 'Ingrese su correo electrónico.', 'error');
      return;
    }

    try {
      sendTokenBtn.disabled = true;
      const res = await API.post('/api/auth/solicitar-recuperacion', { email });
      if (res.token_simulado) {
        recTokenInput.value = res.token_simulado;
        showAlert(
          recoveryAlert,
          `📧 <strong>Token generado:</strong> <code>${res.token_simulado}</code> (Ya fue autocompletado en el campo inferior para facilitar la prueba).`,
          'success'
        );
      } else {
        showAlert(recoveryAlert, res.mensaje, 'success');
      }
    } catch (err) {
      showAlert(recoveryAlert, err.message, 'error');
    } finally {
      sendTokenBtn.disabled = false;
    }
  });

  // Paso 2: Restablecer contraseña con Token
  resetPasswordForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const res = await API.post('/api/auth/restablecer-clave', {
        token: recTokenInput.value.trim(),
        nuevaContrasena: recNewPassInput.value
      });

      showAlert(recoveryAlert, `✅ ${res.mensaje}`, 'success');
      passwordInput.value = recNewPassInput.value;
      emailInput.value = recEmailInput.value.trim();
      showToast('Cuenta desbloqueada y contraseña actualizada.');

      setTimeout(() => {
        recoveryModal.classList.add('hidden');
        showAlert(
          loginAlert,
          '✅ Su contraseña ha sido actualizada y su cuenta desbloqueada. Ya puede ingresar.',
          'success'
        );
      }, 1400);
    } catch (err) {
      showAlert(recoveryAlert, `❌ ${err.message}`, 'error');
    }
  });
});
