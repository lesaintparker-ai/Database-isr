'use strict';
/* Impression des fiches : document HTML autonome (valeurs échappées) ouvert dans un onglet puis imprimé. */
(function () {
  const { esc, fmtYmd } = UI;

  const BASE_CSS = `
    *{margin:0;padding:0;box-sizing:border-box;}
    @font-face{font-family:"Rajdhani";font-weight:700;src:url(/fonts/rajdhani-latin-700.woff2) format("woff2");}
    @font-face{font-family:"Exo 2";font-weight:400;src:url(/fonts/exo-2-latin-400.woff2) format("woff2");}
    @font-face{font-family:"Exo 2";font-weight:600;src:url(/fonts/exo-2-latin-600.woff2) format("woff2");}
    @font-face{font-family:"Share Tech Mono";src:url(/fonts/share-tech-mono-latin-400.woff2) format("woff2");}
    body{font-family:"Exo 2",sans-serif;color:#1a1a2e;-webkit-print-color-adjust:exact;print-color-adjust:exact;}
    @page{size:A4;margin:0;}`;

  function openPrint(title, css, body) {
    const w = window.open('', '_blank');
    if (!w) { UI.toast('Le navigateur a bloqué la fenêtre d\'impression : autorisez les pop-ups pour ce site.', 'error', 8000); return; }
    w.document.open();
    w.document.write(`<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><title>${esc(title)}</title><style>${BASE_CSS}${css}</style></head><body>${body}</body></html>`);
    w.document.close();
    // Laisse le temps aux images et polices locales de se charger avant d'imprimer.
    const go = () => { try { w.focus(); w.print(); } catch { /* fenêtre fermée */ } };
    if (w.document.fonts && w.document.fonts.ready) w.document.fonts.ready.then(() => setTimeout(go, 300));
    else setTimeout(go, 800);
  }

  function printEtat(d) {
    const row = (lbl, val) => `<div style="display:flex;flex-direction:column;gap:3px"><span style="font-size:8px;font-weight:700;color:#C8A84B;letter-spacing:2px;font-family:Rajdhani,sans-serif">${lbl}</span><div style="border-bottom:1px solid #ccc;padding:5px 3px;font-size:12px;font-weight:600;min-height:22px">${esc(val) || '&mdash;'}</div></div>`;
    const g = (n, ...c) => `<div style="display:grid;grid-template-columns:repeat(${n},1fr);gap:10px;margin-bottom:10px">${c.join('')}</div>`;
    const sec = (t, c) => `<div style="margin-bottom:14px"><div style="font-family:Rajdhani,sans-serif;font-size:11px;font-weight:700;background:#0D1B2A;color:#C8A84B;padding:4px 12px;margin-bottom:10px;letter-spacing:3px">${t}</div>${c}</div>`;
    const body = `<div style="padding:14mm 12mm">
      <div style="display:flex;align-items:center;justify-content:space-between;border-bottom:3px solid #0D1B2A;padding-bottom:10px;margin-bottom:12px">
        <img src="/assets/logo.png" style="width:60px">
        <div style="text-align:center"><div style="font-family:Rajdhani,sans-serif;font-size:19px;font-weight:700;color:#0D1B2A;letter-spacing:4px">FICHE D'ETAT DE MISSION</div>
        <div style="font-size:8px;color:#666;letter-spacing:2px;margin-top:2px">ARMEE DE L'AIR &mdash; COTE D'IVOIRE</div>
        <div style="font-size:9px;color:#888;font-family:'Share Tech Mono',monospace;margin-top:2px">Date de mission : ${esc(fmtYmd(d.date))}</div></div>
        <img src="/assets/isr.png" style="width:48px"></div>
      <div style="background:#C8A84B;padding:4px 12px;margin-bottom:12px;font-family:Rajdhani,sans-serif;font-size:11px;font-weight:700;color:#0D1B2A;letter-spacing:4px">MISSION ISR &mdash; BEECHCRAFT KING AIR 360ER</div>
      ${sec('AERONEF', g(2, row('AVION', 'King Air 360ER'), row('CODE IDENTIFICATION', d.codeid)))}
      ${sec('EQUIPAGE', g(2, row('PILOTE (CDB)', d.cdb), row('CO-PILOTE', d.cop)) + g(2, row('OPERATEUR 1', d.op1), row('OPERATEUR 2', d.op2)) + g(3, row('OPERATEUR 3', d.op3), row('MECANICIEN', d.meca), row('OBSERVATEUR', d.obs)))}
      ${sec('TEMPS DE VOL', g(3, row('HEURE DECOLLAGE', d.hdec), row('HEURE ATTERRISSAGE', d.hatt), `<div style="display:flex;flex-direction:column;gap:3px"><span style="font-size:8px;font-weight:700;color:#C8A84B;letter-spacing:2px;font-family:Rajdhani,sans-serif">TOTAL</span><div style="border-bottom:1px solid #C8A84B;padding:5px 3px;font-family:Rajdhani,sans-serif;font-size:16px;font-weight:700;color:#C8A84B">${esc(d.tot)}</div></div>`))}
      ${sec('OBJECTIF DE LA MISSION', `<div style="border:1px solid #ccc;border-radius:3px;padding:10px;font-size:12px;min-height:70px;line-height:1.6;white-space:pre-wrap">${esc(d.obj)}</div>`)}
      <div style="border-top:2px solid #0D1B2A;padding-top:6px;margin-top:14px;display:flex;justify-content:space-between;font-size:9px;color:#888;font-family:'Share Tech Mono',monospace"><span>ISR DATABASE v3.0</span><span>Armee de l'Air &mdash; Cote d'Ivoire</span><span>${esc(new Date().toLocaleDateString('fr-FR'))}</span></div>
    </div>`;
    openPrint('Etat Mission ISR', '', body);
  }

  const dms = (c) => `${esc(c.dir)} ${esc(c.d)}&deg;${esc(c.m)}'${esc(c.s)}"`;

  function printMission(d) {
    const hdr = (t, x) => `<div style="border:1px solid #C0CCE0;border-radius:4px;overflow:hidden"><div style="background:#1A4A92;padding:4px 10px;font-family:Rajdhani,sans-serif;font-size:9px;font-weight:700;color:#fff;letter-spacing:2px">${t}</div>${x}</div>`;
    const rows = d.pois.map((p, i) => `<tr style="background:${i % 2 ? '#F8FAFD' : '#EEF4FB'}">
      <td style="padding:7px 10px;font-family:Rajdhani,sans-serif;font-size:13px;font-weight:700;color:#1A4A92;border-bottom:1px solid #D0DCF0;border-right:1px solid #D0DCF0;width:35px;text-align:center">${i + 1}</td>
      <td style="padding:7px 10px;font-size:12px;font-weight:700;color:#0D2550;border-bottom:1px solid #D0DCF0;border-right:1px solid #D0DCF0;width:180px">${esc(p.nom)}</td>
      <td style="padding:7px 8px;font-family:monospace;font-size:11px;color:#1A3A7A;border-bottom:1px solid #D0DCF0;border-right:1px solid #D0DCF0;width:150px;white-space:nowrap">${dms(p.lat)}<br>${dms(p.lon)}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #D0DCF0;vertical-align:top">${'<div style="border-bottom:1px solid #bbb;height:18px;margin-bottom:3px"></div>'.repeat(6)}</td></tr>`).join('');
    const body = `<div style="position:fixed;inset:0;display:flex;align-items:center;justify-content:center;pointer-events:none;z-index:0"><img src="/assets/avion.png" style="width:85%;opacity:.12"></div>
      <div style="position:relative;z-index:1;padding:12mm 13mm">
      <div style="display:flex;align-items:center;gap:14px;border-bottom:4px solid #1A4A92;padding-bottom:11px;margin-bottom:12px"><img src="/assets/logo.png" style="width:58px">
        <div style="flex:1;text-align:center"><div style="font-family:Rajdhani,sans-serif;font-size:20px;font-weight:700;color:#0D2550;letter-spacing:5px">FICHE MISSION ISR</div>
        <div style="font-size:8px;color:#4A6A9A;letter-spacing:3px;margin-top:2px">ARMEE DE L'AIR &mdash; COTE D'IVOIRE &nbsp;&middot;&nbsp; Beechcraft King Air 360ER</div></div><img src="/assets/isr.png" style="width:48px"></div>
      <div style="background:linear-gradient(90deg,#0D2550,#1A4A92,#0D2550);padding:6px 14px;margin-bottom:12px;border-radius:3px;text-align:center;font-family:Rajdhani,sans-serif;font-size:11px;font-weight:700;color:#fff;letter-spacing:5px">COMPTE RENDU DE MISSION ISR</div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:10px;margin-bottom:13px">
        ${hdr('DATE', `<div style="padding:7px 10px;font-size:12px;font-weight:600;font-family:'Share Tech Mono',monospace">${esc(fmtYmd(d.date))}</div>`)}
        ${hdr('MISSION', `<div style="padding:7px 10px;font-size:12px;font-weight:600;font-family:'Share Tech Mono',monospace">${esc(d.miss)}</div>`)}
        ${hdr('H. DÉCOLLAGE', '<div style="padding:4px 10px 8px;border-bottom:1.5px solid #1A4A92;min-height:30px"></div>')}
        ${hdr('H. ATTERRISSAGE', '<div style="padding:4px 10px 8px;border-bottom:1.5px solid #1A4A92;min-height:30px"></div>')}</div>
      <div style="font-family:Rajdhani,sans-serif;font-size:11px;font-weight:700;color:#0D2550;letter-spacing:4px;margin-bottom:8px;padding-bottom:5px;border-bottom:2px solid #1A4A92">POINTS D'INTERET &mdash; ${d.pois.length} POI</div>
      <table style="width:100%;border-collapse:collapse;border:2px solid #1A4A92"><thead><tr style="background:#1A4A92">
        ${['#', 'NOM DU POI', 'COORDONNÉES (DMS)', 'OBSERVATIONS'].map((h) => `<th style="padding:9px 10px;font-family:Rajdhani,sans-serif;font-size:11px;font-weight:700;color:#fff;letter-spacing:2px;text-align:left">${h}</th>`).join('')}
      </tr></thead><tbody>${rows}</tbody></table>
      <div style="margin-top:14px;border-top:2px solid #1A4A92;padding-top:7px;display:flex;justify-content:space-between;font-size:9px;color:#8A9BB0;font-family:'Share Tech Mono',monospace"><span>ISR DATABASE v3.0 &mdash; Usage Officiel</span><span>ARMEE DE L'AIR &mdash; CÔTE D'IVOIRE</span><span>${esc(new Date().toLocaleDateString('fr-FR'))}</span></div></div>`;
    openPrint('Fiche Mission ISR', 'thead{display:table-header-group}tr{page-break-inside:avoid}', body);
  }

  window.Print = { etat: printEtat, mission: printMission };
})();
