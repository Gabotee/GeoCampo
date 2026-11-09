/**
 * GeoCampo - Cliente HTTP API con manejo automático de JWT y alertas Toast
 */
const API = {
  getToken() {
    return localStorage.getItem('geocampo_token');
  },

  setSession(token, productor) {
    localStorage.setItem('geocampo_token', token);
    if (productor) {
      localStorage.setItem('geocampo_user', JSON.stringify(productor));
    }
  },

  clearSession() {
    localStorage.removeItem('geocampo_token');
    localStorage.removeItem('geocampo_user');
  },

  getUser() {
    try {
      const raw = localStorage.getItem('geocampo_user');
      return raw ? JSON.parse(raw) : null;
    } catch (_) {
      return null;
    }
  },

  async request(endpoint, options = {}) {
    const token = this.getToken();
    const headers = {
      'Content-Type': 'application/json',
      ...(options.headers || {})
    };

    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    const res = await fetch(endpoint, {
      ...options,
      headers
    });

    const data = await res.json().catch(() => ({
      ok: false,
      error: 'Respuesta inválida del servidor.'
    }));

    if (res.status === 401 && !endpoint.includes('/auth/login') && !endpoint.includes('/auth/cambiar-clave')) {
      this.clearSession();
      window.location.href = '/login.html';
      throw new Error(data.error || 'Sesión expirada.');
    }

    if (!res.ok || data.ok === false) {
      const err = new Error(data.error || 'Error en la solicitud.');
      err.data = data;
      err.status = res.status;
      throw err;
    }

    return data;
  },

  get(endpoint) {
    return this.request(endpoint, { method: 'GET' });
  },

  post(endpoint, body) {
    return this.request(endpoint, {
      method: 'POST',
      body: JSON.stringify(body)
    });
  },

  put(endpoint, body) {
    return this.request(endpoint, {
      method: 'PUT',
      body: JSON.stringify(body)
    });
  },

  delete(endpoint) {
    return this.request(endpoint, { method: 'DELETE' });
  }
};

function showToast(message, isError = false) {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    document.body.appendChild(container);
  }

  const toast = document.createElement('div');
  toast.className = `toast ${isError ? 'error' : ''}`;
  toast.textContent = message;
  container.appendChild(toast);

  setTimeout(() => {
    toast.remove();
  }, 4500);
}

function evaluatePasswordRules(pw) {
  const val = String(pw || '');
  return {
    len: val.length >= 8,
    upper: /[A-Z]/.test(val),
    lower: /[a-z]/.test(val),
    num: /[0-9]/.test(val),
    spec: /[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?`~]/.test(val)
  };
}

window.API = API;
window.showToast = showToast;
window.evaluatePasswordRules = evaluatePasswordRules;
