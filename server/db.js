'use strict';
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

// Chaque migration est exécutée une seule fois, dans l'ordre (PRAGMA user_version).
const MIGRATIONS = [
  `
  CREATE TABLE users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
    nom           TEXT NOT NULL,
    prenom        TEXT NOT NULL,
    grade         TEXT NOT NULL,
    role          TEXT NOT NULL CHECK (role IN ('admin','operateur','lecteur')),
    pw_hash       TEXT NOT NULL,
    must_change   INTEGER NOT NULL DEFAULT 0,
    active        INTEGER NOT NULL DEFAULT 1,
    photo_file    TEXT,
    created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );

  CREATE TABLE sessions (
    token_hash    TEXT PRIMARY KEY,
    user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at    TEXT NOT NULL,
    last_seen     TEXT NOT NULL,
    expires_at    TEXT NOT NULL,
    ip            TEXT,
    user_agent    TEXT
  );
  CREATE INDEX idx_sessions_user ON sessions(user_id);

  CREATE TABLE login_history (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id       INTEGER REFERENCES users(id) ON DELETE SET NULL,
    username      TEXT NOT NULL,
    ok            INTEGER NOT NULL,
    at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    ip            TEXT
  );
  CREATE INDEX idx_login_history_at ON login_history(at);

  CREATE TABLE files (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    year          INTEGER NOT NULL,
    month         INTEGER NOT NULL,
    zone          TEXT NOT NULL,
    folder        TEXT NOT NULL,
    type          TEXT NOT NULL,
    name          TEXT NOT NULL,
    size          INTEGER NOT NULL,
    stored_path   TEXT NOT NULL,
    uploaded_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
    uploaded_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );
  CREATE INDEX idx_files_zone ON files(year, month, zone);

  CREATE TABLE pois (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    year          INTEGER NOT NULL,
    month         INTEGER NOT NULL,
    name          TEXT NOT NULL COLLATE NOCASE,
    created_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    UNIQUE (year, month, name)
  );

  CREATE TABLE medias (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    poi_id        INTEGER NOT NULL REFERENCES pois(id) ON DELETE CASCADE,
    year          INTEGER NOT NULL,
    month         INTEGER NOT NULL,
    kind          TEXT NOT NULL CHECK (kind IN ('image','video')),
    name          TEXT NOT NULL,
    mime          TEXT NOT NULL,
    size          INTEGER NOT NULL,
    stored_path   TEXT NOT NULL,
    uploaded_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
    uploaded_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );
  CREATE INDEX idx_medias_month ON medias(year, month);
  CREATE INDEX idx_medias_poi ON medias(poi_id);

  CREATE TABLE fiches (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    kind          TEXT NOT NULL CHECK (kind IN ('mission','etat')),
    year          INTEGER NOT NULL,
    month         INTEGER NOT NULL,
    mission_date  TEXT,
    title         TEXT NOT NULL,
    payload       TEXT NOT NULL,
    created_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );
  CREATE INDEX idx_fiches_month ON fiches(year, month, kind);

  CREATE TABLE audit (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    user_id       INTEGER,
    username      TEXT,
    action        TEXT NOT NULL,
    detail        TEXT,
    ip            TEXT
  );
  CREATE INDEX idx_audit_at ON audit(at);
  `,
];

function openDb(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true });
  const db = new Database(path.join(dataDir, 'isr.sqlite'));
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');

  const current = db.pragma('user_version', { simple: true });
  for (let v = current; v < MIGRATIONS.length; v++) {
    db.transaction(() => {
      db.exec(MIGRATIONS[v]);
      db.pragma(`user_version = ${v + 1}`);
    })();
  }
  return db;
}

module.exports = { openDb };
