#!/usr/bin/env node
/**
 * Générateur de sites peintres par commune
 * Usage : node generate.js --dep 33 --dir Gironde [--depdir output/gironde-dep]
 *
 * --depdir  (optionnel) : dossier du site département déjà généré.
 *           Après la génération, le sitemap.xml de ce dossier est mis à jour
 *           avec les URLs de tous les sous-domaines villes générés.
 *
 * Structure des images sources attendue :
 *   public/images/villes/{slug}/hero.webp
 *   public/images/villes/{slug}/peinture-interieur.webp
 *   public/images/villes/{slug}/peinture-exterieur.webp
 *   public/images/villes/{slug}/pose-papier-peint.webp
 * Si un fichier ville est absent, le fichier par défaut du template est utilisé.
 *
 * Téléphone : champ "tel" dans communes.json (ex: "05 56 XX XX XX").
 * Si absent, la constante TEL_DEFAULT est utilisée.
 */

const fs   = require('fs');
const path = require('path');

// ─── Lecture du .env ─────────────────────────────────────────────────────────

function loadEnv(filePath = '.env') {
  const env = {};
  if (!fs.existsSync(filePath)) return env;
  fs.readFileSync(filePath, 'utf8').split('\n').forEach(line => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const eq = trimmed.indexOf('=');
    if (eq === -1) return;
    env[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
  });
  return env;
}

const ENV = loadEnv();

// ─── Config ──────────────────────────────────────────────────────────────────

// Téléphone par défaut si non renseigné dans communes.json
const TEL_DEFAULT      = '09 80 40 96 11';
const TEL_HREF_DEFAULT = '+33980409611';

// Images par défaut (utilisées si pas d'image spécifique à la ville)
const IMG_DEFAULTS = {
  'artisan-couvreur':         path.join(__dirname, 'public', 'images', 'artisan-couvreur.webp'),
  'pose-renovation-toiture':  path.join(__dirname, 'public', 'images', 'images-services', 'pose-renovation-toiture.webp'),
  'travaux-de-zinguerie':     path.join(__dirname, 'public', 'images', 'images-services', 'travaux-de-zinguerie.webp'),
  'pose-de-gouttieres':       path.join(__dirname, 'public', 'images', 'images-services', 'pose-de-gouttieres.webp'),
  'nettoyage-de-toitures':    path.join(__dirname, 'public', 'images', 'images-services', 'nettoyage-de-toitures.webp'),
  'isolation-de-combles':     path.join(__dirname, 'public', 'images', 'images-services', 'isolation-de-combles.webp'),
  'pose-de-velux':            path.join(__dirname, 'public', 'images', 'images-services', 'pose-de-velux.webp'),
};

// Config Supabase depuis .env
const SUPABASE_JSON = JSON.stringify({
  directUrl: ENV.SUPABASE_URL || '',
  url:       ENV.SUPABASE_USE_RELATIVE_API === '1' ? '' : (ENV.SUPABASE_URL || ''),
  relative:  ENV.SUPABASE_USE_RELATIVE_API === '1',
  anon:      ENV.SUPABASE_ANON_KEY || '',
  table:     ENV.SUPABASE_TABLE_COUVREUR || 'leads_couvreur',
});

// ─── Arguments CLI ───────────────────────────────────────────────────────────

const args   = process.argv.slice(2);
const getArg = (name) => { const i = args.indexOf(name); return i !== -1 ? args[i + 1] : null; };

const depCode = getArg('--dep');
const depNomArg = getArg('--dep-nom');

if (!depCode || !depNomArg) {
  console.error('Usage : node generate.js --dep <code_dep> --dep-nom <nom_dep>');
  console.error('Exemple : node generate.js --dep 33 --dep-nom Gironde');
  process.exit(1);
}

// Slug du département : minuscules, sans accents, sans espaces/apostrophes
function slugifyDep(s) {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/['']/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '');
}
const outDir = `${depCode}-${slugifyDep(depNomArg)}`;

// ─── Lecture des fichiers ─────────────────────────────────────────────────────

const ROOT_PARENT = path.resolve(__dirname, '..');

