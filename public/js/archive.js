'use strict';
/* Registre annuel, mois, zones, dossiers de fichiers et médias. */
(function () {
  const { $, esc, MONTHS } = UI;
  const A = ISR.actions;
  const ZONES = [
    { id: 'A', nom: 'ZONE A', region: 'Nord-Ouest', color: '#1A7A3A' }, { id: 'B', nom: 'ZONE B', region: 'Nord-Est', color: '#1A4A92' },
    { id: 'C', nom: 'ZONE C', region: 'Centre-Ouest', color: '#7B3FA0' }, { id: 'D', nom: 'ZONE D', region: 'Centre-Est', color: '#B8861B' },
    { id: 'E', nom: 'ZONE E', region: 'Sud-Ouest', color: '#C0392B' }, { id: 'F', nom: 'ZONE F', region: 'Sud-Est', color: '#16878C' },
  ];
  const FIRST_YEAR = 2026;
  const ICONS = ['&#9992;', '&#128681;', '&#128745;'];
  const errToast = (e) => UI.toast(e.message, 'error');

  // ------------------------------------------------------------- années
  A.openRegistre = function () {
    const now = new Date().getFullYear();
    const last = Math.max(2035, now);
    const grid = $('reg-grid'); grid.innerHTML = '';
    $('reg-info-droite').textContent = 'Année en cours : ' + now;
    for (let y = FIRST_YEAR; y <= last; y++) {
      const locked = y > now, current = y === now;
      const card = document.createElement('div');
      card.className = 'reg-card' + (locked ? ' locked' : '') + (current ? ' active-year' : '');
      card.innerHTML = `<div class="reg-ico">${locked ? '&#128274;' : '&#128193;'}</div><div class="reg-yr">${y}</div><div class="reg-name">ISR_DATABASE_${y}</div>` +
        (locked ? '<span class="reg-status locked-lbl">&#9940; VERROUILLÉ</span>' : current ? '<span class="reg-status current">&#9733; EN COURS</span>' : '<span class="reg-status open">&#10003; ACTIF</span>');
      if (!locked) { card.setAttribute('role', 'button'); card.tabIndex = 0; card.addEventListener('click', () => openYear(y)); }
      grid.appendChild(card);
    }
    UI.openModal('modal-registre');
  };

  async function openYear(y) {
    ISR.year = y;
    let sum;
    try { sum = await API.get(`/api/summary/${y}`); } catch (e) { return errToast(e); }
    $('mois-title').textContent = 'ISR_DATABASE_' + y;
    const g = $('mois-grid'); g.innerHTML = '';
    MONTHS.forEach((name, i) => {
      const s = sum.months[i];
      const el = document.createElement('div');
      el.className = 'mc'; el.setAttribute('role', 'button'); el.tabIndex = 0;
      const info = [`${s.files} fichier${s.files !== 1 ? 's' : ''}`, `${s.medias} média${s.medias !== 1 ? 's' : ''}`, `${s.fiches} fiche${s.fiches !== 1 ? 's' : ''}`].join(' · ');
      el.innerHTML = `<span class="mc-num">${String(i + 1).padStart(2, '0')}</span><span class="mc-ico">${ICONS[i % 3]}</span><span class="mc-name">${name}</span><span class="mc-info">${info}</span>`;
      el.addEventListener('click', () => openMonth(y, i + 1));
      g.appendChild(el);
    });
    UI.openModal('modal-mois');
  }

  // ------------------------------------------------------------- zones d'un mois
  async function openMonth(y, m) {
    ISR.year = y; ISR.month = m;
    $('zones-year-month').textContent = `${y} › ${MONTHS[m - 1]}`;
    const grid = $('zones-grid');
    grid.innerHTML = '<div class="loading">Chargement...</div>';
    UI.openModal('modal-zones');
    await refreshZones();
  }
  async function refreshZones() {
    const { year: y, month: m } = ISR;
    let data;
    try { data = await API.get(`/api/zones/${y}/${m}`); } catch (e) { return errToast(e); }
    const grid = $('zones-grid'); grid.innerHTML = '';
    data.zones.forEach((z) => {
      const card = document.createElement('div');
      card.className = 'zone-card'; card.style.cssText = `border-color:${z.color}33;`;
      card.setAttribute('role', 'button'); card.tabIndex = 0;
      card.innerHTML = `<div class="zone-card-ico" style="color:${z.color}">&#128193;</div><div class="zone-card-nom" style="color:${z.color}">${esc(z.nom)}</div>
        <div class="zone-card-region">${esc(z.region)}</div><div class="zone-card-count">${z.count} fichier${z.count !== 1 ? 's' : ''}${z.bytes ? ' · ' + UI.fmtSize(z.bytes) : ''}</div>`;
      card.addEventListener('click', () => openZone(z.id));
      grid.appendChild(card);
    });
    try {
      const f = await API.get(`/api/fiches?year=${y}&month=${m}`);
      $('btn-fiches-mois').innerHTML = `&#128203;&nbsp; FICHES DU MOIS (${f.fiches.length})`;
    } catch { /* non bloquant */ }
  }

  // ------------------------------------------------------------- dossier d'une zone
  async function openZone(zid) {
    ISR.zone = zid;
    const z = ZONES.find((x) => x.id === zid);
    $('zone-title').textContent = `${z.nom} — ${z.region}`;
    $('zone-subtitle').textContent = `${ISR.year} › ${MONTHS[ISR.month - 1]}`;
    $('zone-header-bar').style.background = `linear-gradient(90deg,#0D1B2A,${z.color}44,#0D1B2A)`;
    $('zone-upload-status').textContent = '';
    $('btn-upload-files').hidden = !ISR.can.write();
    UI.openModal('modal-zone');
    await renderZoneFiles();
  }

  const TYPE_COLOR = { PPTX: '#D35400', PDF: '#C0392B', DOCX: '#1A4A92', AUTRE: '#8A9BB0' };
  const TYPE_ICO = { PPTX: '&#128251;', PDF: '&#128196;', DOCX: '&#128195;', AUTRE: '&#128196;' };

  async function renderZoneFiles() {
    const cont = $('zone-files');
    let data;
    try { data = await API.get(`/api/files/${ISR.year}/${ISR.month}/${ISR.zone}`); } catch (e) { cont.innerHTML = ''; return errToast(e); }
    const files = data.files;
    $('btn-zip-zone').disabled = files.length === 0;
    if (!files.length) {
      cont.innerHTML = '<div class="zone-empty">&#128194;&nbsp; Aucun fichier.<br><br>' + (ISR.can.write() ? 'Cliquez sur <strong>FICHIERS</strong> ou glissez-déposez des documents ici.' : '') + '</div>';
      return;
    }
    const folders = {};
    files.forEach((f) => { (folders[f.folder] = folders[f.folder] || []).push(f); });
    cont.innerHTML = Object.keys(folders).sort().reverse().map((fname) => {
      const ff = folders[fname];
      const types = ['PPTX', 'PDF', 'DOCX', 'AUTRE'].map((t) => {
        const list = ff.filter((f) => f.type === t);
        if (!list.length) return '';
        const items = list.map((f) => {
          const canDel = ISR.user.role === 'admin' || (ISR.user.role === 'operateur' && f.uploadedById === ISR.user.id);
          return `<div class="zf-file"><span class="zf-file-name" title="${esc(f.name)}">${esc(f.name)}</span><span class="zf-file-size">${UI.fmtSize(f.size)}</span>
            <span class="zf-file-date" title="${esc(f.uploadedBy || '')}">${esc(UI.fmtDate(f.uploadedAt))}</span>
            <div class="zf-file-actions"><button class="zf-btn-dl" data-act="dlFile" data-id="${f.id}">&#11015; DL</button>${canDel ? `<button class="zf-btn-del" data-act="delFile" data-id="${f.id}" data-name="${esc(f.name)}" aria-label="Supprimer">&#10005;</button>` : ''}</div></div>`;
        }).join('');
        return `<div class="zf-type-section"><div class="zf-type-hdr" style="color:${TYPE_COLOR[t]}">${TYPE_ICO[t]}&nbsp;${t} <span class="zf-type-count">${list.length}</span></div><div>${items}</div></div>`;
      }).join('');
      return `<div class="zf-folder"><div class="zf-folder-hdr"><span class="zf-folder-ico">&#128193;</span><span class="zf-folder-name">${esc(fname)}</span><span class="zf-folder-count">${ff.length} fichier${ff.length !== 1 ? 's' : ''}</span></div><div class="zf-folder-body">${types}</div></div>`;
    }).join('');
  }

  function showProgress(barId, statusId, p, label) {
    const bar = $(barId); const st = $(statusId);
    bar.classList.add('on');
    bar.firstElementChild.style.width = Math.min(100, (p.sent / Math.max(1, p.grandTotal)) * 100).toFixed(1) + '%';
    st.style.color = '#C8A84B';
    st.textContent = `${label} ${p.index}/${p.total} — ${UI.fmtSize(p.sent)} / ${UI.fmtSize(p.grandTotal)}`;
  }
  function endProgress(barId, statusId, res, noun) {
    $(barId).classList.remove('on'); $(barId).firstElementChild.style.width = '0';
    const st = $(statusId);
    if (res.errors.length) { st.style.color = '#E74C3C'; st.textContent = `${res.ok} envoyé(s), ${res.errors.length} échec(s)`; UI.toast(res.errors.join('\n'), 'error', 9000); }
    else { st.style.color = '#27AE60'; st.textContent = `✔ ${res.ok} ${noun} ajouté(s)`; }
    setTimeout(() => { st.textContent = ''; }, 6000);
  }

  let uploading = false;
  async function uploadDocs(fileList) {
    if (!ISR.can.write() || uploading) return;
    const ok = /\.(pptx?|pdf|docx?)$/i;
    const files = Array.from(fileList);
    const bad = files.filter((f) => !ok.test(f.name));
    if (bad.length) UI.toast(`Types non acceptés (PPTX, PDF, DOCX uniquement) : ${bad.map((f) => f.name).join(', ')}`, 'error', 8000);
    const good = files.filter((f) => ok.test(f.name));
    if (!good.length) return;
    uploading = true;
    try {
      const res = await API.uploadFiles(`/api/files/${ISR.year}/${ISR.month}/${ISR.zone}`, good, (p) => showProgress('zone-progress', 'zone-upload-status', p, 'Envoi'));
      endProgress('zone-progress', 'zone-upload-status', res, 'fichier(s)');
      await renderZoneFiles(); refreshZones();
    } catch (e) { errToast(e); $('zone-progress').classList.remove('on'); }
    finally { uploading = false; }
  }

  A.pickFiles = () => { const inp = $('zone-file-input'); inp.value = ''; inp.click(); };
  A.dlFile = (t) => API.download(`/api/files/${t.dataset.id}/download`);
  A.delFile = async (t) => {
    if (!(await UI.confirmBox(`Supprimer définitivement « ${t.dataset.name} » ?`, { okLabel: 'SUPPRIMER' }))) return;
    try { await API.del(`/api/files/${t.dataset.id}`); UI.toast('Fichier supprimé.', 'ok'); await renderZoneFiles(); refreshZones(); } catch (e) { errToast(e); }
  };
  A.zipZone = () => API.download(`/api/files/${ISR.year}/${ISR.month}/${ISR.zone}/zip`);

  // ------------------------------------------------------------- médias
  let mediaPoi = '';
  const mediaKinds = { image: 'image/*,.heic,.tif,.tiff', video: 'video/*,.mkv,.ts,.mts' };

  A.openMedia = async function () {
    $('media-subtitle').textContent = `${ISR.year} › ${MONTHS[ISR.month - 1]} — Toutes les zones`;
    $('media-poi-input').value = ''; $('btn-add-poi').disabled = true;
    $('media-create-row').hidden = !ISR.can.write();
    mediaPoi = '';
    UI.openModal('modal-media');
    await loadPois();
    await renderMedia();
  };

  async function loadPois(select) {
    let data;
    try { data = await API.get(`/api/pois/${ISR.year}/${ISR.month}`); } catch (e) { return errToast(e); }
    const sel = $('media-poi-select');
    sel.innerHTML = '<option value="">-- Tous les POI --</option>' + data.pois.map((p) => `<option value="${p.id}">${esc(p.name)} (${p.medias})</option>`).join('');
    if (select) mediaPoi = String(select);
    sel.value = data.pois.some((p) => String(p.id) === mediaPoi) ? mediaPoi : '';
    mediaPoi = sel.value;
    updateMediaButtons();
  }
  function updateMediaButtons() {
    const w = ISR.can.write();
    $('btn-upload-img').disabled = !(w && mediaPoi); $('btn-upload-vid').disabled = !(w && mediaPoi);
    $('btn-upload-img').hidden = !w; $('btn-upload-vid').hidden = !w;
  }

  A.createPoi = async function () {
    const name = $('media-poi-input').value.trim();
    if (!name) return;
    try {
      const r = await API.post('/api/pois', { year: ISR.year, month: ISR.month, name });
      $('media-poi-input').value = ''; $('btn-add-poi').disabled = true;
      await loadPois(r.poi.id); await renderMedia();
      if (!r.existed) UI.toast(`POI « ${r.poi.name} » créé.`, 'ok');
    } catch (e) { errToast(e); }
  };

  async function renderMedia() {
    const body = $('media-body');
    let data, pois;
    try {
      [data, pois] = await Promise.all([API.get(`/api/medias/${ISR.year}/${ISR.month}${mediaPoi ? '?poi=' + mediaPoi : ''}`), API.get(`/api/pois/${ISR.year}/${ISR.month}`)]);
    } catch (e) { return errToast(e); }
    $('btn-zip-media').disabled = pois.pois.every((p) => p.medias === 0);
    const names = Object.fromEntries(pois.pois.map((p) => [p.id, p.name]));
    if (!data.medias.length) { body.innerHTML = `<div class="media-empty">${mediaPoi ? 'Aucun média pour ce POI.' : 'Aucun média. Créez un POI puis déposez des images ou vidéos.'}</div>`; return; }
    const by = {};
    data.medias.forEach((m) => { (by[m.poiId] = by[m.poiId] || []).push(m); });
    body.innerHTML = Object.keys(by).sort((a, b) => (names[a] || '').localeCompare(names[b] || '')).map((pid) => {
      const items = by[pid];
      const cards = items.map((m) => {
        const canDel = ISR.user.role === 'admin' || (ISR.user.role === 'operateur' && m.uploadedById === ISR.user.id);
        const thumb = m.kind === 'image' ? `<img class="media-card-thumb" loading="lazy" src="/api/media-file/${m.id}" alt="${esc(m.name)}">` : '<div class="media-card-video-thumb">&#127909;</div>';
        return `<div class="media-card" data-act="viewMedia" data-id="${m.id}" data-kind="${m.kind}" data-name="${esc(m.name)}" data-poi="${esc(names[pid])}">${thumb}
          <div class="media-card-info"><div class="media-card-name" title="${esc(m.name)}">${esc(m.name)}</div><div class="media-card-size">${UI.fmtSize(m.size)}</div></div>
          ${canDel ? `<button class="media-card-del" data-act="delMedia" data-id="${m.id}" data-name="${esc(m.name)}" title="Supprimer" aria-label="Supprimer">&#10005;</button>` : ''}</div>`;
      }).join('');
      return `<div class="media-poi-section"><div class="media-poi-title">&#128205;&nbsp;${esc(names[pid])} <span class="media-poi-count">${items.length} média(s)</span></div><div class="media-grid">${cards}</div></div>`;
    }).join('');
  }

  A.pickMedia = (t) => {
    const inp = $('media-file-input'); inp.value = ''; inp.accept = mediaKinds[t.dataset.kind]; inp.dataset.kind = t.dataset.kind; inp.click();
  };
  A.delMedia = async (t, e) => {
    e.stopPropagation();
    if (!(await UI.confirmBox(`Supprimer définitivement « ${t.dataset.name} » ?`, { okLabel: 'SUPPRIMER' }))) return;
    try { await API.del(`/api/medias/${t.dataset.id}`); await loadPois(mediaPoi); await renderMedia(); } catch (er) { errToast(er); }
  };
  A.zipMedia = () => API.download(`/api/media-zip/${ISR.year}/${ISR.month}`);
  A.viewMedia = (t) => {
    const url = `/api/media-file/${t.dataset.id}`;
    const media = t.dataset.kind === 'image' ? `<img src="${url}" alt="">` : `<video src="${url}" controls autoplay></video>`;
    UI.dynModal('modal-view-media', `<div class="viewer">${media}<div class="viewer-bar"><span>${esc(t.dataset.name)} — ${esc(t.dataset.poi)}</span>
      <a class="fbtn fbtn-x" href="${url}?download=1">&#11015; TÉLÉCHARGER</a><button class="fbtn fbtn-x" data-close="modal-view-media">&#10005; FERMER</button></div></div>`,
      { onClose: () => { const v = $('modal-view-media'); if (v) v.innerHTML = ''; } });
  };

  A.openFichesMois = () => ISR.openFichesList && ISR.openFichesList();

  // ------------------------------------------------------------- initialisation des champs
  window.addEventListener('DOMContentLoaded', () => {
    $('zone-file-input').addEventListener('change', (e) => uploadDocs(e.target.files));
    $('media-poi-input').addEventListener('input', (e) => { $('btn-add-poi').disabled = !e.target.value.trim(); });
    $('media-poi-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') A.createPoi(); });
    $('media-poi-select').addEventListener('change', async (e) => { mediaPoi = e.target.value; updateMediaButtons(); await renderMedia(); });
    $('media-file-input').addEventListener('change', async (e) => {
      const files = Array.from(e.target.files), kind = e.target.dataset.kind;
      if (!files.length || !mediaPoi) return;
      try {
        const res = await API.uploadFiles(`/api/pois/${mediaPoi}/medias?kind=${kind}`, files, (p) => showProgress('media-progress', 'media-upload-status', p, 'Envoi'));
        endProgress('media-progress', 'media-upload-status', res, 'média(s)');
        await loadPois(mediaPoi); await renderMedia(); refreshZones();
      } catch (er) { errToast(er); $('media-progress').classList.remove('on'); }
    });
    // Glisser-déposer sur le dossier de zone
    const zb = $('zone-files');
    ['dragenter', 'dragover'].forEach((ev) => zb.addEventListener(ev, (e) => { if (ISR.can.write()) { e.preventDefault(); zb.classList.add('drop'); } }));
    ['dragleave', 'drop'].forEach((ev) => zb.addEventListener(ev, () => zb.classList.remove('drop')));
    zb.addEventListener('drop', (e) => { e.preventDefault(); if (e.dataTransfer && e.dataTransfer.files.length) uploadDocs(e.dataTransfer.files); });
  });

  ISR.refreshZones = refreshZones;
  ISR.ZONES = ZONES;
})();
