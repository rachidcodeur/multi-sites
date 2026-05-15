#!/usr/bin/env node
/**
 * Génère une version "audit" de l'index Abzac : chaque bloc variable
 * affiche LES 5 VARIANTES empilées, chacune avec une couleur distincte.
 * Sortie : couvreur/output/33-gironde/abzac/index-highlighted.html
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = __dirname;
const SLUG = 'abzac';
const DEP_CODE = '33';
const DEP_NOM = 'Gironde';

const variables = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'variables.json'), 'utf8'));
const communes  = JSON.parse(fs.readFileSync(path.join(ROOT, '..', 'data', 'communes.json'), 'utf8'));

const commune = communes.find(c => {
  const slug = String(c.nom_sans_accent).toLowerCase()
    .replace(/['']/g, '-').replace(/\s+/g, '-')
    .replace(/-{2,}/g, '-').replace(/^-|-$/g, '');
  return slug === SLUG && String(c.dep_code).replace(/^0+/, '') === DEP_CODE.replace(/^0+/, '');
});
if (!commune) { console.error('Commune introuvable'); process.exit(1); }

function pickVariant(arr, seed, varKey) {
  const h = crypto.createHash('sha256').update(seed + '::' + (varKey || '')).digest();
  return arr[h.readUInt32BE(0) % arr.length];
}

const DEP_FORMES = { '33': { a: 'en Gironde', de: 'de la Gironde', le: 'la Gironde' } };
const depF = DEP_FORMES[DEP_CODE];

const NOM_A   = Array.isArray(commune.nom_a_variantes) && commune.nom_a_variantes.length
                  ? pickVariant(commune.nom_a_variantes, SLUG, 'nom_a') : commune.nom_a;
const NOM_DE  = Array.isArray(commune.nom_de_variantes) && commune.nom_de_variantes.length
                  ? pickVariant(commune.nom_de_variantes, SLUG, 'nom_de') : commune.nom_de;

const subs = {
  NOM:          commune.nom_sans_pronom,
  NOM_COMPLET:  commune.nom_standard,
  NOM_A,
  NOM_DE,
  NOM_MAJ:      commune.nom_standard_majuscule,
  DEP_NOM:      DEP_NOM,
  DEP_NOM_LE:   depF.le,
  DEP_NOM_DE:   depF.de,
  DEP_NOM_A:    depF.a,
  CODE_POSTAL:  String(commune.code_postal).padStart(5, '0'),
  MARQUE:       'Couvreur ' + commune.nom_standard,
};

function substitute(text) {
  return text.replace(/\{\{([A-Z0-9_]+)\}\}/g, (m, k) => subs[k] !== undefined ? subs[k] : m);
}

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const htmlPath = path.join(ROOT, 'output', `${DEP_CODE}-gironde`, SLUG, 'index.html');
let html = fs.readFileSync(htmlPath, 'utf8');

// 5 couleurs distinctes pour les 5 variantes (codes pastel doux)
const VARIANT_COLORS = [
  { bg: '#fff3bf', border: '#fab005', label: '1' },  // jaune
  { bg: '#ffd8a8', border: '#fd7e14', label: '2' },  // orange
  { bg: '#ffc9c9', border: '#fa5252', label: '3' },  // rouge
  { bg: '#a5d8ff', border: '#228be6', label: '4' },  // bleu
  { bg: '#b2f2bb', border: '#37b24d', label: '5' },  // vert
];

const summary = [];

Object.keys(variables).forEach(key => {
  if (key.startsWith('_')) return;
  const arr = variables[key];
  if (!Array.isArray(arr)) return;

  const pickedRaw = pickVariant(arr, SLUG, key);
  const pickedIdx = arr.indexOf(pickedRaw);
  const pickedRendered = substitute(pickedRaw);

  if (!html.includes(pickedRendered)) {
    summary.push({ key, picked: pickedIdx + 1, found: false });
    return;
  }

  // Génère le bloc "stack" avec toutes les variantes empilées
  const stackHtml = `<span class="var-stack" data-var="${key}"><span class="var-stack-label">${key.replace('var_', '').toUpperCase()}</span>` +
    arr.map((v, i) => {
      const color = VARIANT_COLORS[i % VARIANT_COLORS.length];
      const isChosen = i === pickedIdx;
      const text = escapeHtml(substitute(v));
      return `<span class="var-line${isChosen ? ' var-line--chosen' : ''}" style="background:${color.bg};border-left:4px solid ${color.border};">` +
             `<span class="var-num" style="background:${color.border};">${color.label}${isChosen ? ' ✓' : ''}</span>` +
             text +
             `</span>`;
    }).join('') +
    `</span>`;

  html = html.replace(pickedRendered, stackHtml);
  summary.push({ key, picked: pickedIdx + 1, total: arr.length, found: true });
});

const auditCSS = `
<style>
  .audit-banner {
    position: sticky;
    top: 0;
    z-index: 9999;
    background: #1a1a1a;
    color: #fff;
    padding: 10px 24px;
    font-family: -apple-system, sans-serif;
    font-size: 13px;
    text-align: center;
    border-bottom: 3px solid #fab005;
  }
  .audit-banner strong { color: #fab005; }
  .audit-banner .legend {
    font-size: 11px;
    margin-top: 6px;
    display: flex;
    justify-content: center;
    gap: 8px;
    flex-wrap: wrap;
  }
  .audit-banner .legend span {
    padding: 2px 10px;
    border-radius: 4px;
    color: #1a1a1a;
    font-weight: 600;
  }
  .var-stack {
    display: block;
    margin: 8px 0;
    padding: 8px;
    background: #f8f9fa;
    border: 1px dashed #adb5bd;
    border-radius: 6px;
  }
  .var-stack-label {
    display: inline-block;
    background: #1a1a1a;
    color: #fab005;
    font-family: 'SF Mono', Menlo, monospace;
    font-size: 10px;
    font-weight: 700;
    padding: 3px 8px;
    border-radius: 4px;
    margin-bottom: 8px;
    letter-spacing: 0.05em;
  }
  .var-line {
    display: block;
    padding: 8px 10px 8px 12px;
    margin: 4px 0;
    border-radius: 4px;
    font-size: 0.92em;
    line-height: 1.55;
    color: #1a1a1a;
    position: relative;
  }
  .var-line--chosen {
    box-shadow: 0 0 0 2px #1a1a1a;
    font-weight: 500;
  }
  .var-num {
    display: inline-block;
    color: #fff;
    font-size: 11px;
    font-weight: 700;
    padding: 2px 8px;
    border-radius: 99px;
    margin-right: 8px;
    vertical-align: middle;
    min-width: 18px;
    text-align: center;
  }
</style>
`;

const banner = `
<div class="audit-banner">
  <strong>Page audit Abzac</strong> · ${summary.filter(s=>s.found).length}/${summary.length} variables empilées · ✓ = variante actuellement affichée
  <div class="legend">
    <span style="background:#fff3bf;">1 jaune</span>
    <span style="background:#ffd8a8;">2 orange</span>
    <span style="background:#ffc9c9;">3 rouge</span>
    <span style="background:#a5d8ff;">4 bleu</span>
    <span style="background:#b2f2bb;">5 vert</span>
  </div>
</div>
`;

html = html.replace('</head>', auditCSS + '</head>');
html = html.replace('<body>', '<body>' + banner);

const outPath = path.join(ROOT, 'output', `${DEP_CODE}-gironde`, SLUG, 'index-highlighted.html');
fs.writeFileSync(outPath, html, 'utf8');

console.log(`✅ Page audit générée : ${outPath}\n`);
console.log('Résumé :');
summary.forEach(s => {
  const status = s.found ? '✅' : '❌';
  console.log(`  ${status} ${s.key.padEnd(28)} → ${s.total || 5} variantes empilées, ${s.picked} marquée ✓`);
});
