'use strict';
const os = require('os');
const fs = require('fs');
const path = require('path');
const { createApp } = require('../server');

async function startServer(extra = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'isr-test-'));
  process.env.ISR_ADMIN_PASSWORD = 'Admin-Initial-1';
  const inst = await createApp({ dataDir, port: 0, logRequests: false, minFreeBytes: 0, ...extra });
  await new Promise((r) => inst.server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${inst.server.address().port}`;
  return {
    ...inst, base, dataDir,
    async stop() { await inst.close(); fs.rmSync(dataDir, { recursive: true, force: true }); },
  };
}

// Client HTTP minimal avec cookie de session.
function client(base) {
  let cookie = '';
  async function req(method, url, { json, form, headers = {}, raw } = {}) {
    const h = { 'x-requested-with': 'isr', ...headers };
    if (cookie) h.cookie = cookie;
    let body;
    if (json !== undefined) { h['content-type'] = 'application/json'; body = JSON.stringify(json); }
    if (form) body = form;
    if (raw) body = raw;
    const res = await fetch(base + url, { method, headers: h, body, redirect: 'manual' });
    const sc = res.headers.get('set-cookie');
    if (sc) cookie = sc.split(';')[0].endsWith('=') ? '' : sc.split(';')[0];
    return res;
  }
  const api = {
    get: (u, o) => req('GET', u, o),
    post: (u, json, o) => req('POST', u, { json, ...o }),
    patch: (u, json, o) => req('PATCH', u, { json, ...o }),
    del: (u, o) => req('DELETE', u, o),
    upload: (u, filename, content, extra = {}) => {
      const form = new FormData();
      form.append('file', new Blob([content]), filename);
      return req('POST', u, { form, ...extra });
    },
    async login(username, password) {
      const r = await req('POST', '/api/login', { json: { username, password } });
      return r;
    },
    cookie: () => cookie,
    setCookie: (c) => { cookie = c; },
  };
  return api;
}

// Crée un utilisateur via l'admin et renvoie un client connecté avec son mot de passe définitif.
async function makeUser(srv, adminClient, { username, role, password = 'Motdepasse-12' }) {
  const r = await adminClient.post('/api/users', { username, nom: username.toUpperCase(), prenom: 'Test', grade: 'Sergent', role });
  const { temporaryPassword } = await r.json();
  const c = client(srv.base);
  await c.login(username, temporaryPassword);
  await c.post('/api/password', { current: temporaryPassword, next: password });
  return c;
}

async function adminClient(srv) {
  const c = client(srv.base);
  await c.login('admin', 'Admin-Initial-1');
  await c.post('/api/password', { current: 'Admin-Initial-1', next: 'Admin-Final-12' });
  return c;
}

module.exports = { startServer, client, makeUser, adminClient };
