/**
 * À coller dans : Sheet → Extensions → Apps Script
 *
 * Endpoint POST qui ajoute des lignes dans l'onglet correspondant au code département.
 * Body attendu : { dep: "33", rows: [["Bordeaux", "https://bordeaux.peintre-en-batiment-33.com"], ...] }
 *
 * Sécurité : protégé par un token. Change SECRET_TOKEN ci-dessous et utilise la même valeur
 * dans le .env du projet (DEPLOY_SHEET_TOKEN).
 *
 * Après modification : Déployer → Nouveau déploiement → Type : Application Web
 *   - Exécuter en tant que : Moi
 *   - Qui a accès : Tout le monde
 * Copier l'URL générée et la mettre dans .env (DEPLOY_SHEET_URL).
 */

const SECRET_TOKEN = 'CHANGE-MOI-PAR-UN-TOKEN-LONG-ALEATOIRE';

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);

    if (body.token !== SECRET_TOKEN) {
      return ContentService.createTextOutput(JSON.stringify({ error: 'unauthorized' }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    const dep = String(body.dep || '').trim();
    const rows = body.rows || [];

    if (!dep || !Array.isArray(rows) || rows.length === 0) {
      return ContentService.createTextOutput(JSON.stringify({ error: 'missing dep or rows' }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sheet = ss.getSheetByName(dep);

    // Crée l'onglet s'il n'existe pas, avec en-têtes
    // Colonnes : A=Ville | B=Lien | C=Index (manuel) | D=Sitemap
    if (!sheet) {
      sheet = ss.insertSheet(dep);
      sheet.getRange(1, 1, 1, 4).setValues([['Ville', 'Lien', 'Index', 'Sitemap']]);
      sheet.getRange(1, 1, 1, 4).setFontWeight('bold');
    } else {
      // Si l'onglet existe sans en-tête Sitemap en colonne D, l'ajouter
      const headerD = sheet.getRange(1, 4).getValue();
      if (!headerD) {
        sheet.getRange(1, 4).setValue('Sitemap').setFontWeight('bold');
      }
    }

    // Liens déjà présents (colonne B) pour éviter les doublons
    const lastRow = sheet.getLastRow();
    const existingLinks = new Set();
    if (lastRow > 1) {
      const links = sheet.getRange(2, 2, lastRow - 1, 1).getValues();
      links.forEach(r => existingLinks.add(String(r[0]).trim()));
    }

    // Filtrer les lignes nouvelles
    const newRows = rows.filter(r => !existingLinks.has(String(r[1]).trim()));

    if (newRows.length > 0) {
      const startRow = sheet.getLastRow() + 1;
      // r[0]=Ville, r[1]=Lien, r[2]=Sitemap ; Index (col C) laissé vide
      const data = newRows.map(r => [r[0], r[1], '', r[2] || '']);
      sheet.getRange(startRow, 1, data.length, 4).setValues(data);
    }

    return ContentService.createTextOutput(JSON.stringify({
      added: newRows.length,
      skipped: rows.length - newRows.length,
      total: sheet.getLastRow() - 1
    })).setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ error: err.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}
