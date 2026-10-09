'use strict';
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const GB = 1024 ** 3;

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
    secureCookie: env.ISR_HTTPS === '1',
    minPasswordLength: 10,
    firstYear: 2026,
    logRequests: env.ISR_LOG !== '0',
  }, overrides);
}

module.exports = { load, ROOT, GB };
