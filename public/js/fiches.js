'use strict';
/* Fiches : état de mission, mission ISR (POI en DMS), liste des fiches enregistrées. */
(function () {
  const { $, esc, MONTHS } = UI;
  const A = ISR.actions;
  const errToast = (e) => UI.toast(e.message, 'error');
  const todayYmd = () => { const d = new Date(), p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; };

  A.openRediger = () => { if (!ISR.can.write()) return UI.toast('Compte en lecture seule : création de fiches non autorisée.', 'error'); UI.openModal('modal-rediger'); };

  // ------------------------------------------------------------- Fiche état de mission
  let etatSaved = null;
  const F_REQ = ['codeid', 'date', 'cdb', 'cop', 'op1', 'op2', 'meca', 'obj', 'hdec', 'hatt'];

  A.openFiche = () => {
    UI.closeModal('modal-rediger');
    const f = $('form-etat'); f.reset(); f.date.value = todayYmd();
    etatSaved = null; $('fiche-ok').classList.remove('show'); $('fiche-error').textContent = '';
    $('f-btn-p').disabled = true; calcVol(); checkEtat();
    UI.openModal('modal-fiche');
  };

  function calcVol() {
    const f = $('form-etat'), dec = f.hdec.value, att = f.hatt.value;
    if (dec && att) {
      const [h1, m1] = dec.split(':').map(Number), [h2, m2] = att.split(':').map(Number);
      let m = h2 * 60 + m2 - (h1 * 60 + m1); if (m < 0) m += 1440;
      $('f-tot').textContent = String(Math.floor(m / 60)).padStart(2, '0') + 'H' + String(m % 60).padStart(2, '0');
    } else $('f-tot').textContent = '—';
  }
  function checkEtat() {
    const f = $('form-etat');
    $('f-btn-s').disabled = !!etatSaved || !F_REQ.every((k) => f[k].value && f[k].value.trim());
  }
  function etatPayload() {
    const f = $('form-etat'); const o = {};
    ['codeid', 'date', 'cdb', 'cop', 'op1', 'op2', 'op3', 'meca', 'obs', 'hdec', 'hatt', 'obj'].forEach((k) => { o[k] = f[k].value.trim(); });
    return o;
  }
  A.saveEtat = async () => {
    $('fiche-error').textContent = '';
    try {
      const r = await API.post('/api/fiches', { kind: 'etat', payload: etatPayload() });
      etatSaved = r.payload;
      $('fiche-ok').textContent = '✔ Fiche enregistrée sur le serveur (n° ' + r.id + ').'; $('fiche-ok').classList.add('show');
      $('f-btn-s').disabled = true; $('f-btn-p').disabled = false;
      ISR.refreshZones && ISR.year && ISR.month && ISR.refreshZones();
    } catch (e) { $('fiche-error').textContent = e.message; }
  };
  A.printEtat = () => etatSaved && Print.etat(etatSaved);

  // ------------------------------------------------------------- Fiche mission ISR (POI)
  let poiCnt = 0, poiSaved = null;

  A.openPoi = () => {
    UI.closeModal('modal-rediger');
    $('p-date').value = todayYmd(); $('p-miss').value = ''; $('poi-list').innerHTML = '';
    poiCnt = 0; poiSaved = null;
    $('poi-ok').classList.remove('show'); $('poi-error').textContent = ''; $('p-btn-p').disabled = true;
    addPoi(); UI.openModal('modal-poi');
  };

  function coordInputs(prefix, n, dirs, maxDeg, ph) {
    return `<div class="dms-grid" style="margin-top:4px">
      <div><select class="pf-dir" data-f="${prefix}dir">${dirs.map((d) => `<option>${d}</option>`).join('')}</select><div class="dms-lbl">DIR</div></div>
      <div><input class="pf-sm" type="number" inputmode="numeric" min="0" max="${maxDeg}" step="1" data-f="${prefix}d" placeholder="${ph[0]}"><div class="dms-lbl">DEG&deg;</div></div>
      <div><input class="pf-sm" type="number" inputmode="numeric" min="0" max="59" step="1" data-f="${prefix}m" placeholder="${ph[1]}"><div class="dms-lbl">MIN&prime;</div></div>
      <div><input class="pf-sm" type="number" inputmode="decimal" min="0" max="59.99" step="0.01" data-f="${prefix}s" placeholder="${ph[2]}"><div class="dms-lbl">SEC&Prime;</div></div></div>`;
  }
  function addPoi() {
    poiCnt++;
    const el = document.createElement('div');
    el.className = 'poi-item';
    el.innerHTML = `<span class="poi-badge"></span><button class="poi-del" data-act="delPoi">&#10005; Supprimer</button>
      <div class="fr1" style="margin-top:10px;margin-bottom:10px"><div class="fg"><span class="pl">NOM DU POI</span><input class="pf" type="text" maxlength="100" data-f="nom" placeholder="Ex: BOUNA AFLD..."></div></div>
      <div class="fr2"><div class="fg"><span class="pl">LATITUDE</span>${coordInputs('lat', 0, ['N', 'S'], 90, ['7', '41', '23.34'])}</div>
      <div class="fg"><span class="pl">LONGITUDE</span>${coordInputs('lon', 0, ['W', 'E'], 180, ['5', '01', '27.61'])}</div></div>`;
    $('poi-list').appendChild(el);
    renumberPois(); checkPoi();
  }
  function renumberPois() {
    document.querySelectorAll('#poi-list .poi-item').forEach((it, i) => { it.querySelector('.poi-badge').textContent = 'POI ' + (i + 1); });
  }
  A.addPoi = addPoi;
  A.delPoi = (t) => {
    const items = document.querySelectorAll('#poi-list .poi-item');
    if (items.length <= 1) return UI.toast('Au moins un POI est requis.', 'error');
    t.closest('.poi-item').remove(); renumberPois(); checkPoi();
  };

  function readPoi(it) {
    const v = (k) => it.querySelector(`[data-f="${k}"]`).value;
    const c = (p) => ({ dir: v(p + 'dir'), d: v(p + 'd'), m: v(p + 'm'), s: v(p + 's') });
    return { nom: v('nom').trim(), lat: c('lat'), lon: c('lon') };
  }
  function poiComplete(p) {
    const c = (x) => x.d !== '' && x.m !== '' && x.s !== '';
    return p.nom && c(p.lat) && c(p.lon);
  }
  function checkPoi() {
    const items = document.querySelectorAll('#poi-list .poi-item');
    const ok = $('p-date').value && $('p-miss').value.trim() && items.length > 0 && Array.from(items).every((it) => poiComplete(readPoi(it)));
    $('p-btn-s').disabled = !ok || !!poiSaved;
  }
  function poiPayload() {
    return { date: $('p-date').value, miss: $('p-miss').value.trim(), pois: Array.from(document.querySelectorAll('#poi-list .poi-item')).map(readPoi) };
  }
  A.savePoi = async () => {
    $('poi-error').textContent = '';
    try {
      const r = await API.post('/api/fiches', { kind: 'mission', payload: poiPayload() });
      poiSaved = r.payload;
      $('poi-ok').textContent = '✔ Fiche mission enregistrée sur le serveur (n° ' + r.id + ').'; $('poi-ok').classList.add('show');
      $('p-btn-s').disabled = true; $('p-btn-p').disabled = false;
      ISR.refreshZones && ISR.year && ISR.month && ISR.refreshZones();
    } catch (e) { $('poi-error').textContent = e.message; }
  };
  A.printPoi = () => poiSaved && Print.mission(poiSaved);

  // ------------------------------------------------------------- Liste des fiches du mois
  ISR.openFichesList = async function () {
    let data;
    try { data = await API.get(`/api/fiches?year=${ISR.year}&month=${ISR.month}`); } catch (e) { return errToast(e); }
    const rows = data.fiches.map((f, i) => `<tr class="${i % 2 ? 'alt' : ''}">
      <td><span class="pill ${f.kind === 'mission' ? 'blue' : 'gold'}">${f.kind === 'mission' ? 'MISSION ISR' : 'ÉTAT MISSION'}</span></td>
      <td class="mono">${esc(UI.fmtYmd(f.date))}</td><td>${esc(f.title)}</td><td class="dim">${esc(f.author || '—')}</td>
      <td class="r"><button class="zf-btn-dl" data-act="printFiche" data-id="${f.id}" data-kind="${f.kind}">&#128424; IMPRIMER</button>
      ${ISR.can.admin() ? `<button class="zf-btn-del" data-act="delFiche" data-id="${f.id}" aria-label="Supprimer">&#10005;</button>` : ''}</td></tr>`).join('')
      || '<tr><td colspan="5" class="empty">Aucune fiche enregistrée ce mois-ci.</td></tr>';
    UI.dynModal('modal-fiches-list', `<div class="dlg dlg-xl">
      <div class="dlg-hdr"><span class="dlg-ico">&#128203;</span><div><div class="dlg-title">FICHES ENREGISTRÉES</div><div class="dlg-sub">${ISR.year} › ${MONTHS[ISR.month - 1]} — ${data.fiches.length} fiche(s)</div></div>
        <button class="cbtn" data-close="modal-fiches-list" aria-label="Fermer">&#10005;</button></div>
      <div class="dlg-body scroll"><table class="tbl"><thead><tr><th>TYPE</th><th>DATE</th><th>INTITULÉ</th><th>AUTEUR</th><th></th></tr></thead><tbody>${rows}</tbody></table></div></div>`);
  };
  A.printFiche = async (t) => {
    try { const f = await API.get(`/api/fiches/${t.dataset.id}`); (f.kind === 'mission' ? Print.mission : Print.etat)(f.payload); } catch (e) { errToast(e); }
  };
  A.delFiche = async (t) => {
    if (!(await UI.confirmBox('Supprimer définitivement cette fiche ?', { okLabel: 'SUPPRIMER' }))) return;
    try { await API.del(`/api/fiches/${t.dataset.id}`); UI.toast('Fiche supprimée.', 'ok'); ISR.openFichesList(); ISR.refreshZones && ISR.refreshZones(); } catch (e) { errToast(e); }
  };

  window.addEventListener('DOMContentLoaded', () => {
    const f = $('form-etat');
    f.addEventListener('input', () => { calcVol(); checkEtat(); });
    f.addEventListener('change', () => { calcVol(); checkEtat(); });
    f.addEventListener('submit', (e) => e.preventDefault());
    const pl = $('modal-poi');
    pl.addEventListener('input', checkPoi); pl.addEventListener('change', checkPoi);
  });
})();
