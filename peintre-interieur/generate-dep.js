#!/usr/bin/env node
/**
 * Générateur du site département peintre intérieur.
 * Domaine : peintre-interieur-{depCode}.fr
 *
 * Usage : node generate-dep.js --dep 33 --dep-nom Gironde
 * Output : output/{depCode}-{depNom}-dep/
 */

const fs   = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT_PARENT = path.resolve(__dirname, '..');

// ─── .env ────────────────────────────────────────────────────────────────────

function loadEnv(filePath) {
  const env = {};
  if (!fs.existsSync(filePath)) return env;
  fs.readFileSync(filePath, 'utf8').split('\n').forEach(line => {
    const t = line.trim();
    if (!t || t.startsWith('#')) return;
    const i = t.indexOf('=');
    if (i === -1) return;
    env[t.slice(0, i).trim()] = t.slice(i + 1).trim();
  });
  return env;
}
const ENV = { ...loadEnv(path.join(ROOT_PARENT, '.env')), ...loadEnv('.env') };

const TEL_DEFAULT      = '09 88 99 03 94';
const TEL_HREF_DEFAULT = '+33988990394';

const SUPABASE_JSON = JSON.stringify({
  directUrl: ENV.SUPABASE_URL || '',
  url:       ENV.SUPABASE_USE_RELATIVE_API === '1' ? '' : (ENV.SUPABASE_URL || ''),
  relative:  ENV.SUPABASE_USE_RELATIVE_API === '1',
  anon:      ENV.SUPABASE_ANON_KEY || '',
  table:     ENV.SUPABASE_TABLE_INTERIEUR || 'leads_interieur',
});

// ─── CLI ─────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const getArg = (n) => {
  const i = args.indexOf(n);
  if (i === -1) return null;
  const out = [];
  for (let j = i + 1; j < args.length; j++) {
    if (args[j].startsWith('--')) break;
    out.push(args[j]);
  }
  return out.length ? out.join(' ') : null;
};
const depCode = getArg('--dep');
const depNom  = getArg('--dep-nom');
if (!depCode || !depNom) {
  console.error('Usage : node generate-dep.js --dep <code> --dep-nom <nom>');
  process.exit(1);
}

function slugifyDep(s) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/['']/g, '-').replace(/\s+/g, '-')
    .replace(/-{2,}/g, '-').replace(/^-|-$/g, '');
}
function slugify(str) {
  return str.toLowerCase().replace(/['']/g, '-').replace(/\s+/g, '-')
    .replace(/-{2,}/g, '-').replace(/^-|-$/g, '');
}
function depCode2(dep) {
  const s = String(dep);
  if (s === '2A' || s === '2B') return s;
  if (s.length >= 3) return s;
  return s.padStart(2, '0');
}

const outDir = `${depCode}-${slugifyDep(depNom)}-dep`;
const outPath = path.join(__dirname, 'output', outDir);
const dep2 = depCode2(depCode);
const url  = `peintre-interieur-${dep2}.fr`;
const slug = String(depCode);

// ─── Formes grammaticales du département (réutilisé du parent) ───────────────

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
  '13': { a: "dans les Bouches-du-Rhône", de: "des Bouches-du-Rhône", le: "les Bouches-du-Rhône" },
  '14': { a: "dans le Calvados",     de: "du Calvados",       le: "le Calvados" },
  '20': { a: "en Corse",            de: "de Corse",           le: "la Corse" },
  '21': { a: "en Côte-d'Or",        de: "de Côte-d'Or",      le: "la Côte-d'Or" },
  '29': { a: "dans le Finistère",    de: "du Finistère",      le: "le Finistère" },
  '33': { a: "en Gironde",          de: "de Gironde",         le: "la Gironde" },
  '34': { a: "dans l'Hérault",      de: "de l'Hérault",      le: "l'Hérault" },
  '38': { a: "en Isère",            de: "d'Isère",           le: "l'Isère" },
  '44': { a: "en Loire-Atlantique", de: "de Loire-Atlantique", le: "la Loire-Atlantique" },
  '59': { a: "dans le Nord",         de: "du Nord",           le: "le Nord" },
  '69': { a: "dans le Rhône",        de: "du Rhône",          le: "le Rhône" },
  '75': { a: "à Paris",             de: "de Paris",           le: "Paris" },
  '83': { a: "dans le Var",          de: "du Var",            le: "le Var" },
  '92': { a: "dans les Hauts-de-Seine", de: "des Hauts-de-Seine", le: "les Hauts-de-Seine" },
};
function getDepFormes(code, nom) {
  const k1 = String(code), k2 = k1.replace(/^0+/, '');
  return DEP_FORMES[k1] || DEP_FORMES[k2] || { a: `en ${nom}`, de: `de ${nom}`, le: `le ${nom}` };
}

// ─── Lecture ─────────────────────────────────────────────────────────────────

const communes  = JSON.parse(fs.readFileSync(path.join(ROOT_PARENT, 'data', 'communes.json'), 'utf8'));
const variables = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'variables.json'), 'utf8'));
const template  = fs.readFileSync(path.join(__dirname, 'index-dep.html'), 'utf8');
const tplMentions = fs.readFileSync(path.join(__dirname, 'mentions-legales.html'), 'utf8');
const tplConfid   = fs.readFileSync(path.join(__dirname, 'politique-confidentialite.html'), 'utf8');

// ─── Utilitaires ─────────────────────────────────────────────────────────────

