'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { startServer, client, makeUser, adminClient } = require('./helpers');

let srv, admin, op, lect;

before(async () => {
  srv = await startServer();
  admin = await adminClient(srv);
  op = await makeUser(srv, admin, { username: 'operateur1', role: 'operateur' });
  lect = await makeUser(srv, admin, { username: 'lecteur1', role: 'lecteur' });
});
after(async () => { await srv.stop(); });

test('sans session : API refusée, statiques accessibles', async () => {
  const c = client(srv.base);
  assert.equal((await (await c.get('/api/me')).json()).user, null);
  assert.equal((await c.get('/api/summary/2026')).status, 401);
  assert.equal((await fetch(srv.base + '/')).status, 200);
});

test('connexion : mauvais mot de passe, verrouillage après 5 échecs', async () => {
  const c = client(srv.base);
  for (let i = 0; i < 5; i++) assert.equal((await c.login('lecteur1', 'faux')).status, 401);
  const r = await c.login('lecteur1', 'Motdepasse-12');
  assert.equal(r.status, 429);
  // Autre identifiant non affecté
  assert.equal((await c.login('operateur1', 'Motdepasse-12')).status, 200);
});

test('mot de passe temporaire : tout est bloqué avant changement', async () => {
  const r = await admin.post('/api/users', { username: 'tempuser', nom: 'T', prenom: 'U', grade: 'Cpl', role: 'operateur' });
  const { temporaryPassword } = await r.json();
  const c = client(srv.base);
  assert.equal((await c.login('tempuser', temporaryPassword)).status, 200);
  const blocked = await c.get('/api/summary/2026');
  assert.equal(blocked.status, 403);
  assert.equal((await blocked.json()).code, 'MUST_CHANGE');
  assert.equal((await c.post('/api/password', { current: temporaryPassword, next: 'court' })).status, 400);
  assert.equal((await c.post('/api/password', { current: temporaryPassword, next: 'Nouveau-Pass-9' })).status, 200);
  assert.equal((await c.get('/api/summary/2026')).status, 200);
});

test('CSRF : requête sans en-tête ou avec mauvaise origine refusée', async () => {
  const cookie = op.cookie();
  const r1 = await fetch(srv.base + '/api/pois', { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: '{}' });
  assert.equal(r1.status, 403);
  const r2 = await fetch(srv.base + '/api/pois', { method: 'POST', headers: { cookie, 'content-type': 'application/json', 'x-requested-with': 'isr', origin: 'http://evil.example' }, body: '{}' });
  assert.equal(r2.status, 403);
});

test('rôles : lecteur ne peut pas écrire, opérateur ne gère pas les utilisateurs', async () => {
  assert.equal((await lect.upload('/api/files/2026/1/A', 'a.pdf', 'x')).status, 403);
  assert.equal((await lect.post('/api/pois', { year: 2026, month: 1, name: 'x' })).status, 403);
  assert.equal((await op.get('/api/users')).status, 403);
  assert.equal((await op.get('/api/admin/audit')).status, 403);
  assert.equal((await lect.get('/api/summary/2026')).status, 200);
});

test('inscription publique inexistante', async () => {
  const c = client(srv.base);
  assert.equal((await c.post('/api/users', { username: 'pirate', nom: 'a', prenom: 'b', grade: 'c', role: 'admin' })).status, 401);
});

test('fichiers : dépôt, liste, téléchargement identique, ZIP, suppression', async () => {
  const content = Buffer.from('%PDF-1.4 contenu de test é');
  const up = await op.upload('/api/files/2026/3/B', 'Rapport été.pdf', content);
  assert.equal(up.status, 201);
  const list = await (await lect.get('/api/files/2026/3/B')).json();
  assert.equal(list.files.length, 1);
  assert.equal(list.files[0].name, 'Rapport été.pdf');
  assert.equal(list.files[0].type, 'PDF');
  assert.match(list.files[0].folder, /^Rapport_mission_isr_\d{2}-\d{2}-\d{4}$/);

  const dl = await lect.get(`/api/files/${list.files[0].id}/download`);
  assert.equal(dl.status, 200);
  assert.deepEqual(Buffer.from(await dl.arrayBuffer()), content);

  const counts = await (await lect.get('/api/zones/2026/3')).json();
  assert.equal(counts.zones.find((z) => z.id === 'B').count, 1);
  const sum = await (await lect.get('/api/summary/2026')).json();
  assert.equal(sum.months[2].files, 1);

  const zip = await lect.get('/api/files/2026/3/B/zip');
  assert.equal(zip.status, 200);
  assert.equal(zip.headers.get('content-type'), 'application/zip');
  const zbuf = Buffer.from(await zip.arrayBuffer());
  assert.equal(zbuf.readUInt32LE(0), 0x04034b50); // signature ZIP
  assert.ok(zbuf.includes(Buffer.from('ZONE_B_Nord-Est')));

  // L'opérateur ne peut pas supprimer le fichier d'un autre, un admin oui.
  const op2 = await makeUser(srv, admin, { username: 'operateur2', role: 'operateur' });
  assert.equal((await op2.del(`/api/files/${list.files[0].id}`)).status, 403);
  assert.equal((await admin.del(`/api/files/${list.files[0].id}`)).status, 200);
  assert.equal((await lect.get(`/api/files/${list.files[0].id}/download`)).status, 404);
  assert.equal((await lect.get('/api/files/2026/3/B/zip')).status, 404);
});

