'use strict';
/* Administration : utilisateurs, journal d'audit, système et sauvegardes. */
(function () {
  const { $, esc } = UI;
  const A = ISR.actions;
  const errToast = (e) => UI.toast(e.message, 'error');
  let tab = 'users', auditPage = 0, auditQuery = '';
  const AUDIT_SIZE = 50;

  A.openAdmin = async () => {
    UI.closeModal('modal-histo');
    document.getElementById('side-panel').classList.remove('open'); $('side-overlay').classList.remove('open');
    UI.dynModal('modal-admin', `<div class="dlg dlg-xl">
      <div class="dlg-hdr"><span class="dlg-ico">&#9881;</span><div><div class="dlg-title">ADMINISTRATION</div><div class="dlg-sub">Comptes, journal et système</div></div>
        <button class="cbtn" data-close="modal-admin" aria-label="Fermer">&#10005;</button></div>
      <div class="tabs"><button class="tab" data-act="adminTab" data-tab="users">UTILISATEURS</button><button class="tab" data-act="adminTab" data-tab="audit">JOURNAL</button><button class="tab" data-act="adminTab" data-tab="system">SYSTÈME</button></div>
      <div class="dlg-body scroll" id="admin-body"></div></div>`);
    await render();
  };
  A.adminTab = async (t) => { tab = t.dataset.tab; await render(); };

  async function render() {
    document.querySelectorAll('#modal-admin .tab').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
    const body = $('admin-body'); body.innerHTML = '<div class="loading">Chargement...</div>';
    try {
      if (tab === 'users') await renderUsers(body);
      else if (tab === 'audit') await renderAudit(body);
      else await renderSystem(body);
    } catch (e) { body.innerHTML = ''; errToast(e); }
  }

  // ---------------- utilisateurs
  async function renderUsers(body) {
    const { users } = await API.get('/api/users');
    const rows = users.map((u, i) => `<tr class="${i % 2 ? 'alt' : ''} ${u.active ? '' : 'inactive'}">
      <td class="c">${UI.avatarHtml(u, 28)}</td><td class="mono">${esc(u.username)}</td><td>${esc(u.grade)} ${esc(u.nom.toUpperCase())} ${esc(u.prenom)}</td>
      <td><select class="sel-sm" data-act="userRole" data-id="${u.id}">${['admin', 'operateur', 'lecteur'].map((r) => `<option value="${r}" ${r === u.role ? 'selected' : ''}>${UI.ROLE_LABEL[r]}</option>`).join('')}</select></td>
      <td>${u.active ? '<span class="pill ok">ACTIF</span>' : '<span class="pill ko">DÉSACTIVÉ</span>'}${u.mustChange ? ' <span class="pill warn">MDP TEMP.</span>' : ''}</td>
      <td class="r"><button class="zf-btn-dl" data-act="userReset" data-id="${u.id}" data-name="${esc(u.username)}">MOT DE PASSE</button>
      <button class="zf-btn-del wide" data-act="userToggle" data-id="${u.id}" data-active="${u.active ? 1 : 0}" data-name="${esc(u.username)}">${u.active ? 'DÉSACTIVER' : 'RÉACTIVER'}</button></td></tr>`).join('');
    body.innerHTML = `<form class="new-user" id="new-user-form" autocomplete="off">
      <div class="nu-t">NOUVEL UTILISATEUR</div>
      <div class="nu-grid"><input class="pf" name="username" placeholder="Identifiant (ex: dupont.k)" maxlength="40" required>
      <input class="pf" name="grade" placeholder="Grade" maxlength="60" required><input class="pf" name="nom" placeholder="Nom" maxlength="80" required><input class="pf" name="prenom" placeholder="Prénom" maxlength="80" required>
      <select class="pf" name="role"><option value="operateur">Opérateur</option><option value="lecteur">Lecture seule</option><option value="admin">Administrateur</option></select>
      <button class="fbtn fbtn-s" type="submit">&#43; CRÉER</button></div>
      <div class="form-error" id="nu-error" role="alert"></div></form>
      <table class="tbl"><thead><tr><th></th><th>IDENTIFIANT</th><th>NOM</th><th>RÔLE</th><th>STATUT</th><th></th></tr></thead><tbody>${rows}</tbody></table>`;
    $('new-user-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = e.target, o = {}; ['username', 'grade', 'nom', 'prenom', 'role'].forEach((k) => { o[k] = f[k].value.trim(); });
      try { const r = await API.post('/api/users', o); showTempPassword(r.user.username, r.temporaryPassword); await render(); } catch (ex) { $('nu-error').textContent = ex.message; }
    });
  }

  function showTempPassword(username, pw) {
    UI.dynModal('modal-temp-pw', `<div class="dlg dlg-sm"><div class="dlg-hdr"><span class="dlg-ico">&#128273;</span><div class="dlg-title">MOT DE PASSE TEMPORAIRE</div></div>
      <div class="dlg-body"><p class="dlg-msg">Compte <b>${esc(username)}</b>. Transmettez ce mot de passe à l'utilisateur : il ne sera <b>plus jamais affiché</b> et devra être changé à la première connexion.</p>
      <div class="temp-pw" id="temp-pw">${esc(pw)}</div></div>
      <div class="dlg-foot"><button class="fbtn fbtn-x" data-act="copyTemp">COPIER</button><button class="fbtn fbtn-s" data-close="modal-temp-pw">J'AI NOTÉ</button></div></div>`,
      { onClose: () => { const t = $('temp-pw'); if (t) t.textContent = ''; } });
  }
  A.copyTemp = async () => { try { await navigator.clipboard.writeText($('temp-pw').textContent); UI.toast('Copié.', 'ok'); } catch { UI.toast('Copie impossible : sélectionnez le texte manuellement.', 'error'); } };

  A.userRole = async (t) => {
    try { await API.patch(`/api/users/${t.dataset.id}`, { role: t.value }); UI.toast('Rôle modifié.', 'ok'); } catch (e) { errToast(e); }
    await render();
  };
  A.userReset = async (t) => {
    if (!(await UI.confirmBox(`Réinitialiser le mot de passe de « ${t.dataset.name} » ? Ses sessions seront fermées.`, { okLabel: 'RÉINITIALISER' }))) return;
    try { const r = await API.patch(`/api/users/${t.dataset.id}`, { resetPassword: true }); showTempPassword(t.dataset.name, r.temporaryPassword); await render(); } catch (e) { errToast(e); }
  };
  A.userToggle = async (t) => {
    const active = t.dataset.active === '1';
    if (active && !(await UI.confirmBox(`Désactiver « ${t.dataset.name} » ? Il sera déconnecté immédiatement.`, { okLabel: 'DÉSACTIVER' }))) return;
    try { await API.patch(`/api/users/${t.dataset.id}`, { active: !active }); await render(); } catch (e) { errToast(e); }
  };

  // ---------------- journal
  async function renderAudit(body) {
    const q = auditQuery ? `&q=${encodeURIComponent(auditQuery)}` : '';
    const d = await API.get(`/api/admin/audit?limit=${AUDIT_SIZE}&offset=${auditPage * AUDIT_SIZE}${q}`);
    const rows = d.entries.map((e, i) => `<tr class="${i % 2 ? 'alt' : ''}"><td class="mono">${esc(UI.fmtDateTime(e.at))}</td><td class="mono">${esc(e.username || '—')}</td>
      <td><span class="pill ${e.action.includes('echec') || e.action.includes('supprim') ? 'ko' : 'blue'}">${esc(e.action)}</span></td><td class="dim">${esc(e.detail)}</td><td class="mono dim">${esc(e.ip || '')}</td></tr>`).join('')
      || '<tr><td colspan="5" class="empty">Aucune entrée</td></tr>';
    const pages = Math.max(1, Math.ceil(d.total / AUDIT_SIZE));
    body.innerHTML = `<div class="audit-bar"><input class="pf" id="audit-q" placeholder="Rechercher (utilisateur, action, détail)..." value="${esc(auditQuery)}"><button class="fbtn fbtn-s" data-act="auditSearch">RECHERCHER</button>
      <span class="dim">${d.total} entrée(s)</span><span style="flex:1"></span>
      <button class="fbtn fbtn-x" data-act="auditPrev" ${auditPage === 0 ? 'disabled' : ''}>&lsaquo;</button><span class="dim">${auditPage + 1} / ${pages}</span>
      <button class="fbtn fbtn-x" data-act="auditNext" ${auditPage + 1 >= pages ? 'disabled' : ''}>&rsaquo;</button></div>
      <table class="tbl"><thead><tr><th>DATE</th><th>UTILISATEUR</th><th>ACTION</th><th>DÉTAIL</th><th>IP</th></tr></thead><tbody>${rows}</tbody></table>`;
    $('audit-q').addEventListener('keydown', (e) => { if (e.key === 'Enter') A.auditSearch(); });
  }
  A.auditSearch = async () => { auditQuery = $('audit-q').value.trim(); auditPage = 0; await render(); };
  A.auditPrev = async () => { auditPage = Math.max(0, auditPage - 1); await render(); };
  A.auditNext = async () => { auditPage++; await render(); };

  // ---------------- système
  async function renderSystem(body) {
    const [s, b] = await Promise.all([API.get('/api/admin/stats'), API.get('/api/admin/backups')]);
    const bk = b.backups.map((x) => `<tr><td class="mono">${esc(x.name)}</td><td>${UI.fmtSize(x.size)}</td><td class="r"><a class="zf-btn-dl" href="/api/admin/backups/${encodeURIComponent(x.name)}">&#11015; TÉLÉCHARGER</a></td></tr>`).join('') || '<tr><td colspan="3" class="empty">Aucune sauvegarde</td></tr>';
    body.innerHTML = `<div class="stats">
      <div class="stat"><b>${s.users}</b><span>utilisateurs actifs</span></div><div class="stat"><b>${s.files}</b><span>fichiers · ${UI.fmtSize(s.filesBytes)}</span></div>
      <div class="stat"><b>${s.medias}</b><span>médias · ${UI.fmtSize(s.mediasBytes)}</span></div><div class="stat"><b>${s.fiches}</b><span>fiches</span></div>
      <div class="stat"><b>${s.diskFreeBytes === null ? '—' : UI.fmtSize(s.diskFreeBytes)}</b><span>espace disque libre</span></div></div>
      <div class="nu-t" style="margin-top:18px">SAUVEGARDES DE LA BASE</div>
      <p class="dim" style="margin:6px 0 10px">La sauvegarde contient les comptes, fiches et index. Les fichiers et médias se trouvent dans le dossier <span class="mono">data/storage</span> du serveur : copiez-le aussi (voir le guide d'exploitation).</p>
      <button class="fbtn fbtn-s" data-act="doBackup">&#128190;&nbsp; SAUVEGARDER MAINTENANT</button>
      <table class="tbl" style="margin-top:12px"><thead><tr><th>FICHIER</th><th>TAILLE</th><th></th></tr></thead><tbody>${bk}</tbody></table>`;
  }
  A.doBackup = async () => { try { const r = await API.post('/api/admin/backup'); UI.toast('Sauvegarde créée : ' + r.name, 'ok'); await render(); } catch (e) { errToast(e); } };
})();