function replace(tpl, vars) {
  return tpl.replace(/\{\{([A-Z0-9_]+)\}\}/g, (m, k) => vars[k] !== undefined ? vars[k] : m);
}
function pickVariant(arr, seed, varKey) {
  const h = crypto.createHash('sha256').update(seed + '::' + (varKey || '')).digest();
  return arr[h.readUInt32BE(0) % arr.length];
}

// ─── Top 12 communes du département (par population) ─────────────────────────

const normDep = String(depCode).replace(/^0+/, '');
const depCommunes = communes
  .filter(c => String(c.dep_code).replace(/^0+/, '') === normDep)
  .filter(c => Number(c.population) > 0)
  .sort((a, b) => Number(b.population) - Number(a.population))
  .slice(0, 12);

function renderCommunesProches(list) {
  return list.map(c => {
    const cSlug = slugify(c.nom_sans_accent);
    const url = `${cSlug}.peintre-interieur-${dep2}.fr`;
    return `
          <a href="https://${url}" class="commune-card">
            <span class="commune-name">${c.nom_standard}</span>
          </a>`;
  }).join('\n');
}

// ─── Variables du site département ───────────────────────────────────────────

const depFormes = getDepFormes(depCode, depNom);
const marque = `Peintre intérieur ${depNom}`;

const staticVars = {
  COMMUNES_PROCHES: renderCommunesProches(depCommunes),
  NOM:          depNom,
  NOM_COMPLET:  depNom,
  NOM_A:        depFormes.a,
  NOM_DE:       depFormes.de,
  NOM_MAJ:      depNom.toUpperCase(),
  SLUG:         slug,
  CODE_POSTAL:  dep2 + '000',
  DEP_NOM:      depNom,
  DEP_NOM_A:    depFormes.a,
  DEP_NOM_DE:   depFormes.de,
  DEP_NOM_LE:   depFormes.le,
  DEP_CODE:     dep2,
  URL:          url,
  TEL:          TEL_DEFAULT,
  TEL_HREF:     TEL_HREF_DEFAULT,
  MARQUE:       marque,
  MARQUE_MAJ:   marque.toUpperCase(),
};

const dynVars = {};
Object.entries(variables).forEach(([key, variants]) => {
  if (!Array.isArray(variants)) return;
  const picked = pickVariant(variants, slug, key);
  if (typeof picked === 'string') {
    dynVars[key.toUpperCase()] = replace(picked, staticVars);
  }
});

const allVars = { ...staticVars, ...dynVars };

// ─── Génération ──────────────────────────────────────────────────────────────

fs.mkdirSync(outPath, { recursive: true });

let html = replace(template, allVars);
if (ENV.SUPABASE_ANON_KEY) {
  html = html.replace(
    /<script type="application\/json" id="supabase-config-json">[\s\S]*?<\/script>/,
    `<script type="application/json" id="supabase-config-json">${SUPABASE_JSON}</script>`
  );
}
fs.writeFileSync(path.join(outPath, 'index.html'), html, 'utf8');
fs.writeFileSync(path.join(outPath, 'mentions-legales.html'), replace(tplMentions, allVars), 'utf8');
fs.writeFileSync(path.join(outPath, 'politique-confidentialite.html'), replace(tplConfid, allVars), 'utf8');
// CSS minifié (gain ~25-30% sur la taille)
const cssRaw = fs.readFileSync(path.join(__dirname, 'style.css'), 'utf8');
const cssMin = cssRaw
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\s+/g, ' ')
  .replace(/\s*([{}:;,>+~])\s*/g, '$1')
  .replace(/;}/g, '}')
  .replace(/\s*\n\s*/g, '')
  .trim();
fs.writeFileSync(path.join(outPath, 'style.css'), cssMin, 'utf8');

// Assets
const imgOut = path.join(outPath, 'public', 'images');
const jsOut  = path.join(outPath, 'public', 'js');
fs.mkdirSync(imgOut, { recursive: true });
fs.mkdirSync(jsOut,  { recursive: true });
const srcImg = path.join(__dirname, 'public', 'images');
if (fs.existsSync(srcImg)) {
  fs.readdirSync(srcImg).forEach(f => {
    const s = path.join(srcImg, f);
    if (fs.statSync(s).isFile()) fs.copyFileSync(s, path.join(imgOut, f));
  });
}
const srcJs = path.join(__dirname, 'public', 'js');
if (fs.existsSync(srcJs)) {
  fs.readdirSync(srcJs).forEach(f => fs.copyFileSync(path.join(srcJs, f), path.join(jsOut, f)));
}

// Sitemap : 3 pages (home + légales)
const today = new Date().toISOString().slice(0, 10);
const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://${url}/</loc><lastmod>${today}</lastmod><changefreq>monthly</changefreq><priority>1.0</priority></url>
  <url><loc>https://${url}/mentions-legales.html</loc><lastmod>${today}</lastmod><changefreq>yearly</changefreq><priority>0.2</priority></url>
  <url><loc>https://${url}/politique-confidentialite.html</loc><lastmod>${today}</lastmod><changefreq>yearly</changefreq><priority>0.2</priority></url>
</urlset>`;
fs.writeFileSync(path.join(outPath, 'sitemap.xml'), sitemap, 'utf8');
fs.writeFileSync(path.join(outPath, 'robots.txt'), `User-agent: *\nAllow: /\nSitemap: https://${url}/sitemap.xml\n`, 'utf8');

console.log(`✅  Site département ${depNom} (${depCode}) → ${outPath}`);
console.log(`    Domaine : https://${url}`);
