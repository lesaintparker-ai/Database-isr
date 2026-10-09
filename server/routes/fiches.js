'use strict';
const express = require('express');
const { ah, parseYear, parseMonth, parseId, str, monthName, pad } = require('../util');
const { HttpError } = require('../storage');

const CODES_AVION = ['TU-VMD', 'TU-VMF'];

function num(v, label, min, max) {
  if (v === '' || v === null || v === undefined) throw new HttpError(400, `${label} : valeur requise.`);
  const n = Number(v);
  if (!Number.isFinite(n) || n < min || n > max) throw new HttpError(400, `${label} : doit être entre ${min} et ${max}.`);
  return n;
}

function coord(c, label, dirs, maxDeg) {
  if (!dirs.includes(c.dir)) throw new HttpError(400, `${label} : direction invalide.`);
  const d = num(c.d, `${label} degrés`, 0, maxDeg);
  const mi = num(c.m, `${label} minutes`, 0, 59);
  const s = num(c.s, `${label} secondes`, 0, 59.99);
  if (d === maxDeg && (mi > 0 || s > 0)) throw new HttpError(400, `${label} : dépasse ${maxDeg}°.`);
  const dec = d + mi / 60 + s / 3600;
  return { dir: c.dir, d, m: mi, s, decimal: Number(((dirs[0] === c.dir ? 1 : -1) * dec).toFixed(6)) };
}

function validDate(v, label) {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(v))) throw new HttpError(400, `${label} : date invalide.`);
  return v;
}

function validTime(v, label) {
  if (typeof v !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(v)) throw new HttpError(400, `${label} : heure invalide (HH:MM).`);
  return v;
}

function validateMission(p) {
  const date = validDate(p.date, 'Date de mission');
  const miss = str(p.miss, 'Désignation', { max: 200 });
  if (!Array.isArray(p.pois) || !p.pois.length) throw new HttpError(400, 'Au moins un POI est requis.');
  if (p.pois.length > 100) throw new HttpError(400, 'Trop de POI (max 100).');
  const pois = p.pois.map((x, i) => ({
    nom: str(x && x.nom, `POI ${i + 1} nom`, { max: 100 }),
    lat: coord((x && x.lat) || {}, `POI ${i + 1} latitude`, ['N', 'S'], 90),
    lon: coord((x && x.lon) || {}, `POI ${i + 1} longitude`, ['E', 'W'], 180),
  }));
  return { date, payload: { date, miss, pois }, title: miss };
}

function validateEtat(p) {
  const date = validDate(p.date, 'Date de mission');
  if (!CODES_AVION.includes(p.codeid)) throw new HttpError(400, 'Code d\'identification invalide.');
  const payload = {
    date, codeid: p.codeid,
    cdb: str(p.cdb, 'Pilote', { max: 120 }), cop: str(p.cop, 'Co-pilote', { max: 120 }),
    op1: str(p.op1, 'Opérateur 1', { max: 120 }), op2: str(p.op2, 'Opérateur 2', { max: 120 }),
    op3: str(p.op3, 'Opérateur 3', { max: 120, optional: true }),
    meca: str(p.meca, 'Mécanicien', { max: 120 }), obs: str(p.obs, 'Observateur', { max: 120, optional: true }),
    hdec: validTime(p.hdec, 'Heure de décollage'), hatt: validTime(p.hatt, 'Heure d\'atterrissage'),
    obj: str(p.obj, 'Objectif', { max: 4000 }),
  };
  const [h1, m1] = payload.hdec.split(':').map(Number);
  const [h2, m2] = payload.hatt.split(':').map(Number);
  let min = h2 * 60 + m2 - (h1 * 60 + m1);
  if (min < 0) min += 1440; // passage de minuit
  payload.tot = `${pad(Math.floor(min / 60))}H${pad(min % 60)}`;
  return { date, payload, title: `${payload.codeid} — ${payload.tot}` };
}

module.exports = function fichesRoutes({ db, config, auth, audit }) {
  const r = express.Router();
  const canWrite = auth.requireRole('admin', 'operateur');

  r.post('/fiches', canWrite, ah(async (req, res) => {
    const b = req.body || {};
    if (!b.payload || typeof b.payload !== 'object') throw new HttpError(400, 'Fiche vide.');
    let v;
    if (b.kind === 'mission') v = validateMission(b.payload);
    else if (b.kind === 'etat') v = validateEtat(b.payload);
    else throw new HttpError(400, 'Type de fiche invalide.');
    const [y, m] = v.date.split('-').map(Number);
    parseYear(y, config);
    const info = db.prepare('INSERT INTO fiches (kind,year,month,mission_date,title,payload,created_by) VALUES (?,?,?,?,?,?,?)')
      .run(b.kind, y, m, v.date, v.title, JSON.stringify(v.payload), req.user.id);
    audit(req, 'fiche_creee', `${b.kind} ${v.date} — ${v.title}`);
    res.status(201).json({ id: info.lastInsertRowid, payload: v.payload });
  }));

  r.get('/fiches', (req, res) => {
    const y = parseYear(req.query.year, config), m = parseMonth(req.query.month);
    const kind = req.query.kind;
    const rows = db.prepare(`SELECT f.id, f.kind, f.mission_date, f.title, f.created_at, (u.grade || ' ' || upper(u.nom) || ' ' || u.prenom) AS author
      FROM fiches f LEFT JOIN users u ON u.id = f.created_by WHERE f.year=? AND f.month=? ${kind ? 'AND f.kind=?' : ''}
      ORDER BY f.mission_date DESC, f.id DESC`).all(...(kind ? [y, m, kind] : [y, m]));
    res.json({ fiches: rows.map((f) => ({ id: f.id, kind: f.kind, date: f.mission_date, title: f.title, createdAt: f.created_at, author: f.author })) });
  });

  r.get('/fiches/:id', (req, res) => {
    const f = db.prepare('SELECT * FROM fiches WHERE id = ?').get(parseId(req.params.id));
    if (!f) throw new HttpError(404, 'Fiche introuvable.');
    res.json({ id: f.id, kind: f.kind, createdAt: f.created_at, payload: JSON.parse(f.payload) });
  });

  r.delete('/fiches/:id', auth.requireRole('admin'), (req, res) => {
    const f = db.prepare('SELECT * FROM fiches WHERE id = ?').get(parseId(req.params.id));
    if (!f) throw new HttpError(404, 'Fiche introuvable.');
    db.prepare('DELETE FROM fiches WHERE id = ?').run(f.id);
    audit(req, 'fiche_supprimee', `${f.kind} ${f.mission_date} — ${f.title} (${monthName(f.month)} ${f.year})`);
    res.json({ ok: true });
  });

  return r;
};
