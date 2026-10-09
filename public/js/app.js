'use strict';
/* Noyau : écrans, connexion, menu, panneau latéral, délégation des événements. */
(function () {
  const { $, esc } = UI;
  const ISR = (window.ISR = { user: null, actions: {}, year: null, month: null, zone: null });
  const can = { write: () => ISR.user && ['admin', 'operateur'].includes(ISR.user.role), admin: () => ISR.user && ISR.user.role === 'admin' };
  ISR.can = can;

  // ---------------------------------------------------------------- écrans
  const SCRS = ['s1', 's2', 's3', 's4'];
  const DUR = [2200, 2200, null, null];
  let splashTimer = null;

  function goTo(i) {
    clearTimeout(splashTimer);
    // Session déjà valide (rechargement de page) : on saute l'écran de connexion.
    if (i === 2 && ISR.user) { i = 3; if (ISR.user.mustChange) setTimeout(() => openPasswordModal(true), 300); }
    SCRS.forEach((id, j) => { $(id).classList.toggle('on', j === i); const d = $('d' + j); if (d) d.classList.toggle('on', j === i); });
    const pb = $('pbar');
    pb.style.transition = 'none'; pb.style.width = '0';
    if (DUR[i] !== null) {
      $('dots').style.display = 'flex'; document.querySelector('.prog-wrap').style.display = '';
      requestAnimationFrame(() => requestAnimationFrame(() => { pb.style.transition = `width ${DUR[i]}ms linear`; pb.style.width = '100%'; }));
      splashTimer = setTimeout(() => goTo(i + 1), DUR[i]);
    } else {
      $('dots').style.display = 'none'; document.querySelector('.prog-wrap').style.display = 'none';
    }
  }
  ISR.goTo = goTo;

  function tick() {
    const n = new Date(), p = (x) => String(x).padStart(2, '0');
    const t = `${p(n.getUTCDate())}/${p(n.getUTCMonth() + 1)}/${n.getUTCFullYear()}  ${p(n.getUTCHours())}:${p(n.getUTCMinutes())}:${p(n.getUTCSeconds())} (Z)`;
    document.querySelectorAll('.clock').forEach((c) => { c.textContent = t; });
  }

  // ---------------------------------------------------------------- session
  function applyUser(u) {
    ISR.user = u;
    ISR.user.photoV = Date.now();
    document.body.dataset.role = u ? u.role : '';
    $('nav-admin').hidden = !can.admin();
    $('menu-fiche').classList.toggle('disabled', !can.write());
    $('menu-fiche').title = can.write() ? '' : 'Compte en lecture seule : création de fiches non autorisée';
  }

  function resetSession() {
    ISR.user = null;
    document.body.dataset.role = '';
    UI.closeAllModals();
    closeSidePanel();
    $('in-pwd').value = '';
  }

  ISR.onSessionLost = function () {
    if (!ISR.user) return;
    resetSession();
    goTo(2);
    UI.toast('Session expirée ou fermée : reconnectez-vous.', 'error');
  };
  ISR.onMustChange = function () { openPasswordModal(true); };

  function bgInit() {
    const url = 'url("/assets/logo.png")';
    document.querySelector('.bg-blur').style.backgroundImage = url;
    document.querySelector('.menu-bg-img').style.backgroundImage = url;
  }

  async function enterApp(res) {
    applyUser(res.user);
    closeSidePanel();
    goTo(3);
    ISR.previous = res.previous || null;
    if (res.user.mustChange) openPasswordModal(true);
    else flushPrevious();
  }

  // La bannière « dernière connexion » attend que le mot de passe temporaire soit remplacé.
  function flushPrevious() {
    if (ISR.previous) { const p = ISR.previous; ISR.previous = null; setTimeout(() => showPreviousUser(p), 500); }
  }

  async function doLogin(e) {
    e.preventDefault();
    const username = $('in-login').value.trim(), password = $('in-pwd').value;
    const err = $('login-error'), btn = $('btn-login');
    err.textContent = '';
    if (!username || !password) { err.textContent = 'Veuillez entrer votre identifiant et votre mot de passe.'; return; }
    btn.disabled = true;
    try {
      const res = await API.post('/api/login', { username, password });
      $('in-pwd').value = '';
      await enterApp(res);
    } catch (ex) { err.textContent = ex.message; $('in-pwd').select(); }
    finally { btn.disabled = false; }
  }

  async function logout() {
    closeSidePanel();
    try { await API.post('/api/logout'); } catch { /* déjà déconnecté */ }
    resetSession();
    $('in-login').value = '';
    goTo(2);
  }

  // ---------------------------------------------------------------- panneau latéral & profil
  function openSidePanel() {
    const u = ISR.user; if (!u) return;
    $('sp-avatar-wrap').innerHTML = UI.avatarHtml(u, 72, 'side-panel-avatar');
    $('sp-name').textContent = `${u.nom.toUpperCase()} ${u.prenom}`;
    $('sp-grade').textContent = u.grade;
    $('sp-pseudo').textContent = u.username;
    $('sp-role').textContent = UI.ROLE_LABEL[u.role];
    $('side-panel').classList.add('open'); $('side-overlay').classList.add('open');
  }
  function closeSidePanel() { $('side-panel').classList.remove('open'); $('side-overlay').classList.remove('open'); }

  function showProfile() {
    closeSidePanel();
    const u = ISR.user;
    UI.dynModal('modal-profile', `
      <div class="dlg dlg-sm">
        <div class="dlg-hdr"><span class="dlg-ico">&#128100;</span><div class="dlg-title">MON PROFIL</div>
          <button class="cbtn" data-close="modal-profile" aria-label="Fermer">&#10005;</button></div>
        <div class="dlg-body" style="text-align:center">
          <div style="display:flex;justify-content:center;margin-bottom:12px">${UI.avatarHtml(u, 90, 'avatar-lg')}</div>
          <div class="prof-name">${esc(u.grade)} ${esc(u.nom.toUpperCase())} ${esc(u.prenom)}</div>
          <div class="prof-sub">${esc(u.username)}</div>
          <div class="prof-box"><div><b>RÔLE :</b> ${esc(UI.ROLE_LABEL[u.role])}</div></div>
          <input type="file" id="photo-input" accept="image/*" hidden>
          <div class="form-error" id="profile-error" role="alert"></div>
        </div>
        <div class="dlg-foot">
          <button class="fbtn fbtn-x" data-act="pickPhoto">&#128247;&nbsp; CHANGER LA PHOTO</button>
          <button class="fbtn fbtn-s" data-act="openPassword">&#128273;&nbsp; MOT DE PASSE</button>
        </div>
      </div>`);
    $('photo-input').addEventListener('change', async (ev) => {
      const f = ev.target.files[0]; if (!f) return;
      if (f.size > 5 * 1024 * 1024) { $('profile-error').textContent = 'Photo trop volumineuse (5 Mo maximum).'; return; }
      try {
        const r = await API.uploadFiles(`/api/users/${u.id}/photo`, [f]);
        if (r.errors.length) throw new Error(r.errors[0].split(' : ').slice(1).join(' : '));
        ISR.user.photoV = Date.now(); ISR.user.hasPhoto = true;
        UI.toast('Photo mise à jour.', 'ok'); showProfile();
      } catch (ex) { $('profile-error').textContent = ex.message; }
    });
  }

  function openPasswordModal(forceChange) {
    const el = UI.dynModal('modal-password', `
      <form class="dlg dlg-sm" id="pw-form" autocomplete="off">
        <div class="dlg-hdr"><span class="dlg-ico">&#128273;</span><div class="dlg-title">${forceChange ? 'CHOISIR UN MOT DE PASSE' : 'CHANGER LE MOT DE PASSE'}</div>
          ${forceChange ? '' : '<button type="button" class="cbtn" data-close="modal-password" aria-label="Fermer">&#10005;</button>'}</div>
        <div class="dlg-body">
          ${forceChange ? '<p class="dlg-msg">Votre mot de passe est temporaire. Choisissez-en un nouveau pour continuer.</p>' : ''}
          <label class="lbl">MOT DE PASSE ACTUEL</label><input class="inp" type="password" name="current" autocomplete="current-password">
          <label class="lbl">NOUVEAU MOT DE PASSE <span class="hint">(10 caractères min., 3 types parmi a-z, A-Z, 0-9, symboles)</span></label>
          <input class="inp" type="password" name="next" autocomplete="new-password">
          <div class="pw-meter"><div id="pw-meter-bar"></div></div><div class="pw-meter-txt" id="pw-meter-txt"></div>
          <label class="lbl">CONFIRMER</label><input class="inp" type="password" name="next2" autocomplete="new-password">
          <div class="form-error" id="pw-error" role="alert"></div>
        </div>
        <div class="dlg-foot">
          ${forceChange ? '<button type="button" class="fbtn fbtn-x" data-act="logout">DÉCONNEXION</button>' : ''}
          <button class="fbtn fbtn-s" type="submit">&#10004;&nbsp; VALIDER</button>
        </div>
      </form>`, { forceOpen: !!forceChange });
    const f = $('pw-form');
    f.next.addEventListener('input', () => meter(f.next.value));
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      const err = $('pw-error'); err.textContent = '';
      if (f.next.value !== f.next2.value) { err.textContent = 'Les deux mots de passe ne correspondent pas.'; return; }
      try {
        await API.post('/api/password', { current: f.current.value, next: f.next.value });
        UI.setForced('modal-password', false); UI.closeModal('modal-password');
        if (ISR.user) ISR.user.mustChange = false;
        UI.toast('Mot de passe modifié.', 'ok');
        flushPrevious();
      } catch (ex) { err.textContent = ex.message; }
    });
    f.current.focus();
    return el;
  }
  function meter(pw) {
    let score = 0;
    if (pw.length >= 10) score++; if (pw.length >= 14) score++;
    if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score++; if (/[0-9]/.test(pw)) score++; if (/[^A-Za-z0-9]/.test(pw)) score++;
    const L = [['#E74C3C', 'FAIBLE'], ['#E67E22', 'MOYEN'], ['#F1C40F', 'BON'], ['#27AE60', 'FORT'], ['#1ABC9C', 'TRÈS FORT']];
    const bar = $('pw-meter-bar'), txt = $('pw-meter-txt');
    if (!pw) { bar.style.width = '0'; txt.textContent = ''; return; }
    const lv = L[Math.max(0, Math.min(score - 1, 4))];
    bar.style.width = score * 20 + '%'; bar.style.background = lv[0]; txt.style.color = lv[0]; txt.textContent = lv[1];
  }

  async function showHistorique() {
    closeSidePanel();
    let data;
    try { data = await API.get('/api/history'); } catch (e) { return UI.toast(e.message, 'error'); }
    const rows = data.sessions.map((s, i) => `<tr class="${i % 2 ? 'alt' : ''}">
      <td class="c">${UI.avatarHtml({ id: s.userId, hasPhoto: s.hasPhoto }, 28)}</td><td class="gold">${esc(s.grade)}</td>
      <td>${esc(s.nom.toUpperCase())} ${esc(s.prenom)}</td><td class="mono">${esc(s.username)}</td><td class="mono">${esc(UI.fmtDateTime(s.at))}</td>
      <td>${s.online ? '<span class="pill ok">EN LIGNE</span>' : ''}</td></tr>`).join('') || '<tr><td colspan="6" class="empty">Aucune connexion enregistrée</td></tr>';
    UI.dynModal('modal-histo', `<div class="dlg dlg-xl">
      <div class="dlg-hdr"><span class="dlg-ico">&#128337;</span><div><div class="dlg-title">HISTORIQUE DES CONNEXIONS</div><div class="dlg-sub">${data.sessions.length} connexion(s) récente(s)</div></div>
        <button class="cbtn" data-close="modal-histo" aria-label="Fermer">&#10005;</button></div>
      <div class="dlg-body scroll"><table class="tbl"><thead><tr><th></th><th>GRADE</th><th>NOM</th><th>IDENTIFIANT</th><th>DATE &amp; HEURE</th><th></th></tr></thead><tbody>${rows}</tbody></table></div></div>`);
  }

  function showPreviousUser(p) {
    const old = $('prev-user-banner'); if (old) old.remove();
    const b = document.createElement('div');
    b.id = 'prev-user-banner'; b.className = 'prev-banner';
    b.innerHTML = `${UI.avatarHtml({ id: p.id, hasPhoto: p.hasPhoto }, 44)}<div style="flex:1;min-width:0">
      <div class="pb-t">DERNIÈRE CONNEXION</div><div class="pb-n">${esc(p.grade)} ${esc(p.nom.toUpperCase())} ${esc(p.prenom)}</div>
      <div class="pb-d">${esc(UI.fmtDateTime(p.at))}</div></div><button class="pb-x" aria-label="Fermer">&#10005;</button>`;
    b.querySelector('.pb-x').addEventListener('click', () => b.remove());
    document.body.appendChild(b);
    setTimeout(() => { b.style.transition = 'opacity .5s'; b.style.opacity = '0'; setTimeout(() => b.remove(), 500); }, 8000);
  }

  // ---------------------------------------------------------------- actions & événements
  Object.assign(ISR.actions, {
    openSidePanel, closeSidePanel, showProfile, showHistorique, logout,
    openPassword: () => openPasswordModal(false),
    pickPhoto: () => $('photo-input').click(),
  });

  document.addEventListener('click', (e) => {
    const close = e.target.closest('[data-close]');
    if (close) { UI.closeModal(close.dataset.close); return; }
    const t = e.target.closest('[data-act]');
    if (!t || t.disabled || t.classList.contains('disabled') || t.tagName === 'SELECT') return;
    const fn = ISR.actions[t.dataset.act];
    if (fn) fn(t, e);
  });
  document.addEventListener('change', (e) => {
    const t = e.target.closest('select[data-act]');
    if (t && ISR.actions[t.dataset.act]) ISR.actions[t.dataset.act](t, e);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if ($('side-panel').classList.contains('open')) closeSidePanel();
      else UI.closeTopModal();
    } else if ((e.key === 'Enter' || e.key === ' ') && e.target.matches && e.target.matches('[role=button][data-act]')) {
      e.preventDefault(); e.target.click();
    }
  });

  // ---------------------------------------------------------------- démarrage
  async function boot() {
    bgInit(); tick(); setInterval(tick, 1000);
    $('login-form').addEventListener('submit', doLogin);
    $('chk-show').addEventListener('change', (e) => { $('in-pwd').type = e.target.checked ? 'text' : 'password'; });
    let me = null;
    try { me = await API.get('/api/me'); } catch { /* non connecté */ }
    if (me && me.user) applyUser(me.user);
    goTo(0);
  }
  window.addEventListener('DOMContentLoaded', boot);
})();
