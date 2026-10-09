'use strict';
/* Client d'API : JSON, envois avec progression (XHR), gestion de la session expirée. */
(function () {
  class ApiError extends Error {
    constructor(status, message, code) { super(message); this.status = status; this.code = code; }
  }

  async function request(method, url, body) {
    const opts = { method, credentials: 'same-origin', headers: { 'X-Requested-With': 'isr' } };
    if (body !== undefined) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
    let res;
    try { res = await fetch(url, opts); } catch { throw new ApiError(0, 'Serveur injoignable. Vérifiez le réseau.'); }
    let data = null;
    try { data = await res.json(); } catch { /* corps vide */ }
    if (!res.ok) return fail(res.status, data);
    return data;
  }

  function fail(status, data) {
    const err = new ApiError(status, (data && data.error) || `Erreur ${status}`, data && data.code);
    if (status === 401 && window.ISR && window.ISR.onSessionLost) window.ISR.onSessionLost();
    if (status === 403 && err.code === 'MUST_CHANGE' && window.ISR && window.ISR.onMustChange) window.ISR.onMustChange();
    throw err;
  }

  /**
   * Envoie des fichiers un par un (robuste pour les gros volumes), avec progression globale.
   * onProgress({ index, total, name, loaded, grandTotal, sent }) ; retourne le nombre de réussites.
   */
  async function uploadFiles(url, files, onProgress) {
    const grandTotal = files.reduce((a, f) => a + f.size, 0);
    let done = 0;
    const errors = [];
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      try {
        await uploadOne(url, f, (loaded) => onProgress && onProgress({ index: i + 1, total: files.length, name: f.name, loaded, size: f.size, sent: done + loaded, grandTotal }));
      } catch (e) {
        if (e.status === 401) throw e;
        errors.push(`${f.name} : ${e.message}`);
      }
      done += f.size;
    }
    return { ok: files.length - errors.length, errors };
  }

  function uploadOne(url, file, onLoaded) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', url);
      xhr.setRequestHeader('X-Requested-With', 'isr');
      xhr.responseType = 'json';
      xhr.upload.onprogress = (e) => { if (e.lengthComputable) onLoaded(e.loaded); };
      xhr.onerror = () => reject(new ApiError(0, 'Connexion interrompue pendant l\'envoi.'));
      xhr.onabort = () => reject(new ApiError(0, 'Envoi annulé.'));
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) return resolve(xhr.response);
        const data = xhr.response;
        try { fail(xhr.status, data); } catch (e) { reject(e); }
      };
      const form = new FormData();
      form.append('file', file, file.name);
      xhr.send(form);
    });
  }

  // Téléchargement natif (le navigateur gère le flux et l'enregistrement sur disque).
  function download(url) {
    const a = document.createElement('a');
    a.href = url; a.rel = 'noopener';
    document.body.appendChild(a); a.click(); a.remove();
  }

  window.API = {
    ApiError,
    get: (u) => request('GET', u),
    post: (u, b) => request('POST', u, b === undefined ? {} : b),
    patch: (u, b) => request('PATCH', u, b),
    del: (u) => request('DELETE', u),
    uploadFiles, download,
  };
})();
