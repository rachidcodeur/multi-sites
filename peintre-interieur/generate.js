#!/usr/bin/env node
/**
 * Générateur de sites peintre intérieur par commune.
 * Domaine : {slug}.peintre-interieur.fr (national, pas de département dans l'URL)
 *
 * Usage : node generate.js --dep <code> --dep-nom <nom>
 *   Lit la liste des villes depuis ../json-communes/communes_<dep>.json
 *   (fallback sur ../data/batch.json si le fichier n'existe pas)
 */

const fs   = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT_PARENT = path.resolve(__dirname, '..');

// ─── Lecture du .env (parent ou local) ───────────────────────────────────────

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

// ─── Arguments CLI ───────────────────────────────────────────────────────────

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
const depCode  = getArg('--dep');
const depNomArg = getArg('--dep-nom');
const villesArg = getArg('--villes'); // mode delta : liste de communes manquantes (séparées par virgule)

if (!depCode || !depNomArg) {
  console.error('Usage : node generate.js --dep <code> --dep-nom <nom> [--villes "Ville1,Ville2,..."]');
  console.error('Exemple : node generate.js --dep 33 --dep-nom Gironde');
  console.error('Mode delta : node generate.js --dep 33 --dep-nom Gironde --villes "Mérignac,Lacanau"');
  process.exit(1);
}

function slugifyDep(s) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/['']/g, '-').replace(/\s+/g, '-')
    .replace(/-{2,}/g, '-').replace(/^-|-$/g, '');
}
const outDir = `${depCode}-${slugifyDep(depNomArg)}`;
const normDep = String(depCode).replace(/^0+/, '');

// ─── Lecture des fichiers ─────────────────────────────────────────────────────

const communes  = JSON.parse(fs.readFileSync(path.join(ROOT_PARENT, 'data', 'communes.json'), 'utf8'));
const variables = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'variables.json'), 'utf8'));

// Charge la liste des villes : prioritairement depuis json-communes/communes_XX.json
const depPad = (() => {
  const s = String(depCode).toUpperCase();
  if (s === '2A' || s === '2B') return '20'; // Corse fusionnée en dept 20
  if (s.length >= 3) return s;
  return s.padStart(2, '0');
})();
const communesFile = path.join(ROOT_PARENT, 'json-communes', `communes_${depPad}.json`);
let batch;

if (villesArg) {
  // Mode delta : on génère uniquement les villes listées en CLI
  const villesList = villesArg.split(',').map(s => s.trim()).filter(Boolean);
  batch = { _note: `Mode delta — ${villesList.length} villes`, villes: villesList };
  console.log(`🎯 Mode delta : ${villesList.length} ville(s) à générer dans le dept ${depPad}`);

  // Append au fichier json-communes (en évitant les doublons) pour les futures regen
  if (fs.existsSync(communesFile)) {
    try {
      const existing = JSON.parse(fs.readFileSync(communesFile, 'utf8'));
      const existingNorm = new Set((existing.villes || []).map(v => v.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()));
      const added = [];
      villesList.forEach(v => {
        const norm = v.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
        if (!existingNorm.has(norm)) {
          existing.villes.push(v);
          added.push(v);
        }
      });
      if (added.length) {
        existing.villes.sort((a, b) => a.localeCompare(b, 'fr'));
        fs.writeFileSync(communesFile, JSON.stringify(existing, null, 2));
        console.log(`📝 ${added.length} ville(s) ajoutée(s) à json-communes/communes_${depPad}.json : ${added.join(', ')}`);
      }
    } catch (e) {
      console.warn(`⚠️   Impossible de mettre à jour json-communes/communes_${depPad}.json :`, e.message);
    }
  }
} else if (fs.existsSync(communesFile)) {
  batch = JSON.parse(fs.readFileSync(communesFile, 'utf8'));
  console.log(`📂 ${batch.villes.length} communes chargées depuis json-communes/communes_${depPad}.json`);
} else {
  console.warn(`⚠️   json-communes/communes_${depPad}.json introuvable — fallback sur data/batch.json`);
  batch = JSON.parse(fs.readFileSync(path.join(ROOT_PARENT, 'data', 'batch.json'), 'utf8'));
}

const template  = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');

// ─── Index des communes ──────────────────────────────────────────────────────

