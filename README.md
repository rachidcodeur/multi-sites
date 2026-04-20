# Générateur de sites Peintres France

Générateur de sites statiques pour artisans peintres — un site par commune et un
site département par code département.

## Prérequis

- **Node.js 18+** (rien d'autre, aucune dépendance npm)
- Un accès SSH au serveur de déploiement
- (Optionnel) Un projet Supabase pour le formulaire de contact
- (Optionnel) Un Google Sheet + Apps Script pour le suivi

## Installation

```bash
# Clone avec sous-module dashboard-peintre
git clone --recurse-submodules <url-du-repo>
cd "Template Peintres France"

# Si déjà cloné sans --recurse-submodules :
git submodule update --init --recursive

# Config environnement
cp .env.example .env
# → Éditer .env et renseigner les clés Supabase + Google Sheet
```

Aucune installation npm n'est nécessaire : le projet utilise uniquement les
modules natifs de Node (`fs`, `path`, `crypto`, `https`, `child_process`).

## Configuration (.env)

Fichier à la racine (copier depuis `.env.example`) :

```
SUPABASE_URL=https://votre-projet.supabase.co
SUPABASE_ANON_KEY=eyJ...       # Clé ANON (publique, pas service_role)
SUPABASE_TABLE=leads_peinture
SUPABASE_USE_RELATIVE_API=0    # 0 = direct Supabase, 1 = proxy Nginx

# Optionnel — push des villes vers Google Sheet au déploiement
DEPLOY_SHEET_URL=https://script.google.com/macros/s/.../exec
DEPLOY_SHEET_TOKEN=votre-token-secret
```

Sans `.env`, la génération marche mais le formulaire de contact affichera
« Envoi indisponible : configuration manquante ».

## Workflow rapide

Utiliser l'outil de commandes (`cmd.html` dans le navigateur ou `cmd.js`) pour
obtenir les commandes prêtes à copier-coller pour un département :

```bash
node cmd.js 33        # Affiche les commandes pour la Gironde
open cmd.html         # Version navigateur avec mémoire du dernier code
```

Chaîne type (exemple département 33) :

```bash
node generate-dep.js --dep 33 --dep-nom Gironde
node generate.js     --dep 33 --dep-nom Gironde
node deploy.js       --dep 33 --dep-nom Gironde --with-dep \
  --local-villes   output/33-gironde \
  --remote-villes  /var/www/peintres/gironde \
  --local-dep      output/33-gironde-dep \
  --remote-dep     /var/www/peintre-en-batiment-33 \
  --server         root@IP-SERVEUR
```

Détails complets dans `documentation.txt`.

## Structure des fichiers

```
.
├── data/
│   ├── communes.json         # 35 000+ communes françaises (source)
│   ├── variables.json        # Variantes de textes (5 par clé)
│   └── batch.json            # Liste des villes à générer
├── public/                   # Images + JS contact-form partagés
├── index.html                # Template page commune
├── index-dep.html            # Template page département
├── mentions-legales.html     # Template légales (département seul)
├── politique-confidentialite.html
├── style.css                 # Styles partagés
├── generate-dep.js           # Génère site département → output/{code}-{nom}-dep/
├── generate.js               # Génère sites communes     → output/{code}-{nom}/
├── deploy.js                 # rsync + dashboard + push Google Sheet
├── cmd.js / cmd.html         # Générateur de commandes
├── dashboard-peintre/        # Dashboard local des sites déployés
│   ├── generate-dashboard.js
│   ├── deployed.json         # Registre des villes déployées (versionné)
│   └── index.html (généré)
└── google-apps-script.gs     # À coller dans Apps Script du Google Sheet
```

## Supabase — mise en place

1. Créer une table `leads_peinture` avec colonnes :
   `name, email, phone, postal, city, message, dep_code, site_name, site_url, submitted_at`
2. Activer Row Level Security avec une policy INSERT pour le rôle `anon`.
3. Dans Settings → API : copier `URL` et `anon key` dans `.env`.
4. Régénérer les sites (`node generate.js ...`) pour injecter la clé.

## Google Sheet — push automatique (optionnel)

1. Dans le Sheet cible : Extensions → Apps Script → coller `google-apps-script.gs`
2. Changer `SECRET_TOKEN` par une valeur longue aléatoire
3. Déployer → Nouveau déploiement → Application Web (Exécuter en tant que : Moi,
   Accès : Tout le monde)
4. Copier l'URL générée dans `DEPLOY_SHEET_URL` du `.env`
5. Mettre le même token dans `DEPLOY_SHEET_TOKEN`

À chaque `node deploy.js`, les nouvelles villes sont ajoutées à l'onglet
portant le code département (créé automatiquement).

## Sécurité

- Le `.env` n'est **jamais** commité (voir `.gitignore`).
- La clé Supabase ANON est publique (elle finit de toutes façons dans le HTML
  généré) — c'est RLS qui protège la table côté serveur.
- Le `DEPLOY_SHEET_TOKEN` reste privé, connu uniquement du script Apps Script
  et du `.env` local.

## Dépannage

Voir `documentation.txt` pour les cas d'erreur fréquents (CORS, 404, RLS,
mode direct vs proxy Nginx).