const communes        = JSON.parse(fs.readFileSync(path.join(ROOT_PARENT, 'data', 'communes.json'), 'utf8'));
const variables       = JSON.parse(fs.readFileSync(path.join(__dirname,   'data', 'variables.json'), 'utf8'));

// Charge la liste des villes : prioritairement depuis ../json-communes/communes_XX.json
const depPad = (() => {
  const s = String(depCode).toUpperCase();
  if (s === '2A' || s === '2B') return '20'; // Corse fusionnée en dept 20
  if (s.length >= 3) return s;
  return s.padStart(2, '0');
})();
const communesFile = path.join(ROOT_PARENT, 'json-communes', `communes_${depPad}.json`);
let batch;
if (fs.existsSync(communesFile)) {
  batch = JSON.parse(fs.readFileSync(communesFile, 'utf8'));
  console.log(`📂 ${batch.villes.length} communes chargées depuis json-communes/communes_${depPad}.json`);
} else {
  console.warn(`⚠️   json-communes/communes_${depPad}.json introuvable — fallback sur data/batch.json`);
  batch = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'batch.json'), 'utf8'));
}

const template        = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');

// ─── Index des communes ───────────────────────────────────────────────────────

// Chaque clé pointe vers un tableau (plusieurs communes peuvent partager un même nom)
const communeIndex = {};
communes.forEach(c => {
  [normalise(c.nom_standard), normalise(c.nom_sans_pronom), normalise(c.nom_sans_accent)].forEach(key => {
    if (!key) return;
    if (!communeIndex[key]) communeIndex[key] = [];
    if (!communeIndex[key].includes(c)) communeIndex[key].push(c);
  });
});

// Normalise : minuscules, sans accents, tirets/espaces/apostrophes tous équivalents — match quelle que soit l'orthographe saisie
function normalise(str) {
  return String(str)
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/['']/g, ' ')              // apostrophes → espace
    .replace(/[\s\-_]+/g, ' ')           // espaces, tirets, underscores → espace simple
    .trim();
}

// Alias d'orthographes locales/historiques → nom officiel INSEE (clés et valeurs déjà normalisées)
const COMMUNE_ALIASES = {
  'saint philippe d aiguilhe': 'saint philippe d aiguille',
};

// ─── Utilitaires ─────────────────────────────────────────────────────────────

function replace(tpl, vars) {
  return tpl.replace(/\{\{([A-Z0-9_]+)\}\}/g, (match, key) =>
    vars[key] !== undefined ? vars[key] : match
  );
}

function pickVariant(arr, seed, varKey) {
  // SHA-256 tronqué : garantit une distribution uniforme et sans pattern
  const crypto = require('crypto');
  const hash = crypto.createHash('sha256').update(seed + '::' + (varKey || '')).digest();
  const n = hash.readUInt32BE(0);
  return arr[n % arr.length];
}

// Choisit déterministiquement 3 indices de services (parmi 1..6) qui afficheront le nom de la ville dans leur titre
function pickServicesWithCity(seed) {
  const crypto = require('crypto');
  const indices = [1, 2, 3, 4, 5, 6].map(i => ({
    i,
    h: crypto.createHash('sha256').update(seed + '::service-loc::' + i).digest().readUInt32BE(0),
  }));
  indices.sort((a, b) => a.h - b.h);
  return new Set(indices.slice(0, 3).map(x => x.i));
}

/** Transforme un nom sans accent en slug URL-safe
 *  ex: "Villenave-d'Ornon" → "villenave-d-ornon"
 *      "Le Taillan-Médoc"  → "le-taillan-medoc"  (accents déjà retirés en amont)
 */
function slugify(str) {
  return str
    .toLowerCase()
    .replace(/['']/g, '-')   // apostrophes → tiret
    .replace(/\s+/g,  '-')   // espaces     → tiret
    .replace(/-{2,}/g, '-')  // tirets multiples → un seul
    .replace(/^-|-$/g, '');  // tirets en début/fin supprimés
}

