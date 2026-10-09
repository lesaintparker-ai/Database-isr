'use strict';
const express = require('express');
const fs = require('fs');
const path = require('path');
const { ah } = require('../util');
const { HttpError } = require('../storage');

module.exports = function adminRoutes({ db, config, auth, audit, storage }) {
  const r = express.Router();

  // Historique des connexions : visible par tous les utilisateurs connectés.
  r.get('/history', (req, res) => {
    const rows = db.prepare(`SELECT h.id, h.at, h.username, u.id AS uid, u.nom, u.prenom, u.grade, u.photo_file IS NOT NULL AS has_photo,
        EXISTS (SELECT 1 FROM sessions s WHERE s.user_id = u.id AND s.expires_at > ?) AS online
      FROM login_history h JOIN users u ON u.id = h.user_id WHERE h.ok = 1 ORDER BY h.id DESC LIMIT 200`).all(new Date().toISOString());
    // « En ligne » uniquement sur la connexion la plus récente de chaque utilisateur.
    const seen = new Set();
    res.json({ sessions: rows.map((x) => {
      const first = !seen.has(x.uid); seen.add(x.uid);
      return { at: x.at, username: x.username, userId: x.uid, nom: x.nom, prenom: x.prenom, grade: x.grade, hasPhoto: !!x.has_photo, online: first && !!x.online };
    }) });
  });

  const admin = auth.requireRole('admin');

  r.get('/admin/audit', admin, (req, res) => {
    const limit = Math.min(Number(req.query.limit) || 100, 500);
    const offset = Math.max(Number(req.query.offset) || 0, 0);
    const q = req.query.q ? `%${String(req.query.q).slice(0, 80)}%` : null;
    const where = q ? 'WHERE username LIKE ? OR action LIKE ? OR detail LIKE ?' : '';
    const args = q ? [q, q, q] : [];
    const rows = db.prepare(`SELECT * FROM audit ${where} ORDER BY id DESC LIMIT ? OFFSET ?`).all(...args, limit, offset);
    const total = db.prepare(`SELECT COUNT(*) AS n FROM audit ${where}`).get(...args).n;
    res.json({ total, entries: rows });
  });

  r.get('/admin/stats', admin, (req, res) => {
    const n = (t) => db.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(size),0) AS b FROM ${t}`);
    const f = n('files').get(), m = n('medias').get();
    res.json({
      users: db.prepare('SELECT COUNT(*) AS n FROM users WHERE active=1').get().n,
      files: f.n, filesBytes: f.b, medias: m.n, mediasBytes: m.b,
      fiches: db.prepare('SELECT COUNT(*) AS n FROM fiches').get().n,
      diskFreeBytes: storage.freeBytes() === Infinity ? null : storage.freeBytes(),
    });
  });

  // Sauvegarde à chaud de la base (le dossier data/storage est à copier séparément).
  r.post('/admin/backup', admin, ah(async (req, res) => {
    const d = new Date(); const p = (x) => String(x).padStart(2, '0');
    const name = `isr-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}.sqlite`;
    await db.backup(path.join(storage.backups, name));
    audit(req, 'sauvegarde_base', name);
    res.status(201).json({ name });
  }));

  r.get('/admin/backups', admin, (req, res) => {
    const list = fs.readdirSync(storage.backups).filter((f) => f.endsWith('.sqlite')).sort().reverse()
      .map((f) => ({ name: f, size: fs.statSync(path.join(storage.backups, f)).size }));
    res.json({ backups: list });
  });

  r.get('/admin/backups/:name', admin, (req, res) => {
    if (!/^isr-\d{8}-\d{6}\.sqlite$/.test(req.params.name)) throw new HttpError(400, 'Nom invalide.');
    res.download(path.join(storage.backups, req.params.name));
  });

  return r;
};
