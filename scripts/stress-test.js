'use strict';
// Test de charge : envoie un fichier volumineux en flux, le relit, le zippe, et mesure la mémoire du serveur.
// Usage : node scripts/stress-test.js [taille_en_Mo=2048] [parallèle=1]
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { Readable } = require('stream');

const SIZE_MB = Number(process.argv[2]) || 2048;
const PARALLEL = Number(process.argv[3]) || 1;
const PORT = 3999;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'isr-stress-'));

const server = spawn(process.execPath, ['server/index.js'], {
  env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', ISR_DATA_DIR: dataDir, ISR_ADMIN_PASSWORD: 'Stress-Admin-12', ISR_LOG: '0', ISR_MIN_FREE_GB: '1' },
  stdio: ['ignore', 'ignore', 'inherit'],
});
const rssMb = () => { try { return Number(/VmRSS:\s+(\d+)/.exec(fs.readFileSync(`/proc/${server.pid}/status`, 'utf8'))[1]) / 1024; } catch { return 0; } };
let peak = 0;
const sampler = setInterval(() => { peak = Math.max(peak, rssMb()); }, 200);

function request(method, url, { headers = {}, body, cookie } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: PORT, method, path: url, headers: { 'x-requested-with': 'isr', ...(cookie ? { cookie } : {}), ...headers } }, resolve);
    req.on('error', reject);
    if (body instanceof Readable) body.pipe(req); else req.end(body);
  });
}
const readAll = (res) => new Promise((r) => { const c = []; res.on('data', (d) => c.push(d)); res.on('end', () => r(Buffer.concat(c))); });

// Corps multipart généré à la volée (jamais en mémoire) + empreinte SHA-256 du contenu.
function multipartBody(filename, sizeBytes) {
  const boundary = '----isr' + crypto.randomBytes(8).toString('hex');
  const head = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: application/pdf\r\n\r\n`);
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  const hash = crypto.createHash('sha256');
  let sent = 0;
  const chunk = crypto.randomBytes(1024 * 1024);
  const stream = new Readable({
    read() {
      if (sent === 0) this.push(head);
      if (sent >= sizeBytes) { this.push(tail); this.push(null); return; }
      const n = Math.min(chunk.length, sizeBytes - sent);
      const piece = n === chunk.length ? chunk : chunk.subarray(0, n);
      hash.update(piece); sent += n; this.push(piece);
    },
  });
  return { stream, boundary, length: head.length + sizeBytes + tail.length, digest: () => hash.digest('hex') };
}

async function waitUp() {
  for (let i = 0; i < 100; i++) {
    try { const r = await request('GET', '/api/me'); await readAll(r); return; } catch { await new Promise((r) => setTimeout(r, 100)); }
  }
  throw new Error('serveur injoignable');
}

(async () => {
  await waitUp();
  let r = await request('POST', '/api/login', { headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: 'Stress-Admin-12' }) });
  await readAll(r);
  let cookie = r.headers['set-cookie'][0].split(';')[0];
  r = await request('POST', '/api/password', { cookie, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ current: 'Stress-Admin-12', next: 'Stress-Final-123' }) });
  await readAll(r);
  console.log(`Serveur prêt (RSS au repos : ${rssMb().toFixed(0)} Mo). Envoi de ${PARALLEL} × ${SIZE_MB} Mo…`);

  const bytes = SIZE_MB * 1024 * 1024;
  const t0 = Date.now();
  const digests = [];
  await Promise.all(Array.from({ length: PARALLEL }, async (_, i) => {
    const mp = multipartBody(`gros_rapport_${i}.pdf`, bytes);
    const res = await request('POST', `/api/files/2026/${i + 1}/A`, { cookie, headers: { 'content-type': `multipart/form-data; boundary=${mp.boundary}`, 'content-length': String(mp.length) }, body: mp.stream });
    const out = await readAll(res);
    if (res.statusCode !== 201) throw new Error(`upload ${i} : ${res.statusCode} ${out}`);
    digests[i] = mp.digest();
  }));
  const upS = (Date.now() - t0) / 1000;
  console.log(`Envoi OK en ${upS.toFixed(1)} s (${(PARALLEL * SIZE_MB / upS).toFixed(0)} Mo/s) — pic RSS ${peak.toFixed(0)} Mo`);

  // Relecture + vérification d'intégrité
  for (let i = 0; i < PARALLEL; i++) {
    const list = JSON.parse(await readAll(await request('GET', `/api/files/2026/${i + 1}/A`, { cookie })));
    if (list.files[0].size !== bytes) throw new Error('taille incorrecte');
    const t1 = Date.now();
    const dl = await request('GET', `/api/files/${list.files[0].id}/download`, { cookie });
    const h = crypto.createHash('sha256'); let n = 0;
    await new Promise((res) => { dl.on('data', (d) => { h.update(d); n += d.length; }); dl.on('end', res); });
    if (n !== bytes || h.digest('hex') !== digests[i]) throw new Error(`INTÉGRITÉ KO fichier ${i}`);
    console.log(`Téléchargement ${i} OK, SHA-256 identique (${((Date.now() - t1) / 1000).toFixed(1)} s)`);
  }
  // ZIP en flux
  const t2 = Date.now();
  const zip = await request('GET', '/api/files/2026/1/A/zip', { cookie });
  let zn = 0; await new Promise((res) => { zip.on('data', (d) => { zn += d.length; }); zip.on('end', res); });
  console.log(`ZIP en flux OK : ${(zn / 1048576).toFixed(0)} Mo en ${((Date.now() - t2) / 1000).toFixed(1)} s`);

  console.log(`PIC MÉMOIRE SERVEUR : ${peak.toFixed(0)} Mo pour ${(PARALLEL * SIZE_MB / 1024).toFixed(1)} Go déposés`);
  const leftovers = fs.readdirSync(path.join(dataDir, 'tmp')).length;
  console.log(`Fichiers temporaires restants : ${leftovers}`);

  // Envoi interrompu : aucun résidu ne doit rester
  const mp = multipartBody('coupe.pdf', 500 * 1024 * 1024);
  await new Promise((resolve) => {
    const req = http.request({ host: '127.0.0.1', port: PORT, method: 'POST', path: '/api/files/2026/12/A', headers: { 'x-requested-with': 'isr', cookie, 'content-type': `multipart/form-data; boundary=${mp.boundary}`, 'content-length': String(mp.length) } });
    req.on('error', () => {});
    mp.stream.pipe(req);
    setTimeout(() => { req.destroy(); mp.stream.destroy(); setTimeout(resolve, 500); }, 400);
  });
  const resid = fs.readdirSync(path.join(dataDir, 'tmp')).length;
  const l12 = JSON.parse(await readAll(await request('GET', '/api/files/2026/12/A', { cookie })));
  console.log(`Après coupure en cours d'envoi : ${resid} résidu(s) tmp, ${l12.files.length} fichier(s) en base (attendu : 0 et 0)`);
  process.exitCode = (leftovers || resid || l12.files.length) ? 1 : 0;
})().catch((e) => { console.error('ÉCHEC :', e.message); process.exitCode = 1; }).finally(() => {
  clearInterval(sampler);
  server.kill();
  setTimeout(() => { fs.rmSync(dataDir, { recursive: true, force: true }); process.exit(process.exitCode || 0); }, 500);
});