// Formes grammaticales des départements (à/en + de/du/d'/des + le/la/l'/les)
const DEP_FORMES = {
  '1':  { a: "dans l'Ain",          de: "de l'Ain",          le: "l'Ain" },
  '2':  { a: "dans l'Aisne",        de: "de l'Aisne",        le: "l'Aisne" },
  '3':  { a: "dans l'Allier",       de: "de l'Allier",       le: "l'Allier" },
  '4':  { a: "dans les Alpes-de-Haute-Provence", de: "des Alpes-de-Haute-Provence", le: "les Alpes-de-Haute-Provence" },
  '5':  { a: "dans les Hautes-Alpes", de: "des Hautes-Alpes", le: "les Hautes-Alpes" },
  '6':  { a: "dans les Alpes-Maritimes", de: "des Alpes-Maritimes", le: "les Alpes-Maritimes" },
  '7':  { a: "en Ardèche",          de: "d'Ardèche",         le: "l'Ardèche" },
  '8':  { a: "dans les Ardennes",    de: "des Ardennes",      le: "les Ardennes" },
  '9':  { a: "en Ariège",           de: "d'Ariège",          le: "l'Ariège" },
  '10': { a: "dans l'Aube",         de: "de l'Aube",         le: "l'Aube" },
  '11': { a: "dans l'Aude",         de: "de l'Aude",         le: "l'Aude" },
  '12': { a: "dans l'Aveyron",      de: "de l'Aveyron",      le: "l'Aveyron" },
  '13': { a: "dans les Bouches-du-Rhône", de: "des Bouches-du-Rhône", le: "les Bouches-du-Rhône" },
  '14': { a: "dans le Calvados",     de: "du Calvados",       le: "le Calvados" },
  '15': { a: "dans le Cantal",       de: "du Cantal",         le: "le Cantal" },
  '16': { a: "en Charente",         de: "de Charente",        le: "la Charente" },
  '17': { a: "en Charente-Maritime", de: "de Charente-Maritime", le: "la Charente-Maritime" },
  '18': { a: "dans le Cher",         de: "du Cher",           le: "le Cher" },
  '19': { a: "en Corrèze",          de: "de Corrèze",        le: "la Corrèze" },
  '21': { a: "en Côte-d'Or",        de: "de Côte-d'Or",      le: "la Côte-d'Or" },
  '22': { a: "dans les Côtes-d'Armor", de: "des Côtes-d'Armor", le: "les Côtes-d'Armor" },
  '23': { a: "dans la Creuse",       de: "de la Creuse",      le: "la Creuse" },
  '24': { a: "en Dordogne",         de: "de Dordogne",        le: "la Dordogne" },
  '25': { a: "dans le Doubs",        de: "du Doubs",          le: "le Doubs" },
  '26': { a: "dans la Drôme",        de: "de la Drôme",       le: "la Drôme" },
  '27': { a: "dans l'Eure",         de: "de l'Eure",         le: "l'Eure" },
  '28': { a: "en Eure-et-Loir",     de: "d'Eure-et-Loir",    le: "l'Eure-et-Loir" },
  '29': { a: "dans le Finistère",    de: "du Finistère",      le: "le Finistère" },
  '20': { a: "en Corse",            de: "de Corse",           le: "la Corse" },
  '2A': { a: "en Corse-du-Sud",     de: "de Corse-du-Sud",    le: "la Corse-du-Sud" },
  '2B': { a: "en Haute-Corse",      de: "de Haute-Corse",     le: "la Haute-Corse" },
  '30': { a: "dans le Gard",         de: "du Gard",           le: "le Gard" },
  '31': { a: "en Haute-Garonne",    de: "de Haute-Garonne",   le: "la Haute-Garonne" },
  '32': { a: "dans le Gers",         de: "du Gers",           le: "le Gers" },
  '33': { a: "en Gironde",          de: "de Gironde",         le: "la Gironde" },
  '34': { a: "dans l'Hérault",      de: "de l'Hérault",      le: "l'Hérault" },
  '35': { a: "en Ille-et-Vilaine",  de: "d'Ille-et-Vilaine",  le: "l'Ille-et-Vilaine" },
  '36': { a: "dans l'Indre",        de: "de l'Indre",        le: "l'Indre" },
  '37': { a: "en Indre-et-Loire",   de: "d'Indre-et-Loire",   le: "l'Indre-et-Loire" },
  '38': { a: "en Isère",            de: "d'Isère",           le: "l'Isère" },
  '39': { a: "dans le Jura",         de: "du Jura",           le: "le Jura" },
  '40': { a: "dans les Landes",      de: "des Landes",        le: "les Landes" },
  '41': { a: "dans le Loir-et-Cher", de: "du Loir-et-Cher",   le: "le Loir-et-Cher" },
  '42': { a: "dans la Loire",        de: "de la Loire",       le: "la Loire" },
  '43': { a: "en Haute-Loire",      de: "de Haute-Loire",     le: "la Haute-Loire" },
  '44': { a: "en Loire-Atlantique", de: "de Loire-Atlantique", le: "la Loire-Atlantique" },
  '45': { a: "dans le Loiret",       de: "du Loiret",         le: "le Loiret" },
  '46': { a: "dans le Lot",          de: "du Lot",            le: "le Lot" },
  '47': { a: "dans le Lot-et-Garonne", de: "du Lot-et-Garonne", le: "le Lot-et-Garonne" },
  '48': { a: "en Lozère",           de: "de Lozère",          le: "la Lozère" },
  '49': { a: "dans le Maine-et-Loire", de: "du Maine-et-Loire", le: "le Maine-et-Loire" },
  '50': { a: "dans la Manche",       de: "de la Manche",      le: "la Manche" },
  '51': { a: "dans la Marne",        de: "de la Marne",       le: "la Marne" },
  '52': { a: "en Haute-Marne",      de: "de Haute-Marne",     le: "la Haute-Marne" },
  '53': { a: "en Mayenne",          de: "de Mayenne",          le: "la Mayenne" },
  '54': { a: "en Meurthe-et-Moselle", de: "de Meurthe-et-Moselle", le: "la Meurthe-et-Moselle" },
  '55': { a: "dans la Meuse",        de: "de la Meuse",       le: "la Meuse" },
  '56': { a: "dans le Morbihan",     de: "du Morbihan",       le: "le Morbihan" },
  '57': { a: "en Moselle",          de: "de Moselle",          le: "la Moselle" },
  '58': { a: "dans la Nièvre",       de: "de la Nièvre",      le: "la Nièvre" },
  '59': { a: "dans le Nord",         de: "du Nord",           le: "le Nord" },
  '60': { a: "dans l'Oise",         de: "de l'Oise",         le: "l'Oise" },
  '61': { a: "dans l'Orne",         de: "de l'Orne",         le: "l'Orne" },
  '62': { a: "dans le Pas-de-Calais", de: "du Pas-de-Calais", le: "le Pas-de-Calais" },
  '63': { a: "dans le Puy-de-Dôme",  de: "du Puy-de-Dôme",   le: "le Puy-de-Dôme" },
  '64': { a: "dans les Pyrénées-Atlantiques", de: "des Pyrénées-Atlantiques", le: "les Pyrénées-Atlantiques" },
  '65': { a: "dans les Hautes-Pyrénées", de: "des Hautes-Pyrénées", le: "les Hautes-Pyrénées" },
  '66': { a: "dans les Pyrénées-Orientales", de: "des Pyrénées-Orientales", le: "les Pyrénées-Orientales" },
  '67': { a: "dans le Bas-Rhin",     de: "du Bas-Rhin",       le: "le Bas-Rhin" },
  '68': { a: "dans le Haut-Rhin",    de: "du Haut-Rhin",      le: "le Haut-Rhin" },
  '69': { a: "dans le Rhône",        de: "du Rhône",          le: "le Rhône" },
  '70': { a: "en Haute-Saône",      de: "de Haute-Saône",     le: "la Haute-Saône" },
  '71': { a: "en Saône-et-Loire",   de: "de Saône-et-Loire",  le: "la Saône-et-Loire" },
  '72': { a: "dans la Sarthe",       de: "de la Sarthe",      le: "la Sarthe" },
  '73': { a: "en Savoie",           de: "de Savoie",          le: "la Savoie" },
  '74': { a: "en Haute-Savoie",     de: "de Haute-Savoie",    le: "la Haute-Savoie" },
  '75': { a: "à Paris",             de: "de Paris",           le: "Paris" },
  '76': { a: "en Seine-Maritime",   de: "de Seine-Maritime",   le: "la Seine-Maritime" },
  '77': { a: "en Seine-et-Marne",   de: "de Seine-et-Marne",  le: "la Seine-et-Marne" },
  '78': { a: "dans les Yvelines",    de: "des Yvelines",      le: "les Yvelines" },
  '79': { a: "dans les Deux-Sèvres", de: "des Deux-Sèvres",   le: "les Deux-Sèvres" },
  '80': { a: "dans la Somme",        de: "de la Somme",       le: "la Somme" },
  '81': { a: "dans le Tarn",         de: "du Tarn",           le: "le Tarn" },
  '82': { a: "dans le Tarn-et-Garonne", de: "du Tarn-et-Garonne", le: "le Tarn-et-Garonne" },
  '83': { a: "dans le Var",          de: "du Var",            le: "le Var" },
  '84': { a: "dans le Vaucluse",     de: "du Vaucluse",       le: "le Vaucluse" },
  '85': { a: "en Vendée",           de: "de Vendée",          le: "la Vendée" },
  '86': { a: "dans la Vienne",       de: "de la Vienne",      le: "la Vienne" },
  '87': { a: "en Haute-Vienne",     de: "de Haute-Vienne",    le: "la Haute-Vienne" },
  '88': { a: "dans les Vosges",      de: "des Vosges",        le: "les Vosges" },
  '89': { a: "dans l'Yonne",        de: "de l'Yonne",        le: "l'Yonne" },
  '90': { a: "dans le Territoire de Belfort", de: "du Territoire de Belfort", le: "le Territoire de Belfort" },
  '91': { a: "dans l'Essonne",      de: "de l'Essonne",      le: "l'Essonne" },
  '92': { a: "dans les Hauts-de-Seine", de: "des Hauts-de-Seine", le: "les Hauts-de-Seine" },
  '93': { a: "en Seine-Saint-Denis", de: "de Seine-Saint-Denis", le: "la Seine-Saint-Denis" },
  '94': { a: "dans le Val-de-Marne", de: "du Val-de-Marne",   le: "le Val-de-Marne" },
  '95': { a: "dans le Val-d'Oise",  de: "du Val-d'Oise",     le: "le Val-d'Oise" },
  '971': { a: "en Guadeloupe",      de: "de Guadeloupe",      le: "la Guadeloupe" },
  '972': { a: "en Martinique",      de: "de Martinique",       le: "la Martinique" },
  '973': { a: "en Guyane",          de: "de Guyane",           le: "la Guyane" },
  '974': { a: "à La Réunion",       de: "de La Réunion",       le: "La Réunion" },
  '976': { a: "à Mayotte",          de: "de Mayotte",          le: "Mayotte" },
};

