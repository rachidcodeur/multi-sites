#!/usr/bin/env node
/**
 * Pousse vers le Google Sheet les liens de tous les départements
 * déjà présents dans dashboard-peintre/interieur/deployed.json,
 * SANS rejouer le déploiement.
 *
 * Usage :
 *   node push-sheet.js              → tous les départements
 *   node push-sheet.js --dep 03     → un seul département
 *   node push-sheet.js --deps 02,03,04
 */

const fs   = require('fs');
const path = require('path');
const https = require('https');

const ROOT_PARENT  = path.resolve(__dirname, '..');
const DEPLOYED     = path.join(ROOT_PARENT, 'dashboard-peintre', 'interieur', 'deployed.json');
const COMMUNES_FP  = path.join(ROOT_PARENT, 'data', 'communes.json');

// ─── Args ────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const getArg = (n) => { const i = args.indexOf(n); return i !== -1 ? args[i + 1] : null; };
const onlyDep  = getArg('--dep');
const onlyDeps = getArg('--deps');
const filter = onlyDep
  ? new Set([String(onlyDep)])
  : (onlyDeps ? new Set(onlyDeps.split(',').map(s => s.trim())) : null);

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
const env = { ...loadEnv(path.join(ROOT_PARENT, '.env')), ...loadEnv(path.join(__dirname, '.env')) };
const sheetUrl   = env.DEPLOY_SHEET_INTERIEUR_URL   || '';
const sheetToken = env.DEPLOY_SHEET_INTERIEUR_TOKEN || '';
if (!sheetUrl || !sheetToken) {
  console.error('❌  DEPLOY_SHEET_INTERIEUR_URL / TOKEN absents du .env');
  process.exit(1);
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
function depCode2(dep) {
  const s = String(dep);
  if (s === '2A' || s === '2B') return s;
  if (s.length >= 3) return s;
  return s.padStart(2, '0');
}
function slugify(str) {
  return String(str).normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/['']/g, '-').replace(/\s+/g, '-')
    .replace(/-{2,}/g, '-').replace(/^-|-$/g, '');
}

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

async function pushOne(depCode, depEntry, communes) {
  const dep2 = depCode2(depCode);
  const normDep = String(depCode).replace(/^0+/, '');
  const idx = {};
  communes.filter(c => String(c.dep_code).replace(/^0+/, '') === normDep).forEach(c => {
    const k = slugify(c.nom_sans_accent);
    idx[k] = c.nom_standard;
  });

  const rows = (depEntry.cities || []).map(slug => {
    const name = idx[slug] || slug;
    const base = `${slug}.peintre-interieur-${dep2}.fr`;
    return [name, base, `https://${base}/sitemap.xml`];
  });

  const payload = JSON.stringify({ token: sheetToken, dep: dep2, rows });

  process.stdout.write(`📤  ${dep2} ${depEntry.nom} → ${rows.length} ligne(s)… `);

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
    let body = String(r.body || '').slice(0, 200);
    if (body.startsWith('<')) body = '⚠️  HTML reçu (Apps Script mal configuré : "Anyone" requis)';
    console.log(body);
  } catch (e) {
    console.log('❌', e.message);
  }
}

// ─── Main ────────────────────────────────────────────────────────────────────
(async () => {
  const deployed = JSON.parse(fs.readFileSync(DEPLOYED, 'utf8'));
  const communes = JSON.parse(fs.readFileSync(COMMUNES_FP, 'utf8'));

  const codes = Object.keys(deployed)
    .filter(c => !filter || filter.has(c) || filter.has(c.replace(/^0+/, '')))
    .sort();

  if (codes.length === 0) {
    console.error('❌  Aucun département à pousser (filtre trop strict ?)');
    process.exit(1);
  }

  console.log(`🚀  Push de ${codes.length} département(s) vers le Sheet…\n`);
  for (const code of codes) {
    await pushOne(code, deployed[code], communes);
  }
  console.log('\n✅  Terminé.');
})();
