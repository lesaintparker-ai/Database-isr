# Analyse complète — `ISR_final-4.html` (ISR DATABASE v2.0)

> Analyse statique du code + exécution réelle dans Chromium (Playwright, servi en `http://localhost`).
> Les numéros de ligne renvoient à `ISR_final-4.html`. Les points marqués **[TESTÉ]** ont été reproduits en navigateur.

---

## 1. Vue d'ensemble

| Élément | Constat |
|---|---|
| Nature | Application web **mono-fichier** (HTML + CSS + JS inline), 888 Ko, 1 477 lignes |
| Langue / cible | Français — Armée de l'Air de Côte d'Ivoire, opérateurs ISR sur King Air 360ER |
| Backend | **Aucun.** Toutes les données sont dans **IndexedDB du navigateur** (`ISR_DATABASE_v1`, version 5) |
| Dépendances externes | JSZip 3.10.1 (cdnjs) + Google Fonts (Rajdhani, Exo 2, Share Tech Mono) |
| Images | 5 PNG en base64 : 3 × logo identique (44 Ko), 1 × logo ISR (43 Ko), 1 × silhouette d'avion (581 Ko) → **~760 Ko sur 888 Ko** |
| CSS | ~415 lignes, aucune media query (pas de responsive), nombreuses règles mortes/dupliquées |

### Architecture logique

```
Splash 1 (logo, 3 s) → Splash 2 (ISR DATABASE, 3 s) → Connexion (s3) ⇄ Inscription
                                                         │
                                                         ▼
                                                   Menu (s4)
                    ┌────────────────────────────────────┼──────────────────────────┐
              SAUVEGARDE                               FICHE                 Panneau latéral
         Registre 2026–2035                          Rédiger                Historique / Déconnexion
          → Mois → Zones A–F                ┌───────────┴───────────┐
          → Zone : fichiers                 Fiche Mission ISR    Fiche État Mission
             (upload / DL / suppr / ZIP)    (POI en DMS → PDF)   (équipage, temps de vol → PDF)
          → Médias : images/vidéos par POI
```

### Modèle de données (IndexedDB, `initDB` l.833)

| Store | Clé | Index | Contenu |
|---|---|---|---|
| `users` | `slot` ("01"…"08") | — | nom, prénom, grade, pseudo, prefix, `pwHash` (SHA-256), photo (data URL), createdAt |
| `sessions` | auto | `by_date` (loginAt) | copie du profil **avec la photo** + date de connexion |
| `files` | auto | `zone_idx` [year,month,zone], `month_idx` | fichiers PPTX/PDF/DOCX en **data URL base64** |
| `medias` | auto | `by_month`, `by_poi` | images/vidéos en data URL base64 |
| `pois` | auto | `by_month` | POI enregistrés depuis la Fiche Mission (jamais relus) |

---

## 2. Parcours fonctionnel de A à Z

1. **Splash** (`goTo`, l.823) : 2 écrans de 3 s avec barre de progression, puis écran de connexion.
2. **Inscription** (`doRegister`, l.992) : photo, nom, prénom, grade, préfixe de pseudo, numéro d'opérateur (8 slots max), mot de passe ≥ 8 car. avec jauge de force. Pseudo final = `PREFIX_@operateurNN.isr`.
3. **Connexion** (`doLogin`, l.1004) : par pseudo complet ou préfixe seul ; liste déroulante d'auto-complétion de **tous** les profils ; hash SHA-256 comparé localement ; enregistrement d'une session ; bannière « dernière connexion » d'un autre opérateur.
4. **Sauvegarde** : registre 2026→2035 (années futures verrouillées) → 12 mois → 6 zones (A Nord-Ouest … F Sud-Est) → dossier de zone :
   - upload multiple PPTX/PDF/DOCX rangés dans `Rapport_mission_isr_JJ-MM-AAAA` et classés par type ;
   - téléchargement / suppression unitaire ;
   - **VALIDER** = génération d'un ZIP `ISR_DATABASE/ISR_DATABASE_AAAA/MOIS/ZONE_X_Region/...`.