function getDepFormes(code, nom) {
  // Tente avec le code tel quel, puis sans zéros de tête (ex: "01" → "1")
  const k1 = String(code);
  const k2 = k1.replace(/^0+/, '');
  const f = DEP_FORMES[k1] || DEP_FORMES[k2];
  if (f) return f;
  return { a: `en ${nom}`, de: `de ${nom}`, le: `le ${nom}` };
}

function buildMarque(commune) {
  return `Couvreur ${commune.nom_standard}`;
}

function buildUrl(commune) {
  // Utilise le dep de la commune (pas celui de la génération courante) pour que les liens cross-dep pointent vers le bon sous-domaine.
  // Padding 2 chiffres (01, 02, …, 09, 10+). 2A/2B et outre-mer 971+ restent intacts.
  const raw = String(commune.dep_code).toUpperCase();
  const dep = (raw === '2A' || raw === '2B' || raw.length >= 3) ? raw : raw.padStart(2, '0');
  return `${slugify(commune.nom_sans_accent)}.couvreur${dep}-pro.fr`;
}

// ─── Communes proches (haversine) ────────────────────────────────────────────
function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const toRad = d => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat/2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon/2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function nearestCommunes(source, allCommunes, n, validSet) {
  if (typeof source.lat !== 'number' || typeof source.lon !== 'number') return [];
  const candidates = [];
  for (const c of allCommunes) {
    if (c === source) continue;
    if (validSet && !validSet.has(c)) continue; // exclut les communes non-générées (pas de liens morts)
    if (typeof c.lat !== 'number' || typeof c.lon !== 'number') continue;
    if (c.nom_standard === source.nom_standard && c.code_postal === source.code_postal) continue;
    const d = haversine(source.lat, source.lon, c.lat, c.lon);
    candidates.push({ c, d });
  }
  candidates.sort((a, b) => a.d - b.d);
  return candidates.slice(0, n).map(({ c }) => ({
    nom: c.nom_standard,
    url: buildUrl(c),
  }));
}

