'use strict';
// Contrôle de cohérence base ↔ disque.
//   node scripts/check-integrity.js                 → rapport (code retour 1 si anomalie)
//   node scripts/check-integrity.js --clean-orphans → supprime du disque les fichiers absents de la base
//   node scripts/check-integrity.js --sizes         → vérifie aussi la taille de chaque fichier
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { load } = require('../server/config');

const clean = process.argv.includes('--clean-orphans');
const sizes = process.argv.includes('--sizes');
const config = load();
const dbFile = path.join(config.dataDir, 'isr.sqlite');
if (!fs.existsSync(dbFile)) { console.error('Base introuvable : ' + dbFile); process.exit(1); }
const root = path.join(config.dataDir, 'storage');
const db = new Database(dbFile, { readonly: true });

const rows = [
  ...db.prepare('SELECT id, stored_path, size, name FROM files').all().map((r) => ({ ...r, table: 'files' })),
  ...db.prepare('SELECT id, stored_path, size, name FROM medias').all().map((r) => ({ ...r, table: 'medias' })),
  ...db.prepare('SELECT id, photo_file AS stored_path, NULL AS size, username AS name FROM users WHERE photo_file IS NOT NULL').all().map((r) => ({ ...r, table: 'users' })),
];
const known = new Set(rows.map((r) => path.resolve(root, r.stored_path)));

let missing = 0, wrongSize = 0;
for (const r of rows) {
  const p = path.resolve(root, r.stored_path);
  if (!fs.existsSync(p)) { missing++; console.log(`MANQUANT   ${r.table}#${r.id}  ${r.name}  (${r.stored_path})`); continue; }
  if (sizes && r.size !== null && fs.statSync(p).size !== r.size) { wrongSize++; console.log(`TAILLE KO  ${r.table}#${r.id}  ${r.name}`); }
}

const orphans = [];
(function walk(dir) {
  if (!fs.existsSync(dir)) return;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p); else if (!known.has(p)) orphans.push(p);
  }
})(root);
for (const o of orphans) {
  console.log(`ORPHELIN   ${path.relative(root, o)}  (${fs.statSync(o).size} o)`);
  if (clean) fs.rmSync(o);
}
db.close();
console.log(`\n${rows.length} fichier(s) référencé(s) — ${missing} manquant(s), ${wrongSize} de taille incorrecte, ${orphans.length} orphelin(s)${clean ? ' (supprimés)' : ''}.`);
process.exit(missing || wrongSize || (orphans.length && !clean) ? 1 : 0);