test('fichiers : type interdit, zone/année/mois invalides, chemin piégé', async () => {
  assert.equal((await op.upload('/api/files/2026/3/A', 'virus.exe', 'MZ')).status, 415);
  assert.equal((await op.upload('/api/files/2026/3/Z', 'a.pdf', 'x')).status, 400);
  assert.equal((await op.upload('/api/files/2026/13/A', 'a.pdf', 'x')).status, 400);
  assert.equal((await op.upload('/api/files/1999/3/A', 'a.pdf', 'x')).status, 400);
  assert.equal((await op.upload('/api/files/2026/3/A', '../../../etc/passwd.pdf', 'x')).status, 201);
  const l = await (await op.get('/api/files/2026/3/A')).json();
  assert.ok(!l.files[0].name.includes('/'));
  // Rien n'a été écrit hors du dossier de stockage
  const stray = fs.readdirSync(path.join(srv.dataDir, 'tmp'));
  assert.equal(stray.length, 0);
});

test('médias : POI, dépôt image/vidéo, lecture Range, ZIP, contrôle du type', async () => {
  const p = await (await op.post('/api/pois', { year: 2026, month: 4, name: ' bouna nord ' })).json();
  assert.equal(p.poi.name, 'BOUNA NORD');
  const again = await (await op.post('/api/pois', { year: 2026, month: 4, name: 'Bouna Nord' })).json();
  assert.equal(again.existed, true);

  const video = Buffer.alloc(100000, 7);
  assert.equal((await op.upload(`/api/pois/${p.poi.id}/medias?kind=video`, 'vol1.mp4', video)).status, 201);
  assert.equal((await op.upload(`/api/pois/${p.poi.id}/medias?kind=image`, 'photo.png', 'PNGDATA')).status, 201);
  assert.equal((await op.upload(`/api/pois/${p.poi.id}/medias?kind=image`, 'vol.mp4', 'x')).status, 415);
  assert.equal((await op.upload(`/api/pois/${p.poi.id}/medias?kind=autre`, 'a.png', 'x')).status, 400);

  const { medias } = await (await lect.get(`/api/medias/2026/4?poi=${p.poi.id}`)).json();
  assert.equal(medias.length, 2);
  const vid = medias.find((m) => m.kind === 'video');
  const full = await lect.get(`/api/media-file/${vid.id}`);
  assert.equal(full.status, 200);
  assert.equal(full.headers.get('content-type'), 'video/mp4');
  const part = await lect.get(`/api/media-file/${vid.id}`, { headers: { range: 'bytes=10-19' } });
  assert.equal(part.status, 206);
  assert.equal((await part.arrayBuffer()).byteLength, 10);

  const zip = await lect.get('/api/media-zip/2026/4');
  const zb = Buffer.from(await zip.arrayBuffer());
  assert.ok(zb.includes(Buffer.from('Videos/BOUNA NORD/vol1.mp4')));
  assert.ok(zb.includes(Buffer.from('Images/BOUNA NORD/photo.png')));

  // Suppression du POI (admin) supprime médias et fichiers
  const before = fs.readdirSync(path.join(srv.dataDir, 'storage', 'medias', '2026', '04', String(p.poi.id))).length;
  assert.equal(before, 2);
  assert.equal((await op.del(`/api/pois/${p.poi.id}`)).status, 403);
  assert.equal((await admin.del(`/api/pois/${p.poi.id}`)).status, 200);
  assert.equal((await lect.get(`/api/media-file/${vid.id}`)).status, 404);
});

test('fiche mission : validation DMS et classement par date de mission', async () => {
  const good = { kind: 'mission', payload: { date: '2026-05-17', miss: 'Surveillance Nord', pois: [
    { nom: 'BOUNA AFLD', lat: { dir: 'N', d: 9, m: 15, s: 30.5 }, lon: { dir: 'W', d: 3, m: 0, s: 1 } }] } };
  const r = await op.post('/api/fiches', good);
  assert.equal(r.status, 201);
  const out = await r.json();
  assert.ok(Math.abs(out.payload.pois[0].lat.decimal - 9.258472) < 1e-5);
  assert.ok(out.payload.pois[0].lon.decimal < 0); // Ouest négatif

  const bad = JSON.parse(JSON.stringify(good));
  bad.payload.pois[0].lat.m = 75;
  assert.equal((await op.post('/api/fiches', bad)).status, 400);
  bad.payload.pois[0].lat = { dir: 'N', d: 91, m: 0, s: 0 };
  assert.equal((await op.post('/api/fiches', bad)).status, 400);
  bad.payload.pois[0].lat = { dir: 'N', d: 90, m: 5, s: 0 };
  assert.equal((await op.post('/api/fiches', bad)).status, 400);
  assert.equal((await op.post('/api/fiches', { kind: 'mission', payload: { date: '2026-05-17', miss: 'x', pois: [] } })).status, 400);

  const l = await (await lect.get('/api/fiches?year=2026&month=5&kind=mission')).json();
  assert.equal(l.fiches.length, 1);
  assert.equal(l.fiches[0].date, '2026-05-17');
  const one = await (await lect.get(`/api/fiches/${l.fiches[0].id}`)).json();
  assert.equal(one.payload.miss, 'Surveillance Nord');
  assert.equal((await lect.post('/api/fiches', good)).status, 403);
  const sum = await (await lect.get('/api/summary/2026')).json();
  assert.equal(sum.months[4].fiches, 1);
});