function renderCommunesProches(list) {
  return list.map(p => `
          <a href="https://${p.url}" class="commune-tile">
            <span class="commune-tile-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/>
                <circle cx="12" cy="10" r="3"/>
              </svg>
            </span>
            <span class="commune-tile-name">${p.nom}</span>
          </a>`).join('\n');
}

/** Normalise un numéro de tél en format href (ex: "05 56 12 34 56" → "+33556123456") */
function telToHref(tel) {
  const digits = tel.replace(/\D/g, '');
  if (digits.startsWith('0') && digits.length === 10) {
    return '+33' + digits.slice(1);
  }
  return '+' + digits;
}

// ─── Résolution des images par ville ─────────────────────────────────────────

/**
 * Pour chaque image, vérifie si une version spécifique à la ville existe.
 * Retourne { srcInHtml, srcFile } pour chaque image.
 * srcInHtml = chemin relatif depuis index.html généré (toujours "public/images/XXX.webp")
 * srcFile   = chemin source à copier
 */
function resolveImages(slug) {
  const villeDir = path.join(__dirname, 'public', 'images', 'villes', slug);
  const resolved = {};

  Object.entries(IMG_DEFAULTS).forEach(([name, defaultSrc]) => {
    const cityFile = path.join(villeDir, `${name}.webp`);
    resolved[name] = {
      srcInHtml: `public/images/${name}.webp`,
      srcFile:   fs.existsSync(cityFile) ? cityFile : defaultSrc,
    };
  });

  return resolved;
}

