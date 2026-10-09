'use strict';
// Réinitialise le mot de passe d'un compte (à lancer sur le serveur, console fermée au réseau).
// Usage : node scripts/reset-password.js <identifiant>
// Réactive le compte s'il était désactivé, ferme ses sessions et impose un changement à la prochaine connexion.
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { load } = require('../server/config');
const { hashPassword, generatePassword } = require('../server/auth');

(async () => {
  const username = process.argv[2];
  if (!username) { console.error('Usage : node scripts/reset-password.js <identifiant>'); process.exit(1); }
  const config = load();
  const dbFile = path.join(config.dataDir, 'isr.sqlite');
  if (!fs.existsSync(dbFile)) { console.error('Base introuvable : ' + dbFile); process.exit(1); }
  const db = new Database(dbFile);
  db.pragma('busy_timeout = 5000');
  const u = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!u) { console.error(`Utilisateur « ${username} » introuvable.`); process.exit(1); }
  const pw = generatePassword();
  // hashPassword est asynchrone : calcul avant la transaction synchrone.
  const hash = await hashPassword(pw);
  db.transaction(() => {
    db.prepare('UPDATE users SET pw_hash = ?, must_change = 1, active = 1 WHERE id = ?').run(hash, u.id);
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(u.id);
    db.prepare("INSERT INTO audit (user_id,username,action,detail) VALUES (?,?,?,?)").run(u.id, u.username, 'reinit_console', 'Mot de passe réinitialisé depuis la console du serveur');
  })();
  db.close();
  console.log(`Compte : ${u.username}\nMot de passe temporaire : ${pw}\n(à changer à la première connexion)`);
})().catch((e) => { console.error(e.message); process.exit(1); });
