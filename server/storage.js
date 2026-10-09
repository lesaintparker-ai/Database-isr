'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Busboy = require('busboy');
const { ZipArchive } = require('archiver');

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function extOf(name) {
  const i = name.lastIndexOf('.');
  return i < 0 ? '' : name.slice(i + 1).toLowerCase();
}

// Nom d'affichage sûr : pas de chemin, pas de caractères de contrôle.
function safeName(name) {
  let n = String(name || '').replace(/[\\/]/g, '_').replace(/[\u0000-\u001f\u007f<>:"|?*]/g, '_').trim();
  n = n.replace(/^\.+/, '');
  if (n.length > 200) { const e = extOf(n); n = n.slice(0, 190) + (e ? '.' + e.slice(0, 8) : ''); }
  return n || 'fichier';
}

function createStorage(config) {
  const root = path.join(config.dataDir, 'storage');
  const tmp = path.join(config.dataDir, 'tmp');
  const photos = path.join(config.dataDir, 'photos');
  const backups = path.join(config.dataDir, 'backups');
  [root, tmp, photos, backups].forEach((d) => fs.mkdirSync(d, { recursive: true }));

  // Nettoie les envois interrompus (crash, coupure).
  for (const f of fs.readdirSync(tmp)) fs.rmSync(path.join(tmp, f), { force: true });

  const abs = (rel) => {
    const p = path.resolve(root, rel);
    if (p !== root && !p.startsWith(root + path.sep)) throw new HttpError(400, 'Chemin invalide.');
    return p;
  };

  function freeBytes() {
    try { const s = fs.statfsSync(config.dataDir); return Number(s.bavail) * Number(s.bsize); } catch { return Infinity; }
  }

  /**
   * Reçoit un envoi multipart en flux : aucun fichier n'est chargé en mémoire.
   * Écrit dans tmp/, puis déplace dans storage/<subdir>/ une fois l'envoi complet.
   * accept(name, mimetype) → renvoie un objet meta (ou null pour refuser).
   * Retourne [{ name, size, relPath, meta }].
   */
  function receive(req, { subdir, accept, maxFiles = 200, maxBytes = config.maxFileBytes }) {
    return new Promise((resolve, reject) => {
      const declared = Number(req.headers['content-length']);
      if (declared && freeBytes() - declared < config.minFreeBytes) {
        return reject(new HttpError(507, 'Espace disque insuffisant sur le serveur.'));
      }
      let bb;
      try {
        bb = Busboy({ headers: req.headers, defParamCharset: 'utf8', limits: { files: maxFiles, fileSize: maxBytes, fields: 20 } });
      } catch {
        return reject(new HttpError(400, 'Envoi multipart invalide.'));
      }
      const done = [];
      const pending = [];
      const tmpFiles = [];
      let failed = null;

      const cleanup = () => {
        for (const t of tmpFiles) fs.rm(t, { force: true }, () => {});
        for (const d of done) fs.rm(abs(d.relPath), { force: true }, () => {});
      };
      const fail = (err) => {
        if (failed) return;
        failed = err;
        req.unpipe(bb);
        cleanup();
        reject(err);
      };

      bb.on('file', (field, stream, info) => {
        const name = safeName(info.filename);
        const meta = accept(name, info.mimeType);
        if (!meta) { stream.resume(); return fail(new HttpError(415, `Type de fichier non autorisé : ${name}`)); }
        const tmpPath = path.join(tmp, crypto.randomUUID() + '.part');
        tmpFiles.push(tmpPath);
        const out = fs.createWriteStream(tmpPath);
        let size = 0;
        let truncated = false;
        stream.on('data', (c) => { size += c.length; });
        stream.on('limit', () => { truncated = true; });
        const p = new Promise((res, rej) => {
          out.on('error', rej);
          out.on('finish', () => {
            if (truncated) return rej(new HttpError(413, `Fichier trop volumineux : ${name}`));
            const ext = extOf(name);
            const rel = path.posix.join(subdir, crypto.randomUUID() + (ext ? '.' + ext.replace(/[^a-z0-9]/g, '') : ''));
            try {
              fs.mkdirSync(path.dirname(abs(rel)), { recursive: true });
              fs.renameSync(tmpPath, abs(rel));
            } catch (e) { return rej(e); }
            const rec = { name, size, relPath: rel, meta };
            done.push(rec);
            res(rec);
          });
        });
        p.catch(fail);
        pending.push(p);
        stream.on('error', fail);
        stream.pipe(out);
      });
      bb.on('error', fail);
      bb.on('partsLimit', () => fail(new HttpError(413, 'Trop de parties.')));
      bb.on('filesLimit', () => fail(new HttpError(413, `Trop de fichiers (max ${maxFiles}).`)));
      bb.on('close', () => {
        Promise.allSettled(pending).then(() => {
          if (failed) return;
          if (!done.length) return fail(new HttpError(400, 'Aucun fichier reçu.'));
          resolve({ files: done, discard: cleanup });
        });
      });
      req.on('aborted', () => fail(new HttpError(499, 'Envoi interrompu.')));
      req.on('error', fail);
      req.pipe(bb);
    });
  }

  function remove(relPath) {
    try { fs.rmSync(abs(relPath), { force: true }); } catch { /* déjà absent */ }
  }

  // ZIP en flux : jamais plus de quelques Mo en mémoire, quelle que soit la taille.
  function zipTo(res, zipName, entries, { store = false } = {}) {
    const archive = new ZipArchive(store ? { store: true } : { zlib: { level: 1 } });
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${zipName.replace(/[^A-Za-z0-9._-]/g, '_')}"`);
    archive.on('warning', () => {});
    archive.on('error', () => res.destroy());
    res.on('close', () => { if (!res.writableEnded) archive.abort(); });
    archive.pipe(res);
    const used = new Set();
    for (const e of entries) {
      let p = e.zipPath;
      if (used.has(p.toLowerCase())) {
        const ext = extOf(p);
        const base = ext ? p.slice(0, -(ext.length + 1)) : p;
        let i = 2;
        while (used.has(`${base} (${i})${ext ? '.' + ext : ''}`.toLowerCase())) i++;
        p = `${base} (${i})${ext ? '.' + ext : ''}`;
      }
      used.add(p.toLowerCase());
      if (fs.existsSync(abs(e.relPath))) archive.file(abs(e.relPath), { name: p });
    }
    archive.finalize();
  }

  return { root, tmp, photos, backups, abs, receive, remove, zipTo, freeBytes };
}

module.exports = { createStorage, HttpError, extOf, safeName };
