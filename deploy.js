#!/usr/bin/env node
/**
 * Déploie les sites vers le serveur et met à jour le dashboard.
 *
 * Usage :
 *   node deploy.js --dep 33 --dep-nom Gironde \
 *     --server root@204.168.224.81 \
 *     --local-dep output/33-gironde-dep \
 *     --local-villes output/33-gironde \
 *     --remote-dep /var/www/peintre-en-batiment-33 \
 *     --remote-villes /var/www/peintres/gironde
 *
 * Options :
 *   --dep            Code département (obligatoire)
 *   --dep-nom        Nom du département (obligatoire)
 *   --server         Serveur SSH (défaut : root@204.168.224.81)
 *   --local-dep      Dossier local du site département (défaut : output/{code}-{nom}-dep)
 *   --local-villes   Dossier local des sites villes (défaut : output/{code}-{nom})
 *   --remote-dep     Dossier distant du site département (défaut : /var/www/peintre-en-batiment-{code})
 *   --remote-villes  Dossier distant des sites villes (défaut : /var/www/peintres/{nom})
 *   --skip-dep       Ne pas déployer le site département
 *   --skip-villes    Ne pas déployer les sites villes
 */

const fs   = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// ─── Arguments CLI ───────────────────────────────────────────────────────────

const args   = process.argv.slice(2);
const getArg = (name) => { const i = args.indexOf(name); return i !== -1 ? args[i + 1] : null; };
const hasFlag = (name) => args.includes(name);

const depCode = getArg('--dep');
const depNom  = getArg('--dep-nom');

