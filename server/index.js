'use strict';
const express = require('express');
const path = require('path');
const http = require('http');
const https = require('https');
const fs = require('fs');
const { load } = require('./config');
const { openDb } = require('./db');
const { createAuth, hashPassword, generatePassword } = require('./auth');
const { createStorage, HttpError } = require('./storage');

async function createApp(overrides = {}) {
  const config = load(overrides);
  const db = openDb(config.dataDir);
  const auth = createAuth(db, config);
  const storage = createStorage(config);

  const insAudit = db.prepare('INSERT INTO audit (user_id,username,action,detail,ip) VALUES (?,?,?,?,?)');
  const audit = (req, action, detail) => {
    const u = req.user || {};
    try { insAudit.run(u.id || null, u.username || null, action, detail || '', req.ip || null); } catch { /* l'audit ne doit jamais bloquer */ }
  };

  // Premier démarrage : création de l'administrateur initial.
  let bootstrap = null;
  if (db.prepare('SELECT COUNT(*) AS n FROM users').get().n === 0) {
    const pw = process.env.ISR_ADMIN_PASSWORD || generatePassword();
    db.prepare("INSERT INTO users (username,nom,prenom,grade,role,pw_hash,must_change) VALUES ('admin','ISR','Administrateur','Admin','admin',?,1)")
      .run(await hashPassword(pw));
    bootstrap = { username: 'admin', password: pw };
    audit({ ip: null }, 'initialisation', 'Compte administrateur créé');
  }

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', process.env.ISR_TRUST_PROXY === '1');

  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy',
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    if (config.secureCookie) res.setHeader('Strict-Transport-Security', 'max-age=31536000');
    next();
  });

  if (config.logRequests) {
    app.use((req, res, next) => {
      const t = Date.now();
      res.on('finish', () => { if (req.path.startsWith('/api')) console.log(`${new Date().toISOString()} ${req.ip} ${req.method} ${req.originalUrl.split('?')[0]} ${res.statusCode} ${Date.now() - t}ms`); });
      next();
    });
  }

  app.use(express.static(config.publicDir, { index: 'index.html', maxAge: '1h', setHeaders: (res, p) => { if (p.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache'); } }));

  const api = express.Router();
  api.use(express.json({ limit: '1mb' }));
  api.use(auth.csrf);
  api.use((req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });

  const ctx = { db, config, auth, audit, storage };
  api.use(require('./routes/auth')(ctx)); // /login /logout /me /password (gère lui-même loadUser)
  api.use(auth.loadUser, auth.requireAuth);
  // Tout le reste exige un mot de passe définitif (sauf changement de mot de passe, géré ci-dessus).
  api.use(auth.requireReady);
  api.use(require('./routes/users')(ctx));
  api.use(require('./routes/files')(ctx));
  api.use(require('./routes/medias')(ctx));
  api.use(require('./routes/fiches')(ctx));
  api.use(require('./routes/admin')(ctx));
  api.use((req, res) => res.status(404).json({ error: 'Route inconnue.' }));
  app.use('/api', api);

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err instanceof HttpError) return res.status(err.status === 499 ? 400 : err.status).json({ error: err.message });
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'JSON invalide.' });
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Requête trop volumineuse.' });
    if (err && err.code === 'SQLITE_CONSTRAINT_UNIQUE') return res.status(409).json({ error: 'Doublon.' });
    console.error(new Date().toISOString(), req.method, req.originalUrl, err);
    if (!res.headersSent) res.status(500).json({ error: 'Erreur interne du serveur.' });
  });

  const purgeTimer = setInterval(() => auth.purgeExpired(), 3600 * 1000);
  purgeTimer.unref();

  const server = config.tlsCert && config.tlsKey
    ? https.createServer({ cert: fs.readFileSync(config.tlsCert), key: fs.readFileSync(config.tlsKey) }, app)
    : http.createServer(app);
  // Les gros envois peuvent durer des heures : pas de délai global.
  server.requestTimeout = 0;
  server.headersTimeout = 60 * 1000;
  server.timeout = 0;
  server.keepAliveTimeout = 65 * 1000;

  const close = () => new Promise((resolve) => {
    clearInterval(purgeTimer);
    server.close(() => { try { db.close(); } catch { /* fermée */ } resolve(); });
    server.closeIdleConnections && server.closeIdleConnections();
  });

  return { app, server, db, config, close, bootstrap };
}

async function main() {
  const inst = await createApp();
  inst.server.listen(inst.config.port, inst.config.host, () => {
    const proto = inst.config.tlsCert ? 'https' : 'http';
    console.log(`ISR DATABASE — serveur démarré sur ${proto}://${inst.config.host}:${inst.config.port}`);
    if (!inst.config.tlsCert && !inst.config.secureCookie) console.log('Attention : HTTP non chiffré. Sur un réseau partagé, activez HTTPS (voir docs/EXPLOITATION.md).');
    console.log(`Données : ${inst.config.dataDir}`);
    if (inst.bootstrap) {
      console.log('------------------------------------------------------------');
      console.log(' PREMIER DÉMARRAGE — compte administrateur créé');
      console.log(`   identifiant  : ${inst.bootstrap.username}`);
      console.log(`   mot de passe : ${inst.bootstrap.password}`);
      console.log(' Notez-le : il ne sera plus affiché. Il devra être changé à la première connexion.');
      console.log('------------------------------------------------------------');
    }
  });
  const stop = () => { console.log('Arrêt…'); inst.close().then(() => process.exit(0)); setTimeout(() => process.exit(0), 5000).unref(); };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

process.on('unhandledRejection', (e) => console.error(new Date().toISOString(), 'unhandledRejection', e));
process.on('uncaughtException', (e) => { console.error(new Date().toISOString(), 'uncaughtException', e); process.exit(1); });

if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });
module.exports = { createApp };