5. **Médias** (depuis une zone) : création de POI, upload images/vidéos, vignettes, visionneuse plein écran, « VALIDER » (affiche une arborescence XAMPP **simulée**).
6. **Fiche** :
   - *Fiche Mission ISR* : date, désignation, N POI en coordonnées DMS → impression PDF (tableau + lignes d'observation, filigrane avion) ;
   - *Fiche État de Mission* : immatriculation (TU-VMD / TU-VMF), équipage, heures décollage/atterrissage (calcul auto, gère le passage de minuit), objectif → impression.
7. **Panneau latéral** : profil, historique des connexions, déconnexion.

---

## 3. Bugs confirmés (par ordre de gravité)

### 🔴 B1 — Impression de la Fiche Mission ISR impossible **[TESTÉ]**
- **Cause** : ligne 814 tronquée : `<div class="dots" id="dots"><div class="dot on" id="d0"></d` (balise non fermée). Le parseur HTML avale toute la ligne 817 (`<img id="plane-img-hidden" …>`, 581 Ko) comme attributs d'une balise fermante → l'élément **n'existe pas**.
- **Effet** : `printPoi()` (l.1123) plante : `Cannot read properties of null (reading 'src')`. Le bouton « IMPRIMER PDF » ne fait rien.
- **Effet secondaire** : un seul point de progression est affiché (`d1` et suivants manquent).
- **Correctif** : remplacer la ligne 814 par
  `<div class="dots" id="dots"><div class="dot on" id="d0"></div><div class="dot" id="d1"></div></div>`.

### 🔴 B2 — Touche Échap ouvre une fenêtre « null › null » et lève une exception **[TESTÉ]**
- **Cause** : le gestionnaire Échap (l.1473) appelle **toutes** les fonctions `close*()`. Or `closeZone()` (l.1075) rappelle `openMonth(CUR_YEAR, CUR_MONTH)` et `closeZones()` (l.1073) rappelle `openYear()`. Avant tout choix de mois, `CUR_YEAR = null` → la modale Zones s'ouvre avec le titre « null › null » et IndexedDB lève `The parameter is not a valid key`.
- Après navigation, Échap **rouvre** les modales Mois/Zones au lieu de tout fermer.
- **Correctif** : dans le handler Échap, retirer uniquement la classe `open` des modales ouvertes, sans appeler les fonctions de navigation « retour ».

### 🔴 B3 — Un profil peut être écrasé à l'inscription **[TESTÉ]**
- **Cause** : `saveUser()` (l.900) utilise `put()` au lieu de `add()`. Le message « Ce numéro est déjà pris » n'est donc jamais déclenché.
- **Effet** : si le `<select>` contient un slot déjà pris (deux onglets d'inscription ouverts, ou modification via les outils développeur), le profil existant est **remplacé** (nouveau mot de passe) → prise de contrôle du compte.
- **Correctif** : `objectStore('users').add(obj)` ; l'erreur `ConstraintError` déclenchera alors la branche « déjà pris ».

### 🔴 B4 — Injection HTML/JS (XSS stockée) **[TESTÉ]**
- Toutes les données utilisateur sont injectées via `innerHTML` sans échappement : nom/prénom/grade/pseudo (liste de connexion l.915, profil, historique, bannière), noms de fichiers (`renderZoneFiles`), noms de POI et de médias, et pages d'impression.
- **Test** : un nom `<img src=x onerror="…">` exécute du code **dès le focus sur le champ de connexion**, avant toute authentification (la liste déroulante l'affiche).
- **Correctif** : fonction `esc()` (remplacer `& < > " '`) appliquée à chaque valeur, ou construction DOM avec `textContent`.

### 🟠 B5 — « Fiche enregistrée avec succès » mais rien n'est enregistré
- `saveFiche()` (l.1100) stocke la Fiche État de Mission dans une variable en mémoire uniquement. Fermer la fenêtre ou recharger = perte.
- `savePoi()` (l.1109) écrit dans le store `pois`, mais **aucun écran ne relit ce store** (`dbGetPoisByMonth`, l.877, n'est jamais appelée).
- `savePoi()` classe la fiche selon la **date du jour**, pas la date de mission saisie, et enregistre l'année en **chaîne** (`"2026"`) alors que les fichiers utilisent un **nombre** (`2026`) → les deux ne pourront jamais être croisés. **[TESTÉ]**

### 🟠 B6 — Toute montée de version de la base efface les médias
- `initDB` (l.858-861) supprime et recrée le store `medias` **à chaque `onupgradeneeded`**, quelle que soit l'ancienne version. Le jour où la version passe à 6, toutes les images/vidéos sont perdues.
- **Correctif** : conditionner à `if (oldV < 5)` (la variable `oldV` est déjà calculée mais inutilisée).

### 🟠 B7 — Le bouton « VALIDER » des médias ne fait rien de réel
- `validerMedia()` (l.1172) affiche seulement l'arborescence « qui sera créée sur le serveur XAMPP » (commentaire : « Simuler »). Aucun ZIP, aucun envoi. Message « ENREGISTREMENT VALIDÉ » trompeur.

### 🟡 B8 — Bugs mineurs
| # | Lieu | Problème |
|---|---|---|
| a | l.460 | Artefact Cloudflare `[email protected]` / lien `/cdn-cgi/l/email-protection` (page enregistrée depuis un site Cloudflare) **[TESTÉ]** — masqué ensuite par `updateSlotSuffix`, mais à nettoyer |
| b | l.1301 | `alert('Sélectionnez un POI d&apos;abord.')` affiche littéralement `d&apos;abord` **[TESTÉ]** |
| c | l.1068 | Chaque mois affiche « 0 fiche » en dur ; icône d'avion tirée au hasard |
| d | l.1401 | « EN LIGNE » affiché sur **toutes** les anciennes sessions de l'utilisateur courant |
| e | l.1466 | Horloge suffixée `(Z)` (Zulu/UTC) mais utilise l'heure **locale** (`getHours`) — juste en Côte d'Ivoire (UTC+0) seulement si le PC est bien réglé |
| f | l.1096 | `openFiche()` ajoute de nouveaux écouteurs à chaque ouverture (accumulation) |
| g | l.1107 | Validation POI : seuls le nom et les degrés de latitude sont exigés ; longitude, minutes, secondes non contrôlées (min/max HTML non appliqués) |
| h | l.1004 | Connexion par préfixe : deux opérateurs peuvent avoir le même préfixe (aucun contrôle d'unicité) → le second ne peut se connecter que par pseudo complet |
| i | Inscription | Le placeholder « Ex: parker_@operateur06.isr » incite à saisir le pseudo complet → pseudo final `PARKER_@OPERATEUR06.ISR_@operateur06.isr` |
| j | l.1020-1035, 1052 | Éléments `muser`, `op-name`, `op-grade`, `op-avatar` inexistants → `showProfile()` est inatteignable (code mort) |
| k | l.1093 | Si JSZip ne se charge pas (hors ligne), `validerZone()` plante (`JSZip is not defined`) — constaté dans l'environnement de test sans accès CDN |
| l | Médias | Médias rattachés au **mois** et non à la zone, bien que le bouton soit dans une zone ; un POI créé n'est pas conservé tant qu'aucun média n'est uploadé |
| m | Numérotation POI | Après suppression du POI 2, le suivant s'appelle « POI 4 » à l'écran |

---

## 4. Sécurité

> Rappel de contexte : l'application gère des données opérationnelles ISR. Le modèle actuel ne protège **rien** contre une personne ayant accès au poste.

| Gravité | Constat |
|---|---|
| 🔴 | **Authentification uniquement côté client** : dans la console, `goTo(3)` donne accès au menu sans mot de passe **[TESTÉ]**. Toutes les données sont lisibles dans DevTools → Application → IndexedDB. |
| 🔴 | **Données en clair** : fichiers, médias, profils stockés non chiffrés dans le profil navigateur. |
| 🔴 | **XSS stockée** (voir B4). |
| 🟠 | **Hash SHA-256 sans sel ni itérations** : cassable très rapidement par dictionnaire. Préférer PBKDF2 (WebCrypto, ≥ 100 000 itérations, sel aléatoire) — et surtout un vrai serveur. |
| 🟠 | **Énumération des comptes** : l'écran de connexion liste, avant authentification, nom, grade, photo et pseudo de tous les opérateurs. |
| 🟠 | **Aucun contrôle d'autorisation** : tout opérateur peut supprimer n'importe quel fichier/média, pas de journal des actions (seules les connexions sont tracées). |
| 🟡 | **Pas de verrouillage** après échecs, pas d'expiration de session, la déconnexion ne ferme pas les modales ouvertes. |
| 🟡 | `crypto.subtle` n'existe qu'en contexte sécurisé : si l'application est servie par XAMPP en `http://192.168.x.x` (et non `localhost`/HTTPS), **inscription et connexion plantent**. |
| 🟡 | Dépendances CDN (cdnjs, Google Fonts) : fuite de métadonnées vers l'extérieur et dysfonctionnement sur réseau isolé. Pas d'attribut `integrity` (SRI) sur JSZip. |

---

## 5. Fiabilité et gestion des données

- **« Base de données » locale à un navigateur** : IndexedDB est propre à un navigateur, un profil Windows et une origine. Deux PC = deux bases distinctes ; vider le cache = **tout est perdu** ; ouvrir le fichier depuis un autre chemin = base vide. Aucune sauvegarde/restauration globale (seul le ZIP par zone existe).
- **Stockage base64** : +33 % de taille ; une vidéo de 500 Mo est entièrement chargée en mémoire en texte. Risque de dépassement de quota et de plantage de l'onglet.
- **Aucune gestion d'erreur IndexedDB** (`onerror`/`onabort` absents sur les écritures) : en cas de quota dépassé, le statut reste bloqué sur « Upload… (2/5) » sans message.
- **Sessions gonflées** : chaque connexion recopie la photo de profil complète (data URL pleine résolution) dans `sessions`.
- **Téléchargement via data URL** (`downloadFileById`) : peu fiable pour les gros fichiers ; préférer un `Blob` + `URL.createObjectURL`.
- **Années figées 2026–2035** : l'application devient inutilisable en 2036.
- `initDB` sans `onblocked` : si un autre onglet garde la base ouverte lors d'une montée de version, l'application reste bloquée silencieusement.

---

## 6. Qualité du code, performances, poids

- **Poids** : le logo identique est embarqué **3 fois** (≈ 88 Ko inutiles) et l'avion de filigrane pèse 581 Ko (PNG non optimisé). Réutiliser une seule source et compresser (WebP/JPEG) ramènerait le fichier sous ~250 Ko.
- **CSS mort / dupliqué** : `.dd*`, `.auth-switch`, `.auth-tab`, `.reg-form`, `.ins-*`, `.pwd-rule*`, `.mhdr-*`, `.btn-deco`, etc. ne sont utilisés par aucun élément ; `.pseudo-prefix`, `.photo-preview`, `.pseudo-wrap`, `.auth-switch` sont définis 2 à 3 fois avec des valeurs contradictoires.
- **JS** : lignes minifiées de 1 000 à 6 000 caractères (`printFiche`, `printPoi`, `renderZoneFiles`…) → maintenance difficile ; style inline massif dans des chaînes HTML ; variables globales ; mélange `var`/`async` ; code mort (`dbGetPoisByMonth`, `showProfile`, `ficheData` jamais persisté).
- **Écran `screen-login-full`** vide (l.489) : vestige.

---

## 7. Ergonomie et accessibilité

- `body{overflow:hidden;width:100vw;height:100vh}` + largeurs fixes (900 px, 520 px…) et **aucune media query** → inutilisable sur tablette/téléphone et sur petits écrans.
- Polices de 8–10 px très fréquentes, contraste `#8A9BB0` sur `#060E18` limite pour les petites tailles.
- Boutons-icônes sans `aria-label`, modales sans `role="dialog"` ni gestion du focus, pas de navigation clavier dans la liste des pseudos.
- Utilisation de `alert()`/`confirm()` natifs, incohérente avec le reste de l'interface.
- Impression via un nouvel onglet `blob:` : peut être bloquée par le bloqueur de pop-ups ; les polices Google n'y sont pas disponibles hors ligne.

---

## 8. Points forts

- Identité visuelle cohérente et soignée (charte or/bleu nuit, animations sobres).
- Fonctionne sans serveur, en un seul fichier : déploiement trivial.
- Arborescence de classement claire (Année → Mois → Zone → Rapport du jour → Type).
- Calcul du temps de vol correct, y compris au passage de minuit.
- Export ZIP structuré par zone, compatible avec un classement sur disque.
- Mots de passe non stockés en clair (hash), jauge de force à l'inscription.

---

## 9. Plan d'action recommandé

### Priorité 1 — corrections immédiates (≈ 1 h)
1. Réparer la ligne 814 (B1) → impression POI et points de progression.
2. Réécrire le handler Échap (B2).
3. `put` → `add` dans `saveUser` (B3).
4. Ajouter une fonction d'échappement HTML partout où `innerHTML` reçoit une donnée utilisateur (B4).
5. Conditionner la recréation du store `medias` à `oldVersion < 5` (B6).
6. Corriger `d&apos;abord`, retirer l'artefact Cloudflare, horloge en UTC.

### Priorité 2 — cohérence fonctionnelle
7. Persister la Fiche État de Mission ; afficher les fiches POI/État dans le mois concerné (et remplacer « 0 fiche » par le vrai compte).
8. Utiliser la date de mission pour le classement ; harmoniser le type de l'année (nombre).
9. Faire de « VALIDER » médias un vrai export ZIP (comme pour les zones).
10. Gestion des erreurs IndexedDB + stockage en `Blob` au lieu de base64.
11. Export/import complet de la base (sauvegarde de sécurité).

### Priorité 3 — architecture (indispensable pour un usage opérationnel réel)
12. Passer à un **serveur** (le code évoque déjà XAMPP : PHP + MySQL/SQLite) avec authentification côté serveur, `password_hash()` (bcrypt/argon2), rôles, journal d'audit, stockage des fichiers sur disque et sauvegardes.
13. Embarquer JSZip et les polices localement (réseau isolé), HTTPS sur le réseau interne.
14. Mise en page responsive, accessibilité (ARIA, focus), dédoublonnage des images et nettoyage CSS/JS.