if (!depCode || !depNom) {
  console.error('Usage : node deploy.js --dep <code> --dep-nom <nom> [options]');
  console.error('');
  console.error('Options :');
  console.error('  --server          Serveur SSH (défaut : root@204.168.224.81)');
  console.error('  --local-dep       Dossier local site département');
  console.error('  --local-villes    Dossier local sites villes');
  console.error('  --remote-dep      Dossier distant site département');
  console.error('  --remote-villes   Dossier distant sites villes');
  console.error('  --with-dep        Déployer aussi le site département (ignoré par défaut)');
  console.error('  --skip-villes     Ne pas déployer les sites villes');
  console.error('');
  console.error('Exemple :');
  console.error('  node deploy.js --dep 33 --dep-nom Gironde');
  console.error('  node deploy.js --dep 33 --dep-nom Gironde --skip-dep');
  console.error('  node deploy.js --dep 33 --dep-nom Gironde --remote-villes /var/www/mon-dossier');
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
const depNomLower = slugifyDep(depNom);

const server      = getArg('--server')        || 'root@204.168.224.81';
const localDep    = getArg('--local-dep')      || `output/${depCode}-${depNomLower}-dep`;
const localVilles = getArg('--local-villes')   || `output/${depCode}-${depNomLower}`;
const remoteDep   = getArg('--remote-dep')     || `/var/www/peintre-en-batiment-${depCode}`;
const remoteVilles= getArg('--remote-villes')  || `/var/www/peintres/${depNomLower}`;
const skipDep     = !hasFlag('--with-dep');
const skipVilles  = hasFlag('--skip-villes');

// ─── Résumé ──────────────────────────────────────────────────────────────────

console.log('');
console.log('╔══════════════════════════════════════════════════════════╗');
console.log('║              DÉPLOIEMENT PEINTRES FRANCE                ║');
console.log('╚══════════════════════════════════════════════════════════╝');
console.log('');
console.log(`  Département :    ${depNom} (${depCode})`);
console.log(`  Serveur :        ${server}`);
console.log('');
if (!skipDep) {
  console.log(`  Site département :`);
  console.log(`    Local  → ${localDep}/`);
  console.log(`    Distant → ${server}:${remoteDep}/`);
} else {
  console.log(`  Site département : IGNORÉ (ajouter --with-dep pour inclure)`);
}
console.log('');
if (!skipVilles) {
  console.log(`  Sites villes :`);
  console.log(`    Local  → ${localVilles}/`);
  console.log(`    Distant → ${server}:${remoteVilles}/`);
} else {
  console.log(`  Sites villes : IGNORÉ (--skip-villes)`);
}
console.log('');
console.log('─'.repeat(58));

// ─── Détection de l'outil de transfert ───────────────────────────────────────
// Utilise rsync s'il est disponible (plus efficace), sinon scp (dispo par défaut
// sur Windows 10+ / macOS / Linux via OpenSSH).

function hasCommand(cmd) {
  try {
    const probe = process.platform === 'win32' ? `where ${cmd}` : `command -v ${cmd}`;
    execSync(probe, { stdio: 'ignore' });
    return true;
  } catch (e) { return false; }
}

const USE_RSYNC = hasCommand('rsync');
const USE_SCP   = !USE_RSYNC && hasCommand('scp');

if (!USE_RSYNC && !USE_SCP) {
  console.error('\n❌  Ni rsync ni scp détectés. Sur Windows : installe OpenSSH (Settings → Apps → Optional features) ou Git Bash (inclut rsync).');
  process.exit(1);
}

function uploadFolder(localPath, remotePath, label) {
  if (USE_RSYNC) {
    console.log(`\n📦  rsync ${label} → ${server}:${remotePath}/`);
    execSync(`rsync -avz "${localPath}/" "${server}:${remotePath}/"`, { stdio: 'inherit' });
  } else {
    // scp -r upload le dossier complet. Pour que le contenu arrive dans remotePath/
    // (comme rsync trailing-slash), on envoie les fichiers individuellement.
    console.log(`\n📦  scp ${label} → ${server}:${remotePath}/  (rsync non dispo, transfert complet)`);
    // Crée le dossier distant
    try {
      execSync(`ssh "${server}" "mkdir -p '${remotePath}'"`, { stdio: 'inherit' });
    } catch (e) { /* ignore si existe déjà */ }
    // Transfert récursif avec scp -r, path/* pour que le contenu soit dans remotePath
    const quoted = process.platform === 'win32' ? `"${localPath}"` : `"${localPath}"`;
    execSync(`scp -r ${quoted}/* "${server}:${remotePath}/"`, { stdio: 'inherit' });
  }
}

// ─── 1. Déploiement département ──────────────────────────────────────────────
//
// Le sitemap du site département contient UNIQUEMENT les pages du site dept
// (home + mentions légales + politique). Les sous-domaines villes ont leur
// propre sitemap individuel et ne sont JAMAIS ajoutés au sitemap du dep.

if (!skipDep) {
  if (fs.existsSync(localDep)) {
    try {
      uploadFolder(localDep, remoteDep, 'site département');
    } catch (e) {
      console.error('❌  Erreur upload département :', e.message);
    }
  } else {
    console.log(`\n⚠️  Dossier local introuvable : ${localDep}`);
  }
}

// ─── 2. Déploiement villes ───────────────────────────────────────────────────

if (!skipVilles) {
  if (fs.existsSync(localVilles)) {
    try {
      uploadFolder(localVilles, remoteVilles, 'sites villes');
    } catch (e) {
      console.error('❌  Erreur upload villes :', e.message);
    }
  } else {
    console.log(`\n⚠️  Dossier local introuvable : ${localVilles}`);
  }
}

// ─── 3. Mise à jour deployed.json ────────────────────────────────────────────

let citiesAdded = []; // villes nouvellement déployées (slug)

if (!skipVilles && fs.existsSync(localVilles)) {
  const dashboardDir = 'dashboard-peintre';
  const hasDashboard = fs.existsSync(dashboardDir);

  const cities = fs.readdirSync(localVilles).filter(f =>
    fs.statSync(path.join(localVilles, f)).isDirectory()
  ).sort();

  if (hasDashboard) {
    const deployedPath = path.join(dashboardDir, 'deployed.json');
    let deployed = {};
    if (fs.existsSync(deployedPath)) {
      deployed = JSON.parse(fs.readFileSync(deployedPath, 'utf8'));
    }

    if (!deployed[depCode]) {
      deployed[depCode] = { nom: depNom, cities: [] };
    }

    const previousSet = new Set(deployed[depCode].cities || []);
    citiesAdded = cities.filter(c => !previousSet.has(c));

    cities.forEach(c => previousSet.add(c));
    deployed[depCode].nom = depNom;
    deployed[depCode].cities = [...previousSet].sort();

    fs.writeFileSync(deployedPath, JSON.stringify(deployed, null, 2), 'utf8');
    console.log(`\n📊  deployed.json → ${deployed[depCode].cities.length} villes pour ${depNom} (${depCode}) (+${citiesAdded.length} nouvelles)`);

    console.log('');
    try {
      execSync('node dashboard-peintre/generate-dashboard.js', { stdio: 'inherit' });
    } catch (e) {
      console.warn('⚠️  Dashboard non généré :', e.message);
    }
  } else {
    // Pas de dashboard-peintre/ (submodule non initialisé) : toutes les villes sont considérées comme nouvelles
    citiesAdded = cities;
    console.log(`\nℹ️  dashboard-peintre/ absent (git submodule update --init pour l'activer). Le push Sheet considère ${cities.length} villes.`);
  }
}

// ─── 5. Push vers Google Sheet ───────────────────────────────────────────────

function loadEnv(filePath = '.env') {
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

const env = loadEnv();
const sheetUrl   = env.DEPLOY_SHEET_URL   || '';
const sheetToken = env.DEPLOY_SHEET_TOKEN || '';

function pushToSheet() {
  return new Promise((resolve) => {
    if (!sheetUrl || !sheetToken) {
      console.log('\nℹ️  Sheet : DEPLOY_SHEET_URL et DEPLOY_SHEET_TOKEN absents du .env, push ignoré.');
      return resolve();
    }
    if (citiesAdded.length === 0) {
      console.log('\n📤  Sheet : aucune nouvelle ville à ajouter.');
      return resolve();
    }

    const communes = JSON.parse(fs.readFileSync('data/communes.json', 'utf8'));

    function slugify(str) {
      return str.toLowerCase().replace(/['']/g, '-').replace(/\s+/g, '-').replace(/-{2,}/g, '-').replace(/^-|-$/g, '');
    }

    const idx = {};
    const normDep = String(depCode).replace(/^0+/, '');
    communes.filter(c => String(c.dep_code).replace(/^0+/, '') === normDep).forEach(c => {
      idx[slugify(c.nom_sans_accent)] = c.nom_standard;
    });

    const rows = citiesAdded.map(slug => {
      const name = idx[slug] || slug;
      const base = `${slug}.peintre-en-batiment-${depCode}.com`;
      return [name, base, `https://${base}/sitemap.xml`];
    });

    console.log(`\n📤  Envoi vers Google Sheet (onglet "${depCode}") : ${rows.length} ligne(s)…`);

    const payload = JSON.stringify({ token: sheetToken, dep: String(depCode), rows });
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
          family: 4, // Force IPv4 (évite les timeouts IPv6 sur certains réseaux)
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

        // Apps Script renvoie une redirection 302 — il faut suivre
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