const communeIndex = {};
communes.forEach(c => {
  [normalise(c.nom_standard), normalise(c.nom_sans_pronom), normalise(c.nom_sans_accent)].forEach(key => {
    if (!key) return;
    if (!communeIndex[key]) communeIndex[key] = [];
    if (!communeIndex[key].includes(c)) communeIndex[key].push(c);
  });
});

// Normalise : minuscules, sans accents, tirets/espaces/apostrophes tous équivalents — pour matcher quel que soit l'orthographe saisie
function normalise(str) {
  return String(str)
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/['']/g, ' ')              // apostrophes → espace
    .replace(/[\s\-_]+/g, ' ')           // espaces, tirets, underscores → espace simple
    .trim();
}

// ─── Utilitaires ─────────────────────────────────────────────────────────────

function replace(tpl, vars) {
  return tpl.replace(/\{\{([A-Z0-9_]+)\}\}/g, (m, k) => vars[k] !== undefined ? vars[k] : m);
}

function pickVariant(arr, seed, varKey) {
  const h = crypto.createHash('sha256').update(seed + '::' + (varKey || '')).digest();
  return arr[h.readUInt32BE(0) % arr.length];
}

function slugify(str) {
  return str.toLowerCase()
    .replace(/['']/g, '-').replace(/\s+/g, '-')
    .replace(/-{2,}/g, '-').replace(/^-|-$/g, '');
}

// Code département au format 2 chiffres (sauf Corse 2A/2B et DOM 971-976)
function depCode2(dep) {
  const s = String(dep);
  if (s === '2A' || s === '2B') return s;
  if (s.length >= 3) return s; // 971, 972, etc.
  return s.padStart(2, '0');
}

function buildSiteUrl(commune) {
  return `${slugify(commune.nom_sans_accent)}.peintre-interieur-${depCode2(commune.dep_code)}.fr`;
}
function buildUrl(commune)   { return buildSiteUrl(commune); }
function buildMarque(commune){ return `Peintre intérieur ${commune.nom_standard}`; }

// Minification CSS rapide (commentaires + espaces inutiles)
function minifyCss(css) {
  return css
    .replace(/\/\*[\s\S]*?\*\//g, '')           // commentaires
    .replace(/\s+/g, ' ')                       // espaces multiples → simple
    .replace(/\s*([{}:;,>+~])\s*/g, '$1')       // espaces autour symboles
    .replace(/;}/g, '}')                        // dernier ; avant }
    .replace(/\s*\n\s*/g, '')                   // sauts de ligne
    .trim();
}

let cachedMinifiedCss = null;
function getMinifiedCss() {
  if (cachedMinifiedCss === null) {
    cachedMinifiedCss = minifyCss(fs.readFileSync(path.join(__dirname, 'style.css'), 'utf8'));
  }
  return cachedMinifiedCss;
}

// Distance haversine en kilomètres
function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const toRad = d => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat/2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon/2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/**
 * Trouve les N communes les plus proches d'une commune source (par lat/lon).
 * Renvoie un tableau trié par distance croissante, exclut la source elle-même.
 */
function nearestCommunes(source, allCommunes, n) {
  if (typeof source.lat !== 'number' || typeof source.lon !== 'number') return [];
  const candidates = [];
  for (const c of allCommunes) {
    if (c === source) continue;
    if (typeof c.lat !== 'number' || typeof c.lon !== 'number') continue;
    if (c.nom_standard === source.nom_standard && c.code_postal === source.code_postal) continue;
    const d = haversine(source.lat, source.lon, c.lat, c.lon);
    candidates.push({ c, d });
  }
  candidates.sort((a, b) => a.d - b.d);
  return candidates.slice(0, n).map(({ c, d }) => ({
    nom: c.nom_standard,
    code_postal: String(c.code_postal).padStart(5, '0'),
    distance: Math.round(d * 10) / 10,
    url: buildSiteUrl(c),
  }));
}

function renderCommunesProches(communesList) {
  return communesList.map(p => `
          <a href="https://${p.url}" class="commune-card">
            <span class="commune-name">${p.nom}</span>
          </a>`).join('\n');
}

// ─── Construction des variables par commune ──────────────────────────────────