/** Copie les images résolues + assets partagés dans le dossier output de la ville */
function copyAssets(slug, outPath) {
  const imgOut = path.join(outPath, 'public', 'images');
  const jsOut  = path.join(outPath, 'public', 'js');

  fs.mkdirSync(imgOut, { recursive: true });
  fs.mkdirSync(jsOut,  { recursive: true });

  // Images de la ville
  const imgs = resolveImages(slug);
  Object.values(imgs).forEach(({ srcFile, srcInHtml }) => {
    if (fs.existsSync(srcFile)) {
      fs.copyFileSync(srcFile, path.join(outPath, srcInHtml));
    }
  });

  // Favicon (partagé)
  const faviconSrc = path.join(__dirname, 'public', 'images', 'favicon.webp');
  if (fs.existsSync(faviconSrc)) {
    fs.copyFileSync(faviconSrc, path.join(imgOut, 'favicon.webp'));
  }

  // JS (partagé)
  const jsSrc = path.join(__dirname, 'public', 'js');
  if (fs.existsSync(jsSrc)) {
    fs.readdirSync(jsSrc).forEach(file => {
      fs.copyFileSync(path.join(jsSrc, file), path.join(jsOut, file));
    });
  }
}

// ─── Construction du dictionnaire de remplacement ────────────────────────────

