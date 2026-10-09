# ISR DATABASE v3.0

Base de données opérationnelle ISR — Armée de l'Air de Côte d'Ivoire.
Serveur local **Node.js + SQLite** : comptes et rôles, dépôt de rapports (PPTX/PDF/DOCX) par année › mois › zone,
médias (images/vidéos) par POI, fiches de mission (POI en DMS) et d'état de mission imprimables, ZIP, journal d'audit.

```bash
npm ci --omit=dev && npm start     # puis http://localhost:3000 — le mot de passe admin s'affiche au 1er démarrage
```

| | |
|---|---|
| `docs/EXPLOITATION.md` | **Installation, HTTPS, sauvegardes, restauration, maintenance** |
| `docs/ANALYSE_PROTOTYPE.md` | Analyse du prototype d'origine (`prototype/ISR_final-4.html`) |
| `server/` · `public/` | API et interface |
| `scripts/` | sauvegarde, contrôle d'intégrité, réinitialisation de mot de passe, test de charge |
| `deploy/` | service systemd, scripts Windows/Linux de démarrage et de sauvegarde |

Tests : `npm test` (API, sécurité, outils) · `npm run test:e2e` (navigateur, nécessite Playwright) · `npm run stress`.
