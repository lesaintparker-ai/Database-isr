'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const GB = 1024 ** 3;

// Chargement minimal d'un fichier .env (CLÉ=VALEUR) sans écraser l'environnement existant.
(function loadDotEnv() {
  const file = path.join(ROOT, '.env');
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (!m || line.trim().startsWith('#')) continue;
    if (process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
})();

function load(overrides = {}) {
  const env = process.env;
  return Object.assign({
    port: Number(env.PORT) || 3000,
    host: env.HOST || '0.0.0.0',
    dataDir: path.resolve(env.ISR_DATA_DIR || path.join(ROOT, 'data')),
    publicDir: path.join(ROOT, 'public'),
    // Taille max d'un fichier déposé (par défaut 20 Go : les vidéos ISR sont volumineuses).
    maxFileBytes: (Number(env.ISR_MAX_FILE_GB) || 20) * GB,
    // Espace disque à toujours conserver libre (par défaut 2 Go).
    minFreeBytes: (Number(env.ISR_MIN_FREE_GB) || 2) * GB,
    sessionHours: Number(env.ISR_SESSION_HOURS) || 12,
    // Mettre ISR_HTTPS=1 si le serveur est derrière HTTPS (cookie "Secure").
    secureCookie: env.ISR_HTTPS === '1' || !!(env.ISR_TLS_CERT && env.ISR_TLS_KEY),
    // HTTPS natif : renseigner les chemins du certificat et de la clé (PEM).
    tlsCert: env.ISR_TLS_CERT || null,
    tlsKey: env.ISR_TLS_KEY || null,
    minPasswordLength: 10,
    firstYear: 2026,
    logRequests: env.ISR_LOG !== '0',
  }, overrides);
}

module.exports = { load, ROOT, GB };