function buildVars(commune) {
  const slug   = slugify(commune.nom_sans_accent);
  const url    = buildUrl(commune);
  const marque = buildMarque(commune);

  // Communes proches (12 plus proches) — calcul haversine local
  const proches = nearestCommunes(commune, communes, 12);
  const communesProchesHtml = renderCommunesProches(proches);

  const staticVars = {
    COMMUNES_PROCHES: communesProchesHtml,
    NOM:          commune.nom_sans_pronom,
    NOM_COMPLET:  commune.nom_standard,
    NOM_A:        Array.isArray(commune.nom_a_variantes) && commune.nom_a_variantes.length > 0
                    ? pickVariant(commune.nom_a_variantes, slug, 'nom_a')
                    : commune.nom_a,
    NOM_DE:       Array.isArray(commune.nom_de_variantes) && commune.nom_de_variantes.length > 0
                    ? pickVariant(commune.nom_de_variantes, slug, 'nom_de')
                    : commune.nom_de,
    NOM_MAJ:      commune.nom_standard_majuscule,
    SLUG:         slug,
    CODE_POSTAL:  String(commune.code_postal).padStart(5, '0'),
    DEP_NOM:      commune.dep_nom,
    DEP_CODE:     String(commune.dep_code),
    URL:          url,
    TEL:          TEL_DEFAULT,
    TEL_HREF:     TEL_HREF_DEFAULT,
    MARQUE:       marque,
    MARQUE_MAJ:   marque.toUpperCase(),
  };

  const dynVars = {};
  Object.entries(variables).forEach(([key, variants]) => {
    if (!Array.isArray(variants)) return;
    const varKey = key.toUpperCase();
    const picked = pickVariant(variants, slug, key);
    if (typeof picked === 'string') {
      dynVars[varKey] = replace(picked, staticVars);
    }
  });

  return { ...staticVars, ...dynVars };
}

// ─── Génération ──────────────────────────────────────────────────────────────

const outputBase = path.join(__dirname, 'output', outDir);
let generated = 0, skipped = 0;
const generatedUrls = [];

batch.villes.forEach(villeNom => {
  const matches = communeIndex[normalise(villeNom)] || [];
  // Filtre par dep_code (normalisé sans zéro de tête)
  const commune = matches.find(c => String(c.dep_code).replace(/^0+/, '') === normDep);
  if (!commune) {
    if (matches.length > 0) {
      console.warn(`⚠️   "${villeNom}" introuvable dans le département ${depCode} (existe dans : ${[...new Set(matches.map(c => c.dep_code))].join(', ')})`);
    } else {
      console.warn(`⚠️   "${villeNom}" introuvable dans communes.json`);
    }
    skipped++; return;
  }

  const slug    = slugify(commune.nom_sans_accent);
  const outPath = path.join(outputBase, slug);
  const allVars = buildVars(commune);

  let html = replace(template, allVars);

  if (ENV.SUPABASE_ANON_KEY) {
    html = html.replace(
      /<script type="application\/json" id="supabase-config-json">[\s\S]*?<\/script>/,
      `<script type="application/json" id="supabase-config-json">${SUPABASE_JSON}</script>`
    );
  }

  fs.mkdirSync(outPath, { recursive: true });
  fs.writeFileSync(path.join(outPath, 'index.html'), html, 'utf8');

  // Sitemap par site (1 URL)
  const today = new Date().toISOString().slice(0, 10);
  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://${allVars.URL}/</loc><lastmod>${today}</lastmod><changefreq>monthly</changefreq><priority>1.0</priority></url>
</urlset>`;
  fs.writeFileSync(path.join(outPath, 'sitemap.xml'), sitemap, 'utf8');

  // robots.txt
  fs.writeFileSync(
    path.join(outPath, 'robots.txt'),
    `User-agent: *\nAllow: /\nSitemap: https://${allVars.URL}/sitemap.xml\n`,
    'utf8'
  );

  // CSS minifié + assets
  fs.writeFileSync(path.join(outPath, 'style.css'), getMinifiedCss(), 'utf8');

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

  generatedUrls.push(`https://${allVars.URL}`);
  console.log(`✅  ${commune.nom_standard.padEnd(30)} → output/${slug}`);
  generated++;
});

console.log(`\nTerminé : ${generated} site(s) généré(s), ${skipped} ignoré(s).`);
