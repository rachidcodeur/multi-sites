#!/usr/bin/env node
/**
 * Générateur du site de département
 * Usage : node generate-dep.js --dep 33 --dep-nom Gironde --dir gironde
 *
 * Génère un site unique pour le domaine racine du département.
 * Template utilisé : index-dep.html
 * Output           : output/{dir}-dep/
 *
 * Toutes les variables de variables.json sont résolues avec le département
 * comme contexte (NOM → depNom, NOM_A → "en depNom", etc.).
 * Les sous-domaines villes sont ajoutés au sitemap via generate.js --depdir.
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

const TEL_DEFAULT      = '09 88 99 03 94';
const TEL_HREF_DEFAULT = '+33988990394';

const SUPABASE_JSON = JSON.stringify({
  directUrl: ENV.SUPABASE_URL || '',
  url:       ENV.SUPABASE_USE_RELATIVE_API === '1' ? '' : (ENV.SUPABASE_URL || ''),
  relative:  ENV.SUPABASE_USE_RELATIVE_API === '1',
  anon:      ENV.SUPABASE_ANON_KEY || '',
  table:     ENV.SUPABASE_TABLE || 'leads_peinture',
});

// ─── Arguments CLI ───────────────────────────────────────────────────────────

const args   = process.argv.slice(2);
const getArg = (name) => { const i = args.indexOf(name); return i !== -1 ? args[i + 1] : null; };

const depCode = getArg('--dep');
const depNom  = getArg('--dep-nom');

if (!depCode || !depNom) {
  console.error('Usage : node generate-dep.js --dep <code> --dep-nom <nom>');
  console.error('Exemple : node generate-dep.js --dep 33 --dep-nom Gironde');
  process.exit(1);
}

function slugifyDep(s) {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/['']/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '');
}
const outDir = `${depCode}-${slugifyDep(depNom)}`;

// ─── Lecture des fichiers ─────────────────────────────────────────────────────

const variables   = JSON.parse(fs.readFileSync('data/variables.json', 'utf8'));
const template    = fs.readFileSync('index-dep.html',                 'utf8');
const tplMentions = fs.readFileSync('mentions-legales.html',          'utf8');
const tplConfid   = fs.readFileSync('politique-confidentialite.html', 'utf8');

// ─── Utilitaires ─────────────────────────────────────────────────────────────

function replace(tpl, vars) {
  return tpl.replace(/\{\{([A-Z0-9_]+)\}\}/g, (match, key) =>
    vars[key] !== undefined ? vars[key] : match
  );
}

function pickVariant(arr, seed, varKey) {
  const crypto = require('crypto');
  const hash = crypto.createHash('sha256').update(seed + '::' + (varKey || '')).digest();
  const n = hash.readUInt32BE(0);
  return arr[n % arr.length];
}

// ─── Formes grammaticales des départements ───────────────────────────────────

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
  const k1 = String(code);
  const k2 = k1.replace(/^0+/, '');
  const f = DEP_FORMES[k1] || DEP_FORMES[k2];
  if (f) return f;
  return { a: `en ${nom}`, de: `de ${nom}`, le: `le ${nom}` };
}

// ─── Construction des variables ───────────────────────────────────────────────

const depFormes = getDepFormes(depCode, depNom);
const url    = `peintre-en-batiment-${depCode}.com`;
const marque = `Peintre ${depNom}`;
const slug   = String(depCode);   // seed pour pickVariant

const staticVars = {
  DEP_CODE:    String(depCode),
  DEP_NOM:     depNom,
  DEP_NOM_A:   depFormes.a,
  DEP_NOM_DE:  depFormes.de,
  DEP_NOM_LE:  depFormes.le,
  URL:         url,
  TEL:         TEL_DEFAULT,
  TEL_HREF:    TEL_HREF_DEFAULT,
  MARQUE:      marque,
  MARQUE_MAJ:  marque.toUpperCase(),
  NOM:         depNom,
  NOM_A:       depFormes.a,
  NOM_DE:      depFormes.de,
  NOM_MAJ:     depNom.toUpperCase(),
  CODE_POSTAL: String(depCode),
  SLUG:        slug,
};

const dynVars = {};
Object.entries(variables).forEach(([key, variants]) => {
  if (!Array.isArray(variants)) return;
  const varKey = key.toUpperCase();
  const picked = pickVariant(variants, slug, key);
  if (typeof picked === 'string') {
    dynVars[varKey] = replace(picked, staticVars);
  } else if (typeof picked === 'object' && picked !== null) {
    Object.entries(picked).forEach(([subKey, subVal]) => {
      dynVars[`${varKey}_${subKey.toUpperCase()}`] = replace(subVal, staticVars);
    });
  }
});

const allVars = { ...staticVars, ...dynVars };

// ─── Génération ───────────────────────────────────────────────────────────────

const outPath = path.join('output', outDir + '-dep');

fs.mkdirSync(outPath, { recursive: true });

// HTML — injection Supabase si .env renseigné
let html = replace(template, allVars);
if (ENV.SUPABASE_ANON_KEY) {
  html = html.replace(
    /<script type="application\/json" id="supabase-config-json">[\s\S]*?<\/script>/,
    `<script type="application/json" id="supabase-config-json">${SUPABASE_JSON}</script>`
  );
}

fs.writeFileSync(path.join(outPath, 'index.html'),                    html,                              'utf8');
fs.writeFileSync(path.join(outPath, 'mentions-legales.html'),         replace(tplMentions, allVars),     'utf8');
fs.writeFileSync(path.join(outPath, 'politique-confidentialite.html'),replace(tplConfid,   allVars),     'utf8');
fs.copyFileSync('style.css', path.join(outPath, 'style.css'));

// Assets partagés
const imgOut = path.join(outPath, 'public', 'images');
const jsOut  = path.join(outPath, 'public', 'js');
fs.mkdirSync(imgOut, { recursive: true });
fs.mkdirSync(jsOut,  { recursive: true });

[
  path.join('public', 'images', 'favicon.webp'),
  path.join('public', 'images', 'peintre-professionnel.webp'),
  path.join('public', 'images', 'images-services', 'peinture-interieur.webp'),
  path.join('public', 'images', 'images-services', 'peinture-exterieur.webp'),
  path.join('public', 'images', 'images-services', 'pose-papier-peint.webp'),
].forEach(src => {
  if (fs.existsSync(src)) fs.copyFileSync(src, path.join(imgOut, path.basename(src)));
});

const jsSrc = path.join('public', 'js');
if (fs.existsSync(jsSrc)) {
  fs.readdirSync(jsSrc).forEach(file => {
    fs.copyFileSync(path.join(jsSrc, file), path.join(jsOut, file));
  });
}

// ─── Sitemap (pages du site département uniquement) ───────────────────────────
// Les sous-domaines villes sont ajoutés ultérieurement via generate.js --depdir

const today   = new Date().toISOString().slice(0, 10);
const depBase = `https://${url}`;

const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>${depBase}/mentions-legales.html</loc>
    <lastmod>${today}</lastmod>
    <changefreq>yearly</changefreq>
    <priority>0.2</priority>
  </url>
  <url>
    <loc>${depBase}/politique-confidentialite.html</loc>
    <lastmod>${today}</lastmod>
    <changefreq>yearly</changefreq>
    <priority>0.2</priority>
  </url>
</urlset>`;
fs.writeFileSync(path.join(outPath, 'sitemap.xml'), sitemap, 'utf8');

// ─── robots.txt ───────────────────────────────────────────────────────────────

const robotsTxt = `User-agent: *\nAllow: /\nSitemap: ${depBase}/sitemap.xml\n`;
fs.writeFileSync(path.join(outPath, 'robots.txt'), robotsTxt, 'utf8');

console.log(`✅  Site département ${depNom} (${depCode}) → ${outPath}`);
console.log(`    Domaine : https://${url}`);
console.log(`    Sitemap : ${depBase}/sitemap.xml`);
console.log(`    Sous-domaines : à injecter via generate.js --depdir`);