test('fiche état de mission : durée calculée côté serveur, passage de minuit', async () => {
  const base = { date: '2026-06-02', codeid: 'TU-VMD', cdb: 'Cne A', cop: 'Lt B', op1: 'Sgt C', op2: 'Sgt D', meca: 'Adj E', obj: 'Reco' };
  const a = await (await op.post('/api/fiches', { kind: 'etat', payload: { ...base, hdec: '08:15', hatt: '10:40' } })).json();
  assert.equal(a.payload.tot, '02H25');
  const b = await (await op.post('/api/fiches', { kind: 'etat', payload: { ...base, hdec: '23:30', hatt: '01:10', tot: 'FAUX' } })).json();
  assert.equal(b.payload.tot, '01H40');
  assert.equal((await op.post('/api/fiches', { kind: 'etat', payload: { ...base, codeid: 'XX', hdec: '08:00', hatt: '09:00' } })).status, 400);
  assert.equal((await op.post('/api/fiches', { kind: 'etat', payload: { ...base, hdec: '8h', hatt: '09:00' } })).status, 400);
});

test('XSS : les données sont renvoyées telles quelles (échappées côté interface), jamais exécutées par le serveur', async () => {
  const r = await admin.post('/api/users', { username: 'xss_user', nom: '<img src=x onerror=alert(1)>', prenom: 'a', grade: 'b', role: 'lecteur' });
  assert.equal(r.status, 201);
  const ct = r.headers.get('content-type');
  assert.match(ct, /application\/json/);
  assert.match(r.headers.get('content-security-policy') || '', /script-src 'self'/);
  assert.equal((await admin.post('/api/users', { username: 'a b', nom: 'a', prenom: 'b', grade: 'c', role: 'lecteur' })).status, 400);
});

test('administrateurs : impossible de retirer le dernier, sessions révoquées à la désactivation', async () => {
  const me = (await (await admin.get('/api/me')).json()).user;
  assert.equal((await admin.patch(`/api/users/${me.id}`, { active: false })).status, 400);
  assert.equal((await admin.patch(`/api/users/${me.id}`, { role: 'lecteur' })).status, 400);

  const users = (await (await admin.get('/api/users')).json()).users;
  const target = users.find((u) => u.username === 'lecteur1');
  assert.equal((await lect.get('/api/me')).status, 200);
  assert.equal((await admin.patch(`/api/users/${target.id}`, { active: false })).status, 200);
  assert.equal((await (await lect.get('/api/me')).json()).user, null);
  assert.notEqual((await client(srv.base).login('lecteur1', 'Motdepasse-12')).status, 200);
});

test('historique, audit, statistiques, sauvegarde', async () => {
  const h = await (await op.get('/api/history')).json();
  assert.ok(h.sessions.length >= 3);
  assert.equal(h.sessions.filter((s) => s.online && s.username === 'operateur1').length, 1);

  const a = await (await admin.get('/api/admin/audit?limit=500')).json();
  const actions = new Set(a.entries.map((e) => e.action));
  for (const x of ['login', 'login_echec', 'utilisateur_cree', 'fichiers_depose', 'fichier_supprime', 'fiche_creee', 'poi_supprime']) assert.ok(actions.has(x), x);

  const st = await (await admin.get('/api/admin/stats')).json();
  assert.ok(st.users >= 3);
  const bk = await admin.post('/api/admin/backup');
  assert.equal(bk.status, 201);
  const { name } = await bk.json();
  const dl = await admin.get(`/api/admin/backups/${name}`);
  assert.equal(dl.status, 200);
  assert.equal(Buffer.from(await dl.arrayBuffer()).subarray(0, 15).toString(), 'SQLite format 3');
  assert.equal((await admin.get('/api/admin/backups/..%2f..%2fetc%2fpasswd')).status, 400);
});

test('déconnexion invalide la session', async () => {
  const c = await makeUser(srv, admin, { username: 'tmp_out', role: 'operateur' });
  assert.equal((await c.get('/api/me')).status, 200);
  const cookie = c.cookie();
  await c.post('/api/logout');
  const stale = client(srv.base); stale.setCookie(cookie);
  assert.equal((await (await stale.get('/api/me')).json()).user, null);
});
