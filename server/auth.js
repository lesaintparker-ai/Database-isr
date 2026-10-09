'use strict';
const crypto = require('crypto');
const { promisify } = require('util');

const scrypt = promisify(crypto.scrypt);
const COOKIE = 'isr_sid';

// ---- Mots de passe : scrypt avec sel aléatoire -----------------------------
const SCRYPT = { N: 32768, r: 8, p: 1, keylen: 64, maxmem: 128 * 1024 * 1024 };

async function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(pw, salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p, maxmem: SCRYPT.maxmem });
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${key.toString('base64')}`;
}

async function verifyPassword(pw, stored) {
  const parts = String(stored).split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, N, r, p, saltB64, keyB64] = parts;
  const expected = Buffer.from(keyB64, 'base64');
  const key = await scrypt(pw, Buffer.from(saltB64, 'base64'), expected.length,
    { N: Number(N), r: Number(r), p: Number(p), maxmem: SCRYPT.maxmem });
  return crypto.timingSafeEqual(key, expected);
}

function generatePassword() {
  // 16 caractères, sans ambiguïté visuelle.
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  const bytes = crypto.randomBytes(16);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
}

function checkPasswordPolicy(pw, min) {
  if (typeof pw !== 'string' || pw.length < min) return `Mot de passe : minimum ${min} caractères.`;
  if (pw.length > 200) return 'Mot de passe trop long.';
  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((re) => re.test(pw)).length;
  if (classes < 3) return 'Mot de passe : utilisez au moins 3 types parmi minuscules, majuscules, chiffres, symboles.';
  return null;
}

// ---- Sessions --------------------------------------------------------------
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function createAuth(db, config) {
  const ttlMs = config.sessionHours * 3600 * 1000;

  const q = {
    insert: db.prepare('INSERT INTO sessions (token_hash,user_id,created_at,last_seen,expires_at,ip,user_agent) VALUES (?,?,?,?,?,?,?)'),
    find: db.prepare(`SELECT s.token_hash, s.expires_at, s.last_seen, u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?`),
    touch: db.prepare('UPDATE sessions SET last_seen = ?, expires_at = ? WHERE token_hash = ?'),
    del: db.prepare('DELETE FROM sessions WHERE token_hash = ?'),
    delUser: db.prepare('DELETE FROM sessions WHERE user_id = ?'),
    purge: db.prepare('DELETE FROM sessions WHERE expires_at < ?'),
  };

  function createSession(userId, req) {
    const token = crypto.randomBytes(32).toString('hex');
    const now = new Date();
    q.insert.run(sha256(token), userId, now.toISOString(), now.toISOString(),
      new Date(now.getTime() + ttlMs).toISOString(), req.ip, String(req.headers['user-agent'] || '').slice(0, 200));
    return token;
  }

  function setCookie(res, token) {
    const attrs = [`${COOKIE}=${token}`, 'Path=/', 'HttpOnly', 'SameSite=Strict', `Max-Age=${Math.floor(ttlMs / 1000)}`];
    if (config.secureCookie) attrs.push('Secure');
    res.setHeader('Set-Cookie', attrs.join('; '));
  }

  function clearCookie(res) {
    res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`);
  }

  // Charge req.user (ou null). Ne rejette jamais : voir requireAuth.
  function loadUser(req, res, next) {
    req.user = null;
    const token = parseCookies(req.headers.cookie)[COOKIE];
    if (token && /^[0-9a-f]{64}$/.test(token)) {
      const row = q.find.get(sha256(token));
      const now = Date.now();
      if (row && row.active && new Date(row.expires_at).getTime() > now) {
        req.user = row;
        req.sessionHash = row.token_hash;
        // Session glissante, écriture au plus toutes les 5 minutes.
        if (now - new Date(row.last_seen).getTime() > 5 * 60 * 1000) {
          q.touch.run(new Date(now).toISOString(), new Date(now + ttlMs).toISOString(), row.token_hash);
        }
      }
    }
    next();
  }

  function requireAuth(req, res, next) {
    if (!req.user) return res.status(401).json({ error: 'Non authentifié.' });
    next();
  }

  // Un compte avec mot de passe temporaire ne peut rien faire avant de l'avoir changé.
  function requireReady(req, res, next) {
    if (req.user.must_change) return res.status(403).json({ error: 'Changement de mot de passe requis.', code: 'MUST_CHANGE' });
    next();
  }

  const requireRole = (...roles) => (req, res, next) => {
    if (!roles.includes(req.user.role)) return res.status(403).json({ error: 'Droits insuffisants.' });
    next();
  };

  // Protection CSRF : cookie SameSite=Strict + en-tête personnalisé + contrôle d'Origin.
  function csrf(req, res, next) {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    if (req.headers['x-requested-with'] !== 'isr') return res.status(403).json({ error: 'Requête refusée.' });
    const origin = req.headers.origin;
    if (origin) {
      let host = null;
      try { host = new URL(origin).host; } catch { /* invalide */ }
      if (host !== req.headers.host) return res.status(403).json({ error: 'Origine refusée.' });
    }
    next();
  }

  return {
    createSession, setCookie, clearCookie, loadUser, requireAuth, requireReady, requireRole, csrf,
    destroySession: (hash) => q.del.run(hash),
    destroyUserSessions: (id) => q.delUser.run(id),
    purgeExpired: () => q.purge.run(new Date().toISOString()),
  };
}

module.exports = { hashPassword, verifyPassword, generatePassword, checkPasswordPolicy, createAuth, COOKIE };
