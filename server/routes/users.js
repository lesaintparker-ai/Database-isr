'use strict';
const express = require('express');
const { hashPassword, generatePassword, checkPasswordPolicy } = require('../auth');
const { ah, parseId, str } = require('../util');
const { HttpError } = require('../storage');
const { ROLES, IMAGE_EXT, MIME_BY_EXT } = require('../constants');
const { publicUser } = require('./auth');
const { extOf } = require('../storage');

module.exports = function usersRoutes({ db, config, auth, audit, storage }) {
  const r = express.Router();
  const adminOnly = [auth.requireRole('admin')];

  const fullUser = (u) => ({ ...publicUser(u), active: !!u.active, createdAt: u.created_at });
  const username = (v) => {
    const s = str(v, 'Identifiant', { min: 3, max: 40 });
    if (!/^[A-Za-z0-9._@-]+$/.test(s)) throw new HttpError(400, 'Identifiant : lettres, chiffres et . _ @ - uniquement.');
    return s;
  };
  const role = (v) => { if (!ROLES.includes(v)) throw new HttpError(400, 'Rôle invalide.'); return v; };

  r.get('/users', ...adminOnly, (req, res) => {
    res.json({ users: db.prepare('SELECT * FROM users ORDER BY nom COLLATE NOCASE, prenom COLLATE NOCASE').all().map(fullUser) });
  });

  r.post('/users', ...adminOnly, ah(async (req, res) => {
    const b = req.body || {};
    const uname = username(b.username);
    if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(uname)) throw new HttpError(409, 'Cet identifiant existe déjà.');
    let pw = b.password;
    let generated = false;
    if (!pw) { pw = generatePassword(); generated = true; }
    else { const p = checkPasswordPolicy(pw, config.minPasswordLength); if (p) throw new HttpError(400, p); }
    const info = db.prepare('INSERT INTO users (username,nom,prenom,grade,role,pw_hash,must_change) VALUES (?,?,?,?,?,?,1)')
      .run(uname, str(b.nom, 'Nom', { max: 80 }), str(b.prenom, 'Prénom', { max: 80 }), str(b.grade, 'Grade', { max: 60 }), role(b.role), await hashPassword(pw));
    audit(req, 'utilisateur_cree', `${uname} (${b.role})`);
    res.status(201).json({ user: fullUser(db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid)), temporaryPassword: generated ? pw : undefined });
  }));

  r.patch('/users/:id', ...adminOnly, ah(async (req, res) => {
    const id = parseId(req.params.id);
    const u = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    if (!u) throw new HttpError(404, 'Utilisateur introuvable.');
    const b = req.body || {};
    const nom = b.nom !== undefined ? str(b.nom, 'Nom', { max: 80 }) : u.nom;
    const prenom = b.prenom !== undefined ? str(b.prenom, 'Prénom', { max: 80 }) : u.prenom;
    const grade = b.grade !== undefined ? str(b.grade, 'Grade', { max: 60 }) : u.grade;
    const newRole = b.role !== undefined ? role(b.role) : u.role;
    const active = b.active !== undefined ? (b.active ? 1 : 0) : u.active;

    const losesAdmin = u.role === 'admin' && u.active && (newRole !== 'admin' || !active);
    if (losesAdmin) {
      const others = db.prepare("SELECT COUNT(*) AS n FROM users WHERE role='admin' AND active=1 AND id != ?").get(id).n;
      if (others === 0) throw new HttpError(400, 'Impossible : il doit rester au moins un administrateur actif.');
    }
    db.prepare('UPDATE users SET nom=?, prenom=?, grade=?, role=?, active=? WHERE id=?').run(nom, prenom, grade, newRole, active, id);
    if (!active || newRole !== u.role) auth.destroyUserSessions(id);

    let temporaryPassword;
    if (b.resetPassword) {
      temporaryPassword = generatePassword();
      db.prepare('UPDATE users SET pw_hash=?, must_change=1 WHERE id=?').run(await hashPassword(temporaryPassword), id);
      auth.destroyUserSessions(id);
    }
    audit(req, 'utilisateur_modifie', `${u.username}${b.resetPassword ? ' (mot de passe réinitialisé)' : ''}${!active ? ' (désactivé)' : ''}`);
    res.json({ user: fullUser(db.prepare('SELECT * FROM users WHERE id = ?').get(id)), temporaryPassword });
  }));

  // ---- Photo de profil (soi-même ou administrateur) ----
  r.post('/users/:id/photo', ah(async (req, res) => {
    const id = parseId(req.params.id);
    if (req.user.id !== id && req.user.role !== 'admin') throw new HttpError(403, 'Droits insuffisants.');
    const u = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    if (!u) throw new HttpError(404, 'Utilisateur introuvable.');
    const { files } = await storage.receive(req, {
      subdir: 'photos', maxFiles: 1, maxBytes: 5 * 1024 * 1024,
      accept: (name) => (IMAGE_EXT.includes(extOf(name)) ? {} : null),
    });
    if (u.photo_file) storage.remove(u.photo_file);
    db.prepare('UPDATE users SET photo_file = ? WHERE id = ?').run(files[0].relPath, id);
    audit(req, 'photo_modifiee', u.username);
    res.json({ ok: true });
  }));

  r.get('/users/:id/photo', (req, res) => {
    const u = db.prepare('SELECT photo_file FROM users WHERE id = ?').get(parseId(req.params.id));
    if (!u || !u.photo_file) return res.status(404).end();
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.type(MIME_BY_EXT[extOf(u.photo_file)] || 'application/octet-stream');
    res.sendFile(storage.abs(u.photo_file));
  });

  return r;
};
