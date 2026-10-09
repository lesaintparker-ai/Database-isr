'use strict';
const express = require('express');
const { ah, parseYear, parseMonth, parseZone, parseId, monthName, todayFr } = require('../util');
const { HttpError, extOf } = require('../storage');
const { ZONES, DOC_TYPES } = require('../constants');

module.exports = function filesRoutes({ db, config, auth, audit, storage }) {
  const r = express.Router();
  const canWrite = auth.requireRole('admin', 'operateur');
  const fileJson = (f) => ({
    id: f.id, folder: f.folder, type: f.type, name: f.name, size: f.size, uploadedAt: f.uploaded_at, uploadedBy: f.by_name || null, uploadedById: f.uploaded_by,
  });

  // Compteurs par zone pour un mois.
  r.get('/zones/:year/:month', (req, res) => {
    const y = parseYear(req.params.year, config), m = parseMonth(req.params.month);
    const rows = db.prepare('SELECT zone, COUNT(*) AS n, COALESCE(SUM(size),0) AS bytes FROM files WHERE year=? AND month=? GROUP BY zone').all(y, m);
    res.json({ zones: ZONES.map((z) => ({ ...z, count: (rows.find((x) => x.zone === z.id) || {}).n || 0, bytes: (rows.find((x) => x.zone === z.id) || {}).bytes || 0 })) });
  });

  // Résumé annuel : fichiers / médias / fiches par mois.
  r.get('/summary/:year', (req, res) => {
    const y = parseYear(req.params.year, config);
    const months = Array.from({ length: 12 }, (_, i) => ({ month: i + 1, files: 0, medias: 0, fiches: 0 }));
    for (const [tbl, key] of [['files', 'files'], ['medias', 'medias'], ['fiches', 'fiches']]) {
      for (const row of db.prepare(`SELECT month, COUNT(*) AS n FROM ${tbl} WHERE year=? GROUP BY month`).all(y)) months[row.month - 1][key] = row.n;
    }
    res.json({ months });
  });

  r.get('/files/:year/:month/:zone', (req, res) => {
    const y = parseYear(req.params.year, config), m = parseMonth(req.params.month), z = parseZone(req.params.zone);
    const rows = db.prepare(`SELECT f.*, (u.grade || ' ' || upper(u.nom) || ' ' || u.prenom) AS by_name FROM files f
      LEFT JOIN users u ON u.id = f.uploaded_by WHERE f.year=? AND f.month=? AND f.zone=? ORDER BY f.folder DESC, f.type, f.name`).all(y, m, z);
    res.json({ files: rows.map(fileJson) });
  });

  r.post('/files/:year/:month/:zone', canWrite, ah(async (req, res) => {
    const y = parseYear(req.params.year, config), m = parseMonth(req.params.month), z = parseZone(req.params.zone);
    const folder = `Rapport_mission_isr_${todayFr()}`;
    const { files, discard } = await storage.receive(req, {
      subdir: `docs/${y}/${String(m).padStart(2, '0')}/${z}`,
      accept: (name) => (DOC_TYPES[extOf(name)] ? { type: DOC_TYPES[extOf(name)] } : null),
    });
    try {
      const ins = db.prepare('INSERT INTO files (year,month,zone,folder,type,name,size,stored_path,uploaded_by) VALUES (?,?,?,?,?,?,?,?,?)');
      const ids = db.transaction(() => files.map((f) => ins.run(y, m, z, folder, f.meta.type, f.name, f.size, f.relPath, req.user.id).lastInsertRowid))();
      audit(req, 'fichiers_depose', `${files.length} fichier(s) ${y}/${monthName(m)}/${z} : ${files.map((f) => f.name).join(', ').slice(0, 300)}`);
      res.status(201).json({ ids });
    } catch (e) { discard(); throw e; }
  }));

  const getFile = (id) => {
    const f = db.prepare('SELECT * FROM files WHERE id = ?').get(parseId(id));
    if (!f) throw new HttpError(404, 'Fichier introuvable.');
    return f;
  };

  r.get('/files/:id/download', (req, res, next) => {
    const f = getFile(req.params.id);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.download(storage.abs(f.stored_path), f.name, (err) => { if (err && !res.headersSent) next(new HttpError(404, 'Fichier absent du disque.')); });
  });

  r.delete('/files/:id', canWrite, (req, res) => {
    const f = getFile(req.params.id);
    if (req.user.role !== 'admin' && f.uploaded_by !== req.user.id) throw new HttpError(403, 'Seul l\'auteur ou un administrateur peut supprimer ce fichier.');
    db.prepare('DELETE FROM files WHERE id = ?').run(f.id);
    storage.remove(f.stored_path);
    audit(req, 'fichier_supprime', `${f.name} (${f.year}/${monthName(f.month)}/${f.zone})`);
    res.json({ ok: true });
  });

  // ZIP de zone : ISR_DATABASE_AAAA/MOIS/ZONE_X_Region/<dossier>/<type>/<fichier>
  r.get('/files/:year/:month/:zone/zip', (req, res) => {
    const y = parseYear(req.params.year, config), m = parseMonth(req.params.month), z = parseZone(req.params.zone);
    const zone = ZONES.find((x) => x.id === z);
    const rows = db.prepare('SELECT * FROM files WHERE year=? AND month=? AND zone=? ORDER BY folder, type, name').all(y, m, z);
    if (!rows.length) throw new HttpError(404, 'Aucun fichier dans cette zone.');
    const base = `ISR_DATABASE/ISR_DATABASE_${y}/${monthName(m)}/ZONE_${z}_${zone.region.replace(/ /g, '_')}`;
    audit(req, 'zip_zone', `${y}/${monthName(m)}/${z} (${rows.length} fichiers)`);
    storage.zipTo(res, `ISR_DATABASE_${y}_${monthName(m)}_ZONE${z}_${todayFr()}.zip`,
      rows.map((f) => ({ relPath: f.stored_path, zipPath: `${base}/${f.folder}/${f.type}/${f.name}` })),
      { store: true }); // PPTX/DOCX/PDF sont déjà compressés : inutile de les recompresser
  });

  return r;
};
