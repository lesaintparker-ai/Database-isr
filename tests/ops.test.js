'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { startServer, client, adminClient } = require('./helpers');

let srv;
before(async () => { srv = await startServer(); await adminClient(srv); });
after(async () => { await srv.stop(); });

const run = (script, ...args) => execFileSync(process.execPath, [path.join(__dirname, '..', 'scripts', script), ...args],
  { env: { ...process.env, ISR_DATA_DIR: srv.dataDir }, encoding: 'utf8' });

test('reset-password : récupération d\'un compte admin verrouillé, serveur en marche', async () => {
  const out = run('reset-password.js', 'admin');
  const pw = /Mot de passe temporaire : (\S+)/.exec(out)[1];
  const c = client(srv.base);
  const r = await c.login('admin', pw);
  assert.equal(r.status, 200);
  assert.equal((await r.json()).user.mustChange, true);
  assert.equal((await c.get('/api/summary/2026')).status, 403); // doit d'abord changer le mot de passe
  const log = srv.db.prepare("SELECT 1 FROM audit WHERE action = 'reinit_console'").get();
  assert.ok(log, 'action tracée dans le journal');
  assert.throws(() => run('reset-password.js', 'inconnu'), /introuvable/);
});

test('backup : sauvegarde à chaud valide + rotation', async () => {
  run('backup.js', '--keep=1');
  await new Promise((r) => setTimeout(r, 1100)); // noms horodatés à la seconde
  const out = run('backup.js', '--keep=1');
  assert.match(out, /1 ancienne\(s\) supprimée\(s\)/);
  const dir = path.join(srv.dataDir, 'backups');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sqlite'));
  assert.equal(files.length, 1);
  assert.equal(fs.readFileSync(path.join(dir, files[0])).subarray(0, 15).toString(), 'SQLite format 3');
});

test('check-integrity : détecte fichier manquant, taille altérée et orphelin', async () => {
  // Le mot de passe admin a été réinitialisé par le test précédent : on le fixe directement en base.
  const { hashPassword } = require('../server/auth');
  srv.db.prepare("UPDATE users SET pw_hash = ?, must_change = 0 WHERE username = 'admin'").run(await hashPassword('Autre-Pass-1234'));
  const c = client(srv.base); await c.login('admin', 'Autre-Pass-1234');
  await c.upload('/api/files/2026/2/C', 'a.pdf', 'contenu-un');
  await c.upload('/api/files/2026/2/C', 'b.pdf', 'contenu-deux');
  const list = (await (await c.get('/api/files/2026/2/C')).json()).files;
  assert.equal(list.length, 2);
  const rec = srv.db.prepare('SELECT stored_path FROM files ORDER BY id').all();
  const root = path.join(srv.dataDir, 'storage');
  assert.doesNotThrow(() => run('check-integrity.js', '--sizes'));

  fs.rmSync(path.join(root, rec[0].stored_path));                       // manquant
  fs.appendFileSync(path.join(root, rec[1].stored_path), 'XXXX');       // taille altérée
  fs.writeFileSync(path.join(root, 'docs', 'orphelin.bin'), 'zz');       // orphelin
  let out = '';
  try { run('check-integrity.js', '--sizes'); } catch (e) { out = e.stdout; }
  assert.match(out, /MANQUANT/); assert.match(out, /TAILLE KO/); assert.match(out, /ORPHELIN/);
  try { run('check-integrity.js', '--clean-orphans'); } catch (e) { out = e.stdout; }
  assert.equal(fs.existsSync(path.join(root, 'docs', 'orphelin.bin')), false);
});
