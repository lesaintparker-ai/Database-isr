'use strict';
const express = require('express');
const { ah, parseYear, parseMonth, parseId, str, monthName, todayFr } = require('../util');
const { HttpError, extOf } = require('../storage');
const { IMAGE_EXT, VIDEO_EXT, MIME_BY_EXT } = require('../constants');

module.exports = function mediasRoutes({ db, config, auth, audit, storage }) {
  const r = express.Router();
  const canWrite = auth.requireRole('admin', 'operateur');
  const mediaJson = (m) => ({ id: m.id, poiId: m.poi_id, kind: m.kind, name: m.name, mime: m.mime, size: m.size, uploadedAt: m.uploaded_at, uploadedById: m.uploaded_by });

  r.get('/pois/:year/:month', (req, res) => {
    const y = parseYear(req.params.year, config), m = parseMonth(req.params.month);
    const rows = db.prepare(`SELECT p.id, p.name, COUNT(md.id) AS medias, COALESCE(SUM(md.size),0) AS bytes
      FROM pois p LEFT JOIN medias md ON md.poi_id = p.id WHERE p.year=? AND p.month=? GROUP BY p.id ORDER BY p.name`).all(y, m);
    res.json({ pois: rows });
  });

  r.post('/pois', canWrite, (req, res) => {
    const b = req.body || {};
    const y = parseYear(b.year, config), m = parseMonth(b.month);
    const name = str(b.name, 'Nom du POI', { max: 80 }).toUpperCase();
    const existing = db.prepare('SELECT id, name FROM pois WHERE year=? AND month=? AND name=?').get(y, m, name);
    if (existing) return res.json({ poi: existing, existed: true });
    const info = db.prepare('INSERT INTO pois (year,month,name,created_by) VALUES (?,?,?,?)').run(y, m, name, req.user.id);
    audit(req, 'poi_cree', `${name} (${y}/${monthName(m)})`);
    res.status(201).json({ poi: { id: info.lastInsertRowid, name } });
  });

  r.delete('/pois/:id', auth.requireRole('admin'), (req, res) => {
    const p = db.prepare('SELECT * FROM pois WHERE id = ?').get(parseId(req.params.id));
    if (!p) throw new HttpError(404, 'POI introuvable.');
    for (const md of db.prepare('SELECT stored_path FROM medias WHERE poi_id = ?').all(p.id)) storage.remove(md.stored_path);
    db.prepare('DELETE FROM pois WHERE id = ?').run(p.id); // médias supprimés en cascade
    audit(req, 'poi_supprime', `${p.name} (${p.year}/${monthName(p.month)})`);
    res.json({ ok: true });
  });

  r.get('/medias/:year/:month', (req, res) => {
    const y = parseYear(req.params.year, config), m = parseMonth(req.params.month);
    const poi = req.query.poi ? parseId(req.query.poi) : null;
    const rows = db.prepare(`SELECT * FROM medias WHERE year=? AND month=? ${poi ? 'AND poi_id=?' : ''} ORDER BY uploaded_at DESC, id DESC`)
      .all(...(poi ? [y, m, poi] : [y, m]));
    res.json({ medias: rows.map(mediaJson) });
  });

  r.post('/pois/:id/medias', canWrite, ah(async (req, res) => {
    const poi = db.prepare('SELECT * FROM pois WHERE id = ?').get(parseId(req.params.id));
    if (!poi) throw new HttpError(404, 'POI introuvable.');
    const kind = req.query.kind;
    if (kind !== 'image' && kind !== 'video') throw new HttpError(400, 'Type de média invalide.');
    const allowed = kind === 'image' ? IMAGE_EXT : VIDEO_EXT;
    const { files, discard } = await storage.receive(req, {
      subdir: `medias/${poi.year}/${String(poi.month).padStart(2, '0')}/${poi.id}`,
      accept: (name) => (allowed.includes(extOf(name)) ? { mime: MIME_BY_EXT[extOf(name)] } : null),
    });
    try {
      const ins = db.prepare('INSERT INTO medias (poi_id,year,month,kind,name,mime,size,stored_path,uploaded_by) VALUES (?,?,?,?,?,?,?,?,?)');
      const ids = db.transaction(() => files.map((f) => ins.run(poi.id, poi.year, poi.month, kind, f.name, f.meta.mime, f.size, f.relPath, req.user.id).lastInsertRowid))();
      audit(req, 'medias_depose', `${files.length} ${kind}(s) POI ${poi.name} ${poi.year}/${monthName(poi.month)}`);
      res.status(201).json({ ids });
    } catch (e) { discard(); throw e; }
  }));

  const getMedia = (id) => {
    const md = db.prepare('SELECT * FROM medias WHERE id = ?').get(parseId(id));
    if (!md) throw new HttpError(404, 'Média introuvable.');
    return md;
  };

  // Lecture en flux avec support des requêtes Range (lecture vidéo, reprise).
  r.get('/media-file/:id', (req, res) => {
    const md = getMedia(req.params.id);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "sandbox; default-src 'none'");
    res.type(md.mime);
    if (req.query.download === '1') return res.download(storage.abs(md.stored_path), md.name);
    res.sendFile(storage.abs(md.stored_path), { headers: { 'Content-Type': md.mime, 'Cache-Control': 'private, max-age=3600' } });
  });

  r.delete('/medias/:id', canWrite, (req, res) => {
    const md = getMedia(req.params.id);
    if (req.user.role !== 'admin' && md.uploaded_by !== req.user.id) throw new HttpError(403, 'Seul l\'auteur ou un administrateur peut supprimer ce média.');
    db.prepare('DELETE FROM medias WHERE id = ?').run(md.id);
    storage.remove(md.stored_path);
    audit(req, 'media_supprime', `${md.name} (${md.year}/${monthName(md.month)})`);
    res.json({ ok: true });
  });

  // ZIP des médias du mois : ISR_DATABASE_AAAA/MOIS/{Images|Videos}/<POI>/<fichier>
  r.get('/media-zip/:year/:month', (req, res) => {
    const y = parseYear(req.params.year, config), m = parseMonth(req.params.month);
    const rows = db.prepare('SELECT md.*, p.name AS poi FROM medias md JOIN pois p ON p.id = md.poi_id WHERE md.year=? AND md.month=? ORDER BY p.name, md.name').all(y, m);
    if (!rows.length) throw new HttpError(404, 'Aucun média ce mois-ci.');
    audit(req, 'zip_medias', `${y}/${monthName(m)} (${rows.length} médias)`);
    storage.zipTo(res, `ISR_MEDIAS_${y}_${monthName(m)}_${todayFr()}.zip`,
      rows.map((md) => ({ relPath: md.stored_path, zipPath: `ISR_DATABASE_${y}/${monthName(m)}/${md.kind === 'image' ? 'Images' : 'Videos'}/${md.poi.replace(/[\\/:*?"<>|]/g, '_')}/${md.name}` })),
      { store: true });
  });

  return r;
};
