'use strict';
const { HttpError } = require('./storage');
const { MONTHS, ZONES } = require('./constants');

const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function parseYear(v, config) {
  const y = Number(v);
  if (!Number.isInteger(y) || y < config.firstYear || y > 2200) throw new HttpError(400, 'Année invalide.');
  return y;
}
function parseMonth(v) {
  const m = Number(v);
  if (!Number.isInteger(m) || m < 1 || m > 12) throw new HttpError(400, 'Mois invalide.');
  return m;
}
function parseZone(v) {
  if (!ZONES.some((z) => z.id === v)) throw new HttpError(400, 'Zone invalide.');
  return v;
}
function parseId(v) {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1) throw new HttpError(400, 'Identifiant invalide.');
  return n;
}
function str(v, label, { min = 1, max = 200, optional = false } = {}) {
  if (v === undefined || v === null || v === '') {
    if (optional) return '';
    throw new HttpError(400, `${label} : champ requis.`);
  }
  if (typeof v !== 'string') throw new HttpError(400, `${label} : valeur invalide.`);
  const s = v.trim();
  if (s.length < min) throw new HttpError(400, `${label} : champ requis.`);
  if (s.length > max) throw new HttpError(400, `${label} : ${max} caractères maximum.`);
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(s)) throw new HttpError(400, `${label} : caractères invalides.`);
  return s;
}
const monthName = (m) => MONTHS[m - 1];
const pad = (n) => String(n).padStart(2, '0');
const todayFr = () => { const d = new Date(); return `${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${d.getFullYear()}`; };

module.exports = { ah, parseYear, parseMonth, parseZone, parseId, str, monthName, pad, todayFr };
