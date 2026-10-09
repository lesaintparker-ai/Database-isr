'use strict';
// Sauvegarde à chaud de la base (comptes, fiches, index) dans data/backups, avec rotation.
// Usage : node scripts/backup.js [--keep=30]
// Les fichiers et médias (data/storage) doivent être copiés séparément : voir docs/EXPLOITATION.md.
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { load } = require('../server/config');

const keep = Number((process.argv.find((a) => a.startsWith('--keep=')) || '--keep=30').split('=')[1]) || 30;
const config = load();
const dbFile = path.join(config.dataDir, 'isr.sqlite');
if (!fs.existsSync(dbFile)) { console.error('Base introuvable : ' + dbFile); process.exit(1); }

const dir = path.join(config.dataDir, 'backups');
fs.mkdirSync(dir, { recursive: true });
const d = new Date(); const p = (x) => String(x).padStart(2, '0');
const name = `isr-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}.sqlite`;

const db = new Database(dbFile, { readonly: true });
db.backup(path.join(dir, name)).then(() => {
  db.close();
  const olds = fs.readdirSync(dir).filter((f) => /^isr-\d{8}-\d{6}\.sqlite$/.test(f)).sort().reverse().slice(keep);
  olds.forEach((f) => fs.rmSync(path.join(dir, f)));
  console.log(`Sauvegarde créée : ${path.join(dir, name)} (${olds.length} ancienne(s) supprimée(s), ${keep} conservées)`);
}).catch((e) => { console.error('Échec de la sauvegarde :', e.message); process.exit(1); });
