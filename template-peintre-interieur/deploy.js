#!/usr/bin/env node
/**
 * Déploiement des sites peintre intérieur (villes + département).
 *
 * Usage :
 *   node deploy.js --dep 33 --dep-nom Gironde --with-dep
 *
 * Options :
 *   --dep              Code département (obligatoire)
 *   --dep-nom          Nom département (obligatoire)
 *   --server           Serveur SSH (défaut : ubuntu@137.74.112.253)
 *   --local-villes     Dossier local sites villes (défaut : output/{code}-{nom})
 *   --remote-villes    Dossier distant villes (défaut : /var/www/peintres/{nom})
 *   --local-dep        Dossier local site département (défaut : output/{code}-{nom}-dep)
 *   --remote-dep       Dossier distant site dept (défaut : /var/www/peintre-interieur-{code})
 *   --with-dep         Déployer aussi le site département (sinon ignoré)
 *   --skip-villes      Ne pas déployer les villes
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

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
const hasFlag = (n) => args.includes(n);

const depCode = getArg('--dep');
const depNom  = getArg('--dep-nom');

if (!depCode || !depNom) {
  console.error('Usage : node deploy.js --dep <code> --dep-nom <nom> [options]');
  console.error('Exemple : node deploy.js --dep 33 --dep-nom Gironde --with-dep');
  process.exit(1);
}

function slugifyDep(s) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/['']/g, '-').replace(/\s+/g, '-')
    .replace(/-{2,}/g, '-').replace(/^-|-$/g, '');
}
function depCode2(dep) {
  const s = String(dep);
  if (s === '2A' || s === '2B') return s;
  if (s.length >= 3) return s;
  return s.padStart(2, '0');
}

const slug = slugifyDep(depNom);
const dep2 = depCode2(depCode);

const server      = getArg('--server')        || 'ubuntu@137.74.112.253';
const localVilles = getArg('--local-villes')  || `output/${depCode}-${slug}`;
const localDep    = getArg('--local-dep')     || `output/${depCode}-${slug}-dep`;
const remoteVilles= getArg('--remote-villes') || `/var/www/peintres/${slug}`;
const remoteDep   = getArg('--remote-dep')    || `/var/www/peintre-interieur-${dep2}`;
const skipVilles  = hasFlag('--skip-villes');
const skipDep     = !hasFlag('--with-dep');

// ─── Détection rsync / scp ───────────────────────────────────────────────────

function hasCommand(cmd) {
  try {
    const probe = process.platform === 'win32' ? `where ${cmd}` : `command -v ${cmd}`;
    execSync(probe, { stdio: 'ignore' });
    return true;
  } catch { return false; }
}

const USE_RSYNC = hasCommand('rsync');
const USE_SCP   = !USE_RSYNC && hasCommand('scp');

if (!USE_RSYNC && !USE_SCP) {
  console.error('❌  Ni rsync ni scp détectés. Installe OpenSSH ou Git Bash.');
  process.exit(1);
}

function prepareRemote(remotePath) {
  // Crée le dossier distant si manquant + force ubuntu:www-data + perms écriture
  // Nécessite : ubuntu a NOPASSWD sudo pour chown/chmod sur /var/www (cf /etc/sudoers.d/ubuntu-www)
  const cmd = [
    `sudo mkdir -p '${remotePath}'`,
    `sudo chown -R ubuntu:www-data /var/www`,
    `sudo chmod -R u+rwX,g+rX /var/www`,
  ].join(' && ');
  try {
    execSync(`ssh "${server}" "${cmd}"`, { stdio: 'pipe' });
  } catch (e) {
    console.warn(`⚠️   prepareRemote a échoué (sudo NOPASSWD probablement non configuré). Lance le chown manuellement.`);
  }
}

function uploadFolder(localPath, remotePath, label) {
  prepareRemote(remotePath);
  if (USE_RSYNC) {
    console.log(`\n📦  rsync ${label} → ${server}:${remotePath}/`);
    execSync(`rsync -avz "${localPath}/" "${server}:${remotePath}/"`, { stdio: 'inherit' });
  } else {
    console.log(`\n📦  scp ${label} → ${server}:${remotePath}/`);
    execSync(`scp -r "${localPath}"/* "${server}:${remotePath}/"`, { stdio: 'inherit' });
  }
}

// ─── Résumé ──────────────────────────────────────────────────────────────────

console.log('');
console.log('╔══════════════════════════════════════════════════════════╗');
console.log('║         DÉPLOIEMENT PEINTRE INTÉRIEUR                   ║');
console.log('╚══════════════════════════════════════════════════════════╝');
console.log(`  Département :    ${depNom} (${depCode})`);
console.log(`  Serveur :        ${server}`);
if (!skipDep) {
  console.log(`  Site département :`);
  console.log(`    Local  → ${localDep}/`);
  console.log(`    Distant → ${server}:${remoteDep}/`);
} else {
  console.log(`  Site département : IGNORÉ (ajouter --with-dep)`);
}
if (!skipVilles) {
  console.log(`  Sites villes :`);
  console.log(`    Local  → ${localVilles}/`);
  console.log(`    Distant → ${server}:${remoteVilles}/`);
} else {
  console.log(`  Sites villes : IGNORÉ (--skip-villes)`);
}
console.log('─'.repeat(58));

// ─── Déploiement ─────────────────────────────────────────────────────────────

if (!skipDep) {
  if (fs.existsSync(localDep)) {
    try { uploadFolder(localDep, remoteDep, 'site département'); }
    catch (e) { console.error('❌  Erreur upload département :', e.message); }
  } else {
    console.log(`\n⚠️  Dossier local introuvable : ${localDep}`);
  }
}

// ─── Détection des villes (avant upload) ─────────────────────────────────────

let citiesAdded = []; // Nouvelles villes (pour le dashboard)
let citiesAll   = []; // Toutes les villes du dept (pour le push Sheet — état complet)
const ROOT_PARENT = path.resolve(__dirname, '..');
const dashboardDir = path.join(ROOT_PARENT, 'dashboard-peintre', 'interieur');
const deployedPath = path.join(dashboardDir, 'deployed.json');
const hasDashboard = fs.existsSync(dashboardDir);

if (!skipVilles && fs.existsSync(localVilles) && hasDashboard) {
  let deployed = {};
  if (fs.existsSync(deployedPath)) {
    deployed = JSON.parse(fs.readFileSync(deployedPath, 'utf8'));
  }
  const cities = fs.readdirSync(localVilles).filter(f =>
    fs.statSync(path.join(localVilles, f)).isDirectory()
  ).sort();
  // Toujours utiliser le code padé sur 2 chiffres comme clé pour éviter les doublons '1' vs '01'
  if (!deployed[dep2]) deployed[dep2] = { nom: depNom, cities: [] };
  const previousSet = new Set(deployed[dep2].cities || []);
  citiesAdded = cities.filter(c => !previousSet.has(c));
  cities.forEach(c => previousSet.add(c));
  deployed[dep2].nom = depNom;
  deployed[dep2].cities = [...previousSet].sort();
  citiesAll = deployed[dep2].cities;
  fs.writeFileSync(deployedPath, JSON.stringify(deployed, null, 2), 'utf8');
  console.log(`\n📊  deployed.json → ${citiesAll.length} villes pour ${depNom} (${depCode}) (+${citiesAdded.length} nouvelles)`);

  // Régénération du dashboard
  try {
    execSync('node dashboard-peintre/interieur/generate-dashboard.js', {
      cwd: ROOT_PARENT,
      stdio: 'inherit'
    });
  } catch (e) {
    console.warn('⚠️  Dashboard non régénéré :', e.message);
  }
} else if (!skipVilles && fs.existsSync(localVilles)) {
  // Fallback si dashboard absent : on prend toutes les villes
  citiesAll = fs.readdirSync(localVilles).filter(f =>
    fs.statSync(path.join(localVilles, f)).isDirectory()
  ).sort();
  citiesAdded = citiesAll;
}

// ─── Upload villes ───────────────────────────────────────────────────────────

if (!skipVilles) {
  if (fs.existsSync(localVilles)) {
    try { uploadFolder(localVilles, remoteVilles, 'sites villes'); }
    catch (e) { console.error('❌  Erreur upload villes :', e.message); }
  } else {
    console.log(`\n⚠️  Dossier local introuvable : ${localVilles}`);
  }
}

// ─── Push vers Google Sheet ──────────────────────────────────────────────────

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

const env = { ...loadEnv(path.join(ROOT_PARENT, '.env')), ...loadEnv(path.join(__dirname, '.env')) };
const sheetUrl   = env.DEPLOY_SHEET_INTERIEUR_URL   || '';
const sheetToken = env.DEPLOY_SHEET_INTERIEUR_TOKEN || '';

function pushToSheet() {
  return new Promise((resolve) => {
    if (!sheetUrl || !sheetToken) {
      console.log('\nℹ️  Sheet : DEPLOY_SHEET_INTERIEUR_URL/TOKEN absents du .env, push ignoré.');
      return resolve();
    }
    if (citiesAll.length === 0) {
      console.log('\n📤  Sheet : aucune ville à pousser.');
      return resolve();
    }

    const communes = JSON.parse(fs.readFileSync(path.join(ROOT_PARENT, 'data', 'communes.json'), 'utf8'));
    const normDep = String(depCode).replace(/^0+/, '');
    const idx = {};
    communes.filter(c => String(c.dep_code).replace(/^0+/, '') === normDep).forEach(c => {
      const k = c.nom_sans_accent.toLowerCase().replace(/['']/g, '-').replace(/\s+/g, '-').replace(/-{2,}/g, '-').replace(/^-|-$/g, '');
      idx[k] = c.nom_standard;
    });

    const rows = citiesAll.map(slug => {
      const name = idx[slug] || slug;
      const base = `${slug}.peintre-interieur-${dep2}.fr`;
      return [name, base, `https://${base}/sitemap.xml`];
    });

    console.log(`\n📤  Envoi vers Google Sheet (onglet "${dep2}") : ${rows.length} ligne(s)…`);

    const payload = JSON.stringify({ token: sheetToken, dep: dep2, rows });
    const https = require('https');
    const TIMEOUT_MS = 15000;

    function request(targetUrl, opts, body) {
      return new Promise((res, rej) => {
        const u = new URL(targetUrl);
        const options = {
          method: opts.method || 'GET',
          hostname: u.hostname,
          path: u.pathname + u.search,
          headers: opts.headers || {},
          timeout: TIMEOUT_MS,
          family: 4,
        };
        const req = https.request(options, (resp) => {
          let buf = '';
          resp.on('data', c => buf += c);
          resp.on('end', () => res({ status: resp.statusCode, headers: resp.headers, body: buf }));
        });
        req.on('error', rej);
        req.on('timeout', () => { req.destroy(new Error('timeout')); });
        if (body) req.write(body);
        req.end();
      });
    }

    (async () => {
      try {
        let r = await request(sheetUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
        }, payload);
        let hops = 0;
        while ((r.status === 301 || r.status === 302) && r.headers.location && hops < 5) {
          r = await request(r.headers.location, {});
          hops++;
        }
        console.log(`✅  Sheet : ${String(r.body).slice(0, 200)}`);
      } catch (e) {
        console.warn('⚠️  Erreur Sheet :', e.message, '— les villes seront poussées au prochain déploiement.');
      } finally {
        resolve();
      }
    })();
  });
}

pushToSheet().then(() => {
  console.log('\n✅  Déploiement terminé.');
});