function buildVars(commune) {
  const slug   = slugify(commune.nom_sans_accent);
  const marque = buildMarque(commune);
  const url    = buildUrl(commune);

  // Téléphone : champ "tel" dans communes.json, sinon constante par défaut
  const tel     = (commune.tel     || TEL_DEFAULT).trim();
  const telHref = commune.tel_href || (commune.tel ? telToHref(commune.tel) : TEL_HREF_DEFAULT);

  // Communes proches (12 plus proches) — calcul haversine, filtrées sur celles effectivement générées
  const proches = nearestCommunes(commune, communes, 12, generatedCommuneSet);
  const communesProchesHtml = renderCommunesProches(proches);

  const nomA = Array.isArray(commune.nom_a_variantes) && commune.nom_a_variantes.length > 0
                  ? pickVariant(commune.nom_a_variantes, slug, 'nom_a')
                  : commune.nom_a;
  const nomDe = Array.isArray(commune.nom_de_variantes) && commune.nom_de_variantes.length > 0
                  ? pickVariant(commune.nom_de_variantes, slug, 'nom_de')
                  : commune.nom_de;

  // 3 services sur 6 affichent le nom de la ville dans leur titre — sélection déterministe par slug
  const servicesWithCity = pickServicesWithCity(slug);
  const serviceLocVars = {};
  for (let i = 1; i <= 6; i++) {
    serviceLocVars[`SERVICE_LOC_${i}`] = servicesWithCity.has(i) ? ' ' + nomA : '';
  }

  const staticVars = {
    COMMUNES_PROCHES: communesProchesHtml,
    NOM:          commune.nom_sans_pronom,
    NOM_COMPLET:  commune.nom_standard,
    NOM_A:        nomA,
    NOM_DE:       nomDe,
    NOM_MAJ:      commune.nom_standard_majuscule,
    SLUG:        slug,
    CODE_POSTAL: String(commune.code_postal).padStart(5, '0'),
    DEP_NOM:      commune.dep_nom,
    DEP_NOM_A:    getDepFormes(depCode, commune.dep_nom).a,
    DEP_NOM_DE:   getDepFormes(depCode, commune.dep_nom).de,
    DEP_NOM_LE:   getDepFormes(depCode, commune.dep_nom).le,
    DEP_CODE:     String(depCode),
    URL:         url,
    TEL:         tel,
    TEL_HREF:    telHref,
    MARQUE:      marque,
    MARQUE_MAJ:  marque.toUpperCase(),
    GENTILE:     commune.gentile && commune.gentile.trim() ? commune.gentile.trim() : commune.nom_a,
    ...serviceLocVars,
  };

  const dynVars = {};
  Object.entries(variables).forEach(([key, variants]) => {
    if (!Array.isArray(variants)) return;
    const varKey = key.toUpperCase();           // "var_hero_lead" → "VAR_HERO_LEAD"
    const picked = pickVariant(variants, slug, key);
    if (typeof picked === 'string') {
      dynVars[varKey] = replace(picked, staticVars);
    } else if (typeof picked === 'object' && picked !== null) {
      Object.entries(picked).forEach(([subKey, subVal]) => {
        dynVars[`${varKey}_${subKey.toUpperCase()}`] = replace(subVal, staticVars);
      });
    }
  });

  return { ...staticVars, ...dynVars };
}

// ─── Génération ──────────────────────────────────────────────────────────────

const outputBase   = path.join(__dirname, 'output', outDir);
let generated      = 0;
let skipped        = 0;
const generatedUrls = [];   // URLs des sous-domaines générés (pour maj sitemap dép)

