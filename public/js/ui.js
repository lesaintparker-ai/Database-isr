'use strict';
/* Utilitaires d'interface. Toute donnée affichée via innerHTML passe par esc(). */
(function () {
  const ENT = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' };
  const esc = (s) => String(s === null || s === undefined ? '' : s).replace(/[&<>"'`]/g, (c) => ENT[c]);
  const $ = (id) => document.getElementById(id);

  const MONTHS = ['JANVIER', 'FEVRIER', 'MARS', 'AVRIL', 'MAI', 'JUIN', 'JUILLET', 'AOUT', 'SEPTEMBRE', 'OCTOBRE', 'NOVEMBRE', 'DECEMBRE'];
  const ROLE_LABEL = { admin: 'ADMINISTRATEUR', operateur: 'OPÉRATEUR', lecteur: 'LECTURE SEULE' };

  function fmtSize(b) {
    b = Number(b) || 0;
    if (b < 1024) return b + ' o';
    if (b < 1048576) return Math.round(b / 1024) + ' Ko';
    if (b < 1073741824) return (b / 1048576).toFixed(1) + ' Mo';
    return (b / 1073741824).toFixed(2) + ' Go';
  }
  const fmtDateTime = (iso) => (iso ? new Date(iso).toLocaleString('fr-FR') : '—');
  const fmtDate = (iso) => (iso ? new Date(iso).toLocaleDateString('fr-FR') : '—');
  const fmtYmd = (ymd) => { const [y, m, d] = String(ymd).split('-'); return d && m && y ? `${d}/${m}/${y}` : ymd; };

  // ---- Notifications ----
  function toast(msg, type = 'info', ms = 4500) {
    const t = document.createElement('div');
    t.className = 'toast toast-' + type;
    t.textContent = msg;
    $('toasts').appendChild(t);
    setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 400); }, ms);
  }

  // ---- Pile de modales : Échap ferme uniquement la plus récente ----
  const stack = [];
  const forced = new Set();
  function openModal(id) {
    const el = $(id);
    if (!el) return;
    el.classList.add('open');
    const i = stack.indexOf(id);
    if (i >= 0) stack.splice(i, 1);
    stack.push(id);
    el.style.zIndex = String(300 + stack.length * 2);
  }
  function closeModal(id) {
    const el = $(id);
    if (el) el.classList.remove('open');
    const i = stack.indexOf(id);
    if (i >= 0) stack.splice(i, 1);
    if (el && el._onClose) { const f = el._onClose; el._onClose = null; f(); }
  }
  function closeAllModals() { stack.slice().forEach(closeModal); }
  function closeTopModal() {
    for (let i = stack.length - 1; i >= 0; i--) {
      if (!forced.has(stack[i])) { closeModal(stack[i]); return true; }
    }
    return false;
  }

  // Modale dynamique : crée (ou réutilise) un .mbg avec un contenu HTML déjà échappé.
  function dynModal(id, html, { forceOpen = false, onClose } = {}) {
    let el = $(id);
    if (!el) {
      el = document.createElement('div');
      el.className = 'mbg';
      el.id = id;
      el.addEventListener('mousedown', (e) => { if (e.target === el && !forced.has(id)) closeModal(id); });
      document.body.appendChild(el);
    }
    el.innerHTML = html;
    if (forceOpen) forced.add(id); else forced.delete(id);
    el._onClose = onClose || null;
    openModal(id);
    return el;
  }
  function setForced(id, on) { if (on) forced.add(id); else forced.delete(id); }

  function confirmBox(message, { okLabel = 'CONFIRMER', danger = true } = {}) {
    return new Promise((resolve) => {
      const el = dynModal('modal-confirm', `
        <div class="dlg dlg-sm">
          <div class="dlg-hdr"><span class="dlg-ico">${danger ? '&#9888;' : '&#10067;'}</span><div class="dlg-title">CONFIRMATION</div></div>
          <div class="dlg-body"><p class="dlg-msg">${esc(message)}</p></div>
          <div class="dlg-foot">
            <button class="fbtn fbtn-x" data-r="0">ANNULER</button>
            <button class="fbtn ${danger ? 'fbtn-danger' : 'fbtn-s'}" data-r="1">${esc(okLabel)}</button>
          </div>
        </div>`);
      el.querySelectorAll('[data-r]').forEach((b) => b.addEventListener('click', () => { resolve(b.dataset.r === '1'); closeModal('modal-confirm'); }));
      el._onClose = () => resolve(false);
    });
  }

  function avatarHtml(user, size = 32, cls = '') {
    const s = `width:${size}px;height:${size}px;`;
    if (user && user.hasPhoto) return `<img class="avatar ${cls}" style="${s}" src="/api/users/${Number(user.id)}/photo?t=${Number(user.photoV || 0)}" alt="">`;
    return `<div class="avatar avatar-ph ${cls}" style="${s}font-size:${Math.round(size * 0.48)}px">&#128100;</div>`;
  }

  window.UI = { esc, $, MONTHS, ROLE_LABEL, fmtSize, fmtDateTime, fmtDate, fmtYmd, toast, openModal, closeModal, closeAllModals, closeTopModal, dynModal, setForced, confirmBox, avatarHtml };
})();
