#!/usr/bin/env node
/**
 * Génère les 3 commandes de génération + déploiement pour un département.
 *
 * Usage : node cmd.js 06
 *         node cmd.js 33
 *         node cmd.js 2A
 */

const fs = require('fs');
const path = require('path');

const arg = process.argv[2];
if (!arg) {
  console.error('Usage : node cmd.js <code_departement>');
  console.error('Exemples : node cmd.js 06   |   node cmd.js 33   |   node cmd.js 2A');
  process.exit(1);
}

// Retire les accents et remplace les apostrophes par des tirets, en gardant la casse
function stripAccents(str) {
  return str.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/['']/g, '-');
}

// Slug : minuscules, sans accents, tirets pour espaces et apostrophes
function slugify(str) {
  return stripAccents(str)
    .toLowerCase()
    .replace(/['']/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '');
}

// Cherche le nom du département dans communes.json (à la racine du projet)
const communesPath = path.join(__dirname, '..', 'data', 'communes.json');
const communes = JSON.parse(fs.readFileSync(communesPath, 'utf8'));
const normDep = String(arg).replace(/^0+/, '');
const match = communes.find(c => String(c.dep_code).replace(/^0+/, '') === normDep);

if (!match) {
  console.error(`❌  Département "${arg}" introuvable dans data/communes.json`);
  process.exit(1);
}

const depCode = arg;
const depNom  = stripAccents(match.dep_nom);     // "Côte-d'Or" → "Cote-d'Or"
const slug    = slugify(match.dep_nom);          // "Côte-d'Or" → "cote-d-or"
const dirCity = `${depCode}-${slug}`;            // "06-alpes-maritimes"
const dirDep  = `${depCode}-${slug}-dep`;        // "06-alpes-maritimes-dep"

const cmd1 = `cd peintre-en-batiment && node generate-dep.js --dep ${depCode} --dep-nom ${depNom}`;
const cmd2 = `cd peintre-en-batiment && node generate.js --dep ${depCode} --dep-nom ${depNom}`;
const cmd3 = `cd peintre-en-batiment && node deploy.js --dep ${depCode} --dep-nom ${depNom} --with-dep \\\n  --local-villes output/${dirCity} \\\n  --remote-villes /var/www/peintres/${slug} \\\n  --local-dep output/${dirDep} \\\n  --remote-dep /var/www/peintre-en-batiment-${depCode} \\\n  --server root@204.168.224.81`;
const combo = `cd peintre-en-batiment && node generate-dep.js --dep ${depCode} --dep-nom ${depNom} && node generate.js --dep ${depCode} --dep-nom ${depNom} && node deploy.js --dep ${depCode} --dep-nom ${depNom} --with-dep \\\n  --local-villes output/${dirCity} \\\n  --remote-villes /var/www/peintres/${slug} \\\n  --local-dep output/${dirDep} \\\n  --remote-dep /var/www/peintre-en-batiment-${depCode} \\\n  --server root@204.168.224.81`;

console.log('');
console.log(`# Département ${depNom} (${depCode})`);
console.log('');
console.log('── 1. Site département ──');
console.log(cmd1);
console.log('');
console.log('── 2. Sites villes ──');
console.log(cmd2);
console.log('');
console.log('── 3. Déploiement ──');
console.log(cmd3);
console.log('');
console.log('── TOUT EN UNE COMMANDE ──');
console.log(combo);
console.log('');