// Pré-pass : construire le set des communes "générables" (présentes dans un fichier json-communes/communes_XX.json).
// Garantit que chaque lien "communes proches" pointe vers une commune qui SERA générée tôt ou tard — pas de liens morts.
const generatedCommuneSet = new Set();
{
  const jsonCommunesDir = path.join(ROOT_PARENT, 'json-communes');
  const perDepCounts = {};

  if (!fs.existsSync(jsonCommunesDir)) {
    console.warn(`⚠️   ${jsonCommunesDir} introuvable — aucun lien cross-dep ne sera filtré`);
  } else {
    const files = fs.readdirSync(jsonCommunesDir).filter(f => /^communes_[\dA-Z]+\.json$/i.test(f));
    for (const file of files) {
      const m = file.match(/^communes_([\dA-Z]+)\.json$/i);
      if (!m) continue;
      const fileDepPadded = m[1].toUpperCase();
      // Convertit le code fichier (ex: "20" pour Corse) vers le format dep_code de communes.json
      let depForMatch;
      if (fileDepPadded === '20') {
        // Corse : le fichier "communes_20.json" couvre 2A et 2B — on accepte les deux
        depForMatch = ['2A', '2B'];
      } else {
        depForMatch = [fileDepPadded.replace(/^0+/, '') || fileDepPadded];
      }

      let payload;
      try {
        payload = JSON.parse(fs.readFileSync(path.join(jsonCommunesDir, file), 'utf8'));
      } catch (e) {
        console.warn(`⚠️   ${file} illisible : ${e.message}`);
        continue;
      }
      if (!Array.isArray(payload.villes)) continue;

      let added = 0;
      payload.villes.forEach(villeNom => {
        const lookupKey = COMMUNE_ALIASES[normalise(villeNom)] || normalise(villeNom);
        const matches = communeIndex[lookupKey] || [];
        const commune = matches.find(c => depForMatch.includes(String(c.dep_code).toUpperCase().replace(/^0+/, '')));
        if (commune && !generatedCommuneSet.has(commune)) {
          generatedCommuneSet.add(commune);
          added++;
        }
      });
      perDepCounts[fileDepPadded] = added;
    }
  }
  const totalDeps = Object.keys(perDepCounts).length;
  console.log(`🔗 ${generatedCommuneSet.size} communes générables (${totalDeps} département(s) couverts par json-communes/) — aucun lien mort possible`);
}

batch.villes.forEach(villeNom => {
  const normalisedKey = normalise(villeNom);
  const lookupKey = COMMUNE_ALIASES[normalisedKey] || normalisedKey;
  const matches = communeIndex[lookupKey] || [];
  // Normalisation : on retire les zéros de tête pour comparer (ex: "01" === "1")
  const normDep = String(depCode).replace(/^0+/, '');
  const commune = matches.find(c => String(c.dep_code).replace(/^0+/, '') === normDep);

  if (!commune) {
    if (matches.length > 0) {
      console.warn(`⚠️   "${villeNom}" introuvable dans le département ${depCode} (existe dans : ${[...new Set(matches.map(c => c.dep_code))].join(', ')})`);
    } else {
      console.warn(`⚠️   Commune introuvable : "${villeNom}"`);
    }
    skipped++;
    return;
  }

  const slug    = slugify(commune.nom_sans_accent);
  const outPath = path.join(outputBase, slug);

  // HTML
  const allVars = buildVars(commune);
  let   html    = replace(template, allVars);

  // Config Supabase depuis .env
  if (ENV.SUPABASE_ANON_KEY) {
    html = html.replace(
      /<script type="application\/json" id="supabase-config-json">[\s\S]*?<\/script>/,
      `<script type="application/json" id="supabase-config-json">${SUPABASE_JSON}</script>`
    );
  }

  fs.mkdirSync(outPath, { recursive: true });
  fs.writeFileSync(path.join(outPath, 'index.html'), html, 'utf8');

  // Sitemap
  const siteUrl  = `https://${allVars.URL}`;
  const today    = new Date().toISOString().slice(0, 10);
  const sitemap  = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>${siteUrl}/</loc>
    <lastmod>${today}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>1.0</priority>
  </url>
</urlset>`;
  fs.writeFileSync(path.join(outPath, 'sitemap.xml'), sitemap, 'utf8');
  fs.writeFileSync(
    path.join(outPath, 'robots.txt'),
    `User-agent: *\nAllow: /\nSitemap: ${siteUrl}/sitemap.xml\n`,
    'utf8'
  );
  fs.copyFileSync(path.join(__dirname, 'style.css'), path.join(outPath, 'style.css'));

  // Assets (images ville + partagés + JS)
  copyAssets(slug, outPath);

  generatedUrls.push(`https://${allVars.URL}`);
  console.log(`✅  ${commune.nom_standard.padEnd(30)} → ${outPath}`);
  generated++;
});

console.log(`\nTerminé : ${generated} site(s) généré(s), ${skipped} ignoré(s).`);

// ─── Sitemap département ─────────────────────────────────────────────────────
// Le sitemap du site département contient UNIQUEMENT les pages du site dept
// (home + mentions légales + politique). Les sous-domaines villes ont leur
// propre sitemap individuel — ils ne sont pas ajoutés au sitemap du dep.


