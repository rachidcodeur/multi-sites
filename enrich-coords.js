#!/usr/bin/env node
/**
 * Télécharge les coordonnées GPS de toutes les communes de France via
 * geo.api.gouv.fr et les ajoute dans data/communes.json (champs lat/lon).
 *
 * À lancer une fois (~5 secondes pour 35 000 communes), puis les générateurs
 * peuvent calculer les communes proches localement.
 *
 * Usage : node enrich-coords.js
 */

const fs   = require('fs');
const path = require('path');
const https = require('https');

const COMMUNES_PATH = path.join(__dirname, 'data', 'communes.json');
const API = 'https://geo.api.gouv.fr/communes?fields=code,centre,codesPostaux,codeDepartement,population&format=json';

function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'peintres-france/1.0' } }, (res) => {
      let buf = '';
      res.on('data', c => buf += c);
      res.on('end', () => {
        try { resolve(JSON.parse(buf)); } catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

(async () => {
  console.log('📡  Téléchargement des coordonnées GPS de toutes les communes…');
  const t0 = Date.now();
  // On télécharge avec le nom (besoin pour matcher)
  const apiUrl = 'https://geo.api.gouv.fr/communes?fields=nom,code,centre,codesPostaux,codeDepartement,population&format=json';
  const apiCommunes = await fetchJSON(apiUrl);
  console.log(`✅  ${apiCommunes.length.toLocaleString('fr-FR')} communes API en ${((Date.now() - t0)/1000).toFixed(1)}s`);

  console.log('📂  Lecture de data/communes.json…');
  const communes = JSON.parse(fs.readFileSync(COMMUNES_PATH, 'utf8'));

  // Normalisation pour matching nom + dep (gère accents, apostrophes, tirets)
  function norm(s) {
    return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/['']/g, '-')
      .replace(/\s+/g, '-')
      .replace(/-{2,}/g, '-')
      .trim();
  }

  // Index API par "nom_normalisé:dep" (avec entrée additionnelle pour Corse 2A/2B → 20)
  const byNomDep = {};
  apiCommunes.forEach(c => {
    if (!c.centre || !Array.isArray(c.centre.coordinates) || !c.codeDepartement) return;
    const dep = c.codeDepartement.replace(/^0+/, '');
    const k = norm(c.nom) + ':' + dep;
    const entry = { lat: c.centre.coordinates[1], lon: c.centre.coordinates[0] };
    if (!byNomDep[k]) byNomDep[k] = entry;
    // Pour Corse, indexer aussi sous '20'
    if (dep === '2A' || dep === '2B') {
      const k20 = norm(c.nom) + ':20';
      if (!byNomDep[k20]) byNomDep[k20] = entry;
    }
  });

  let matched = 0, skipped = 0;
  const skippedNames = [];
  communes.forEach(c => {
    const dep = String(c.dep_code).replace(/^0+/, '');
    const k = norm(c.nom_standard) + ':' + dep;
    const apiC = byNomDep[k];
    if (apiC) {
      c.lat = apiC.lat;
      c.lon = apiC.lon;
      matched++;
    } else {
      skipped++;
      if (skippedNames.length < 5) skippedNames.push(`${c.nom_standard} (${c.dep_code})`);
    }
  });
  if (skipped > 0) console.log('   Exemples non matchés :', skippedNames.join(', '), skipped > 5 ? '…' : '');

  console.log(`✅  Coordonnées ajoutées : ${matched} (${skipped} non matchées)`);

  fs.writeFileSync(COMMUNES_PATH, JSON.stringify(communes, null, 2), 'utf8');
  console.log('💾  data/communes.json mis à jour');
})().catch(e => {
  console.error('❌  Erreur :', e.message);
  process.exit(1);
});
