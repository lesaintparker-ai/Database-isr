'use strict';
const express = require('express');
const { hashPassword, verifyPassword, checkPasswordPolicy } = require('../auth');
const { ah, str } = require('../util');
const { HttpError } = require('../storage');

const publicUser = (u) => ({
  id: u.id, username: u.username, nom: u.nom, prenom: u.prenom, grade: u.grade, role: u.role,
  hasPhoto: !!u.photo_file, mustChange: !!u.must_change,
});

module.exports = function authRoutes({ db, config, auth, audit }) {
  const r = express.Router();
  const failures = new Map(); // clé "ip|user" ou "ip" → { count, until }
  const MAX_FAIL = 5;          // échecs avant verrouillage d'un couple IP + identifiant
  const MAX_FAIL_IP = 30;      // échecs avant verrouillage d'une IP (identifiants tournants)
  const LOCK_MS = 10 * 60 * 1000;
  function purgeFailures() {
    if (failures.size < 5000) return;
    const now = Date.now();
    for (const [k, f] of failures) if (f.until < now && f.count < 1) failures.delete(k);
    if (failures.size > 50000) failures.clear();
  }
  function registerFailure(key, max) {
    const f = failures.get(key) || { count: 0, until: 0 };
    if (f.until && f.until < Date.now()) { f.until = 0; f.count = 0; }
    f.count += 1;
    if (f.count >= max) { f.until = Date.now() + LOCK_MS; f.count = 0; }
    failures.set(key, f);
  }
  let dummyHash = null;

  const keyOf = (req, username) => `${req.ip}|${String(username).toLowerCase()}`;
  const lockedFor = (key) => { const f = failures.get(key); return f && f.until > Date.now() ? Math.ceil((f.until - Date.now()) / 1000) : 0; };

  r.post('/login', ah(async (req, res) => {
    const username = str(req.body && req.body.username, 'Identifiant', { max: 80 });
    const password = typeof (req.body && req.body.password) === 'string' ? req.body.password : '';
    purgeFailures();
    const key = keyOf(req, username);
    const wait = Math.max(lockedFor(key), lockedFor(req.ip));
    if (wait) throw new HttpError(429, `Trop de tentatives. Réessayez dans ${Math.ceil(wait / 60)} min.`);

    const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
    if (!dummyHash) dummyHash = await hashPassword('dummy-password-for-timing');
    const ok = await verifyPassword(password, user ? user.pw_hash : dummyHash);

    if (!user || !ok || !user.active) {
      registerFailure(key, MAX_FAIL);
      registerFailure(req.ip, MAX_FAIL_IP);
      db.prepare('INSERT INTO login_history (user_id,username,ok,ip) VALUES (?,?,0,?)').run(user ? user.id : null, username, req.ip);
      audit({ user: user || { id: null, username } , ip: req.ip }, 'login_echec', username);
      throw new HttpError(401, 'Identifiant ou mot de passe incorrect.');
    }
    failures.delete(key);

    const previous = db.prepare(`SELECT h.at, u.nom, u.prenom, u.grade, u.photo_file IS NOT NULL AS has_photo, u.id AS uid
      FROM login_history h JOIN users u ON u.id = h.user_id
      WHERE h.ok = 1 AND h.user_id != ? ORDER BY h.id DESC LIMIT 1`).get(user.id);

    db.prepare('INSERT INTO login_history (user_id,username,ok,ip) VALUES (?,?,1,?)').run(user.id, user.username, req.ip);
    const token = auth.createSession(user.id, req);
    auth.setCookie(res, token);
    audit({ user, ip: req.ip }, 'login', '');
    res.json({
      user: publicUser(user),
      previous: previous ? { at: previous.at, nom: previous.nom, prenom: previous.prenom, grade: previous.grade, hasPhoto: !!previous.has_photo, id: previous.uid } : null,
    });
  }));

  r.post('/logout', auth.loadUser, (req, res) => {
    if (req.user) { auth.destroySession(req.sessionHash); audit(req, 'logout', ''); }
    auth.clearCookie(res);
    res.json({ ok: true });
  });

  r.get('/me', auth.loadUser, (req, res) => {
    // 200 même sans session : le navigateur ne journalise pas d'erreur au chargement de la page.
    res.json({ user: req.user ? publicUser(req.user) : null });
  });

  r.post('/password', auth.loadUser, auth.requireAuth, ah(async (req, res) => {
    const { current, next } = req.body || {};
    if (!(await verifyPassword(String(current || ''), req.user.pw_hash))) throw new HttpError(403, 'Mot de passe actuel incorrect.');
    const problem = checkPasswordPolicy(next, config.minPasswordLength);
    if (problem) throw new HttpError(400, problem);
    if (next === current) throw new HttpError(400, 'Le nouveau mot de passe doit être différent.');
    db.prepare('UPDATE users SET pw_hash = ?, must_change = 0 WHERE id = ?').run(await hashPassword(next), req.user.id);
    // Déconnecte les autres sessions de ce compte, garde la session courante.
    db.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash != ?').run(req.user.id, req.sessionHash);
    audit(req, 'mot_de_passe_change', '');
    res.json({ ok: true });
  }));

  return r;
};
module.exports.publicUser = publicUser;
