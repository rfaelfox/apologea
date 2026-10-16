// Oberflächen-Durchlauf mit Playwright (Simulationsmodus, keine echten Schreibaktionen).
// Aufruf: node test/e2e-ui.mjs <datenordner> <ordner-mit-testdateien> <screenshot-ordner>
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node-tools/node_modules/playwright')); }

const [dataDir, filesDir, shotDir] = process.argv.slice(2);
const rt = JSON.parse(fs.readFileSync(path.join(dataDir, '.studio', 'laufzeit.json'), 'utf8'));
const base = `http://127.0.0.1:${rt.port}`;
fs.mkdirSync(shotDir, { recursive: true });

const results = [];
const check = (name, cond, extra = '') => { results.push({ name, ok: Boolean(cond), extra }); console.log(`${cond ? '✓' : '✗'} ${name}${extra ? ' – ' + extra : ''}`); };

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message));
// Absichtlich angezeigte Benutzermeldungen (ApiError) und erwartete 4xx-Antworten zählen nicht als Programmfehler.
page.on('console', (m) => { if (m.type() === 'error' && !/^ApiError|Failed to load resource: the server responded with a status of 4\d\d|ERR_TUNNEL_CONNECTION_FAILED/.test(m.text())) errors.push(m.text()); });
page.on('dialog', (d) => d.accept());
const shot = (n) => page.screenshot({ path: path.join(shotDir, n + '.png'), fullPage: false });
const btn = (name) => page.getByRole('button', { name, exact: true });
const modalBtn = (name) => page.locator('.overlay').last().getByRole('button', { name, exact: true }).filter({ hasText: name });

// --- Start & Schutz
const unauth = await (await fetch(`${base}/api/bootstrap`)).status;
check('API ohne Sitzung gesperrt', unauth === 401, String(unauth));
await page.goto(`${base}/auth?t=${rt.token}`);
await page.waitForSelector('.hero-btn');
check('Programmstart: Dashboard sichtbar', await page.locator('.hero-btn').count() === 2);
await page.waitForSelector('.conn');
await shot('01-dashboard');

// --- Einstellungen: Simulation
await page.click('a.item:has-text("Einstellungen")');
await page.waitForSelector('h2:has-text("Print-on-Demand-Anbieter")');
const mpFrame = page.locator('.frame:has(h3:text-is("MarketPrint"))');
await mpFrame.locator('input[name=mode-marketprint][value=simulation]').check();
await mpFrame.getByRole('button', { name: 'Speichern & Verbindung prüfen' }).click();
await mpFrame.locator('text=Simulation aktiv').waitFor();
const pfyFrame = page.locator('.frame:has(h3:text-is("Printify"))');
await pfyFrame.locator('input[name=mode-printify][value=simulation]').check();
await pfyFrame.getByRole('button', { name: 'Speichern & Verbindung prüfen' }).click();
await pfyFrame.locator('text=Simulation aktiv').waitFor();
await pfyFrame.locator('label.check:has-text("APOLOGEA (Beispiel)") input').check();
await modalBtn('Freigeben').click();
await page.waitForSelector('.toast:has-text("Zielshops gespeichert")');
check('Printify-Simulation verbunden, Zielshop freigegeben', true);
check('MarketPrint-Simulation verbunden', true);
// Fehlende Zugänge verständlich
const shopifyStatus = await page.locator('.card:has(h3:text("Shopify"))').first().innerText();
check('Fehlender Shopify-Zugang verständlich angezeigt', /Nicht eingerichtet|fehlt/.test(shopifyStatus), shopifyStatus.replace(/\s+/g, ' ').slice(0, 80));
// Ungültiges Theme-Access-Passwort wird abgelehnt
await page.locator('label.field:has-text("Theme-Access-Passwort") input[type=password]').fill('falsch');
await page.locator('label.field:has-text("Theme-Access-Passwort") button:has-text("Speichern")').click();
await page.waitForSelector('.toast.error');
check('Formularprüfung Zugangsdaten', (await page.locator('.toast.error').last().innerText()).includes('shptka_'));
await shot('02-einstellungen');

// --- Designbibliothek: Upload
await page.click('a.item:has-text("Designbibliothek")');
await page.waitForSelector('h1:has-text("Designbibliothek")');
await page.waitForSelector('.dropzone');
const fileInput = page.locator('input[type=file]').first();
await fileInput.setInputFiles([path.join(filesDir, 'theotokos-gold.png'), path.join(filesDir, 'klein-ohne-transparenz.jpg'), path.join(filesDir, 'theotokos-hell.png')]);
await page.waitForFunction(() => document.querySelectorAll('.grid.cards .card').length >= 3, null, { timeout: 30000 });
check('Uploads: 3 Designs importiert', await page.locator('.grid.cards .card').count() === 3);
const thumbs = await page.$$eval('.grid.cards img', (imgs) => imgs.map((i) => i.naturalWidth));
check('Dateivorschauen geladen', thumbs.every((w) => w > 0), thumbs.join(','));
await shot('03-bibliothek');
// Design öffnen, Metadaten + MarketPrint-Verknüpfung (Simulation: direkt hochladen)
await page.locator('.grid.cards .card:has-text("theotokos-gold")').click();
await page.waitForSelector('.overlay');
await page.locator('.overlay label.field:has-text("Motiv") input').fill('Theotokos');
await page.locator('.overlay label.field:has-text("Kollektion") input').fill('Drop 01');
await modalBtn('Direkt zu MarketPrint hochladen').click();
await page.waitForSelector('.overlay .inline-msg.ok:has-text("Verknüpft")');
check('Design mit MarketPrint verknüpft (Simulation)', true);
await page.locator('.overlay .tabs button:has-text("Printify")').click();
await modalBtn('Direkt zu Printify hochladen').click();
await page.waitForSelector('.overlay .inline-msg.ok:has-text("Verknüpft mit Printify")');
check('Design mit Printify verknüpft (Simulation)', true);
await shot('04-design-detail');
await modalBtn('Speichern').click();
await page.waitForTimeout(400);
// zweites Design (Alternativ) verknüpfen
await page.locator('.grid.cards .card:has-text("theotokos-hell")').click();
await modalBtn('Direkt zu MarketPrint hochladen').click();
await page.waitForSelector('.overlay .inline-msg.ok:has-text("Verknüpft")');
await modalBtn('Speichern').click();
// Filter
await page.selectOption('select >> nth=0', 'Theotokos');
await page.waitForTimeout(200);
check('Filter nach Motiv', await page.locator('.grid.cards .card').count() === 1);
await page.selectOption('select >> nth=0', '');

// --- Produkt anlegen
await page.click('a.item:has-text("Produkte")');
await page.waitForSelector('h1:has-text("Produkte")');
await btn('+ Neues Produkt').click();
await modalBtn('Leer beginnen').click();
await page.waitForSelector('#step-base .catalog .item');
await shot('05-produkt-katalog');
await page.locator('#step-base .catalog .item:has-text("VACANCY Oversized Shirt")').click();
await page.waitForSelector('#step-variants .swatch');
check('Felder richten sich nach Artikel (Druckflächen geladen)', await page.locator('#step-print .frame').count() === 2);
await page.locator('#step-variants .swatch:has-text("Washed Black")').click();
await page.locator('#step-variants .swatch:has-text("Natural Raw")').click();
await page.waitForTimeout(300);
const varText = await page.locator('#step-variants .hint').innerText();
check('Varianten gewählt', /16 Varianten/.test(varText), varText);
// Druckverfahren
await page.locator('#step-print select').first().selectOption('dtg');
// Motiv vorne
await page.locator('#step-print .frame').first().getByRole('button', { name: 'Motiv wählen' }).click();
await page.locator('.overlay .card:has-text("theotokos-gold")').click();
await page.waitForSelector('#step-print .frame >> nth=0 >> text=Prüfung der Druckdatei');
await page.waitForTimeout(800);
const notes = await page.locator('#step-print .frame').first().locator('.inline-msg').allInnerTexts();
check('Druckdatei geprüft', notes.some((n) => /Transparenter Hintergrund/.test(n)) && notes.some((n) => /Druckfläche/.test(n)), notes.length + ' Hinweise');
// Frei positionieren → über den Rand
await page.locator('#step-print .frame').first().locator('label.check:has-text("Frei positionieren") input').check();
await page.waitForTimeout(400);
await page.locator('#step-print .frame').first().locator('input[type=range]').nth(2).fill('1');
await page.locator('#step-print .frame').first().locator('input[type=range]').nth(2).dispatchEvent('change');
await page.waitForTimeout(800);
const notes2 = await page.locator('#step-print .frame').first().locator('.inline-msg.error').allInnerTexts();
check('Warnung: Motiv ragt über Druckfläche', notes2.some((n) => /ragt über/.test(n)));
await page.locator('#step-print .frame').first().locator('label.check:has-text("Automatisch einpassen") input').check();
await page.waitForTimeout(300);
// Alternativ-Motiv
await page.locator('#step-print summary:has-text("Alternativ-Motiv")').first().click();
await page.locator('#step-print .frame').first().getByRole('button', { name: 'Wählen' }).click();
await page.locator('.overlay .card:has-text("theotokos-hell")').click();
await page.waitForTimeout(500);
await page.locator('#step-print .frame').first().locator('label.check:has-text("Washed Black") input').check();
await shot('06-produkt-druck');

// Prüfen ohne Namen/Preis → Angaben fehlen
await btn('Angaben prüfen').click();
await page.waitForSelector('#step-check .inline-msg.error');
const missing = await page.locator('#step-check .inline-msg.error').allInnerTexts();
check('Formularprüfung: fehlende Angaben erkannt', missing.some((m) => /Motivname/.test(m)) && missing.some((m) => /Verkaufspreis/.test(m)), missing.length + ' Fehler');
check('Status „Angaben fehlen“', (await page.locator('.page-head .badge').first().innerText()).includes('Angaben fehlen'));

// Texte & Preis
await page.locator('#step-texts label.field:has-text("Interner Motivname") input').fill('Theotokos Gold 01');
await page.locator('#step-texts label.field:has-text("Öffentlicher Produktname") input').fill('Theotokos – Oversized Shirt');
await page.locator('#step-texts textarea').nth(1).fill('<p>Ein stilles Zeichen in Gold.</p>');
await page.locator('#step-price input[type=number]').fill('15');
await page.waitForTimeout(300);
check('Preis unter Katalogpreis wird markiert', await page.locator('#step-price .inline-msg.error').count() === 1);
await page.locator('#step-price input[type=number]').fill('49.90');
await page.locator('#step-price label.check:has-text("Nur Mockups") input').check();
await page.waitForSelector('#step-price label.check:has-text("xgyzvd-1m")');
check('Fremder Shop (xgyzvd-1m) als Ziel gesperrt', await page.locator('#step-price label.check:has-text("xgyzvd-1m") input').isDisabled());
await page.waitForTimeout(1200);
// Beschreibung mit Claude ohne KI → verständlicher Fehler
await page.locator('#step-texts').getByRole('button', { name: 'Beschreibung mit Claude erstellen' }).click();
await page.waitForSelector('.toast.error:has-text("Keine KI")');
check('Fehlende KI verständlich gemeldet', true);
await btn('Angaben prüfen').click();
await page.waitForTimeout(1500);
const st = await page.locator('.page-head .badge').first().innerText();
check('Status „Bereit zur Prüfung“ nach vollständigen Angaben', st.includes('Bereit zur Prüfung'), st);
await shot('07-produkt-texte');

// Vorlage speichern
await btn('Als Vorlage speichern').click();
await page.locator('.overlay input').fill('Oversized Shirt – Vorderseite');
await modalBtn('Speichern').click();
await page.waitForSelector('.toast:has-text("Vorlage gespeichert")');
check('Vorlage gespeichert', true);

// Vorschau
await btn('Vorschau anzeigen').click();
await page.waitForSelector('.overlay canvas.schema');
check('Vorschau (gekennzeichnet) angezeigt', await page.locator('.overlay:has-text("nicht verbindlich")').count() === 1);
await shot('08-produkt-vorschau');
await modalBtn('Schließen').click();

// Freigabe
const productUrl = page.url();
const productId = productUrl.split('/').pop();
await btn('Zur Veröffentlichung prüfen').click();
await page.waitForSelector('.overlay:has-text("Zusammenfassung vor der Veröffentlichung")');
const summary = await page.locator('.overlay').innerText();
check('Zusammenfassung enthält Zielshop, Preis, Varianten, Dateien, Auswirkung', /dfz1mp-1u\.myshopify\.com/.test(summary) && /49,90/.test(summary) && /16 Varianten/.test(summary) && /theotokos-gold\.png/.test(summary) && /KEINE Bestellung/.test(summary));
check('Status „Freigabe erforderlich“', (await page.locator('.page-head .badge').first().innerText()).includes('Freigabe erforderlich'));
await shot('09-freigabe');
// Abbrechen → nichts passiert
await modalBtn('Abbrechen').click();
let jobs = await (await page.request.get(`${base}/api/jobs`)).json();
check('Abbrechen löst nichts aus', !jobs.some((j) => j.type === 'product.publish'));
// Doppelte Veröffentlichung: zwei parallele Aufrufe mit derselben Freigabe
const review = await page.evaluate(async (id) => (await fetch(`/api/products/${id}/review`, { method: 'POST', headers: { 'X-Studio': '1', 'Content-Type': 'application/json' }, body: '{}' })).json(), productId);
const both = await page.evaluate(async ({ id, hash }) => {
  const call = () => fetch(`/api/products/${id}/publish`, { method: 'POST', headers: { 'X-Studio': '1', 'Content-Type': 'application/json' }, body: JSON.stringify({ approvalHash: hash }) }).then((r) => r.status);
  return Promise.all([call(), call(), call()]);
}, { id: productId, hash: review.approvalHash });
check('Schutz vor Doppelklick/Wiederholung: genau 1 Ausführung', both.filter((s) => s === 200).length === 1 && both.filter((s) => s === 409).length === 2, both.join(','));
const again = await page.evaluate(async ({ id, hash }) => (await fetch(`/api/products/${id}/publish`, { method: 'POST', headers: { 'X-Studio': '1', 'Content-Type': 'application/json' }, body: JSON.stringify({ approvalHash: hash }) })).json(), { id: productId, hash: review.approvalHash });
check('Erneutes Veröffentlichen nach Erfolg gesperrt', /bereits veröffentlicht/.test(again.error || ''), again.error);
jobs = await (await page.request.get(`${base}/api/jobs`)).json();
check('Genau ein Veröffentlichungsauftrag im Verlauf', jobs.filter((j) => j.type === 'product.publish').length === 1);
await page.reload();
await page.waitForSelector('text=Simulation abgeschlossen');
check('Ergebnis als Simulation gekennzeichnet', await page.locator('.badge.sim').count() >= 1);
await shot('10-ergebnis');

// Duplizieren
await page.locator('#app').getByRole('button', { name: 'Als neuen Entwurf duplizieren' }).click();
await page.waitForFunction((old) => !location.hash.endsWith(old), productId);
await page.waitForSelector('#step-variants .swatch.on');
check('Produkt dupliziert (Varianten übernommen)', await page.locator('#step-variants .swatch.on').count() === 2);

// Produkt aus Vorlage
await page.click('a.item:has-text("Designbibliothek")');
await page.click('.tabs button:has-text("Vorlagen")');
await page.waitForSelector('text=Oversized Shirt – Vorderseite');
await page.getByRole('button', { name: 'Produkt aus Vorlage' }).first().click();
await page.waitForSelector('#step-variants .swatch.on');
const tplPrice = await page.locator('#step-price input[type=number]').inputValue();
check('Produkt aus Vorlage (Preis & Varianten übernommen)', tplPrice === '49.9' && await page.locator('#step-variants .swatch.on').count() === 2, tplPrice);
check('Vorlage ohne Motiv', await page.locator('#step-print').getByRole('button', { name: 'Motiv wählen' }).count() === 2);

// Entwurf speichern & erneut öffnen
await page.locator('#step-texts label.field:has-text("Interner Motivname") input').fill('Aus Vorlage 01');
await btn('Entwurf speichern').click();
const tplUrl = page.url();
await page.goto(`${base}/#/produkte`);
await page.goto(tplUrl);
await page.waitForSelector('#step-texts');
check('Entwurf gespeichert und erneut geöffnet', (await page.locator('#step-texts label.field:has-text("Interner Motivname") input').inputValue()) === 'Aus Vorlage 01');

// --- Printify-Durchlauf (Simulation)
await page.click('a.item:has-text("Produkte")');
await page.waitForSelector('h1:has-text("Produkte")');
await btn('+ Neues Produkt').click();
await modalBtn('Leer beginnen').click();
await page.waitForSelector('#step-base .swatch');
await page.locator('#step-base .swatch:has-text("Printify")').click();
await page.waitForSelector('#step-base .catalog .item:has-text("Oversized")');
await page.locator('#step-base .catalog .item:has-text("Oversized")').first().click();
await page.waitForSelector('text=Druckdienstleister: Beispiel-Druckerei');
check('Printify: Grundprodukt + Druckdienstleister gewählt', true);
await page.locator('#step-variants .swatch:has-text("Schwarz")').click();
await page.waitForTimeout(300);
check('Printify: kein erfundener Einkaufspreis', (await page.locator('#step-variants table').innerText()).includes('beim Anlegen'));
await page.locator('#step-print .frame').first().getByRole('button', { name: 'Motiv wählen' }).click();
await page.locator('.overlay .card:has-text("theotokos-gold")').click();
await page.waitForTimeout(600);
check('Printify: keine „Kleines Logo“-Position (nicht unterstützt)', await page.locator('#step-print .frame').first().locator('label.check:has-text("Kleines Logo")').count() === 0);
await page.locator('#step-texts label.field:has-text("Interner Motivname") input').fill('Printify Test');
await page.locator('#step-texts label.field:has-text("Öffentlicher Produktname") input').fill('Theotokos – Printify');
await page.locator('#step-price input[type=number]').fill('42');
await page.waitForTimeout(1200);
await btn('Echte Mockups erzeugen').click();
await modalBtn('Mockups erzeugen').click();
await page.waitForSelector('.overlay:has-text("Echte Mockups von Printify")');
check('Printify: echte Mockups (Simulation) angezeigt', await page.locator('.overlay .card img').count() >= 1);
await modalBtn('Schließen').click();
await btn('Zur Veröffentlichung prüfen').click();
await page.waitForSelector('.overlay:has-text("Zusammenfassung vor der Veröffentlichung")');
check('Printify: Zusammenfassung nennt Anbieter', (await page.locator('.overlay').innerText()).includes('Printify'));
await modalBtn('Simulation ausführen').click();
await page.waitForSelector('text=Simulation abgeschlossen');
check('Printify: Simulation veröffentlicht', true);
await shot('15-printify');

// --- Website
await page.click('a.item:has-text("Website")');
await page.waitForSelector('h1:has-text("Website")');
await btn('+ Neue Änderung').click();
await page.waitForSelector('textarea.big');
await page.waitForSelector('select optgroup', { state: 'attached' });
const areaMsg = await page.locator('.inline-msg').allInnerTexts();
check('Website: fehlender Shopify-Zugang verständlich', areaMsg.some((m) => /Shopify-Zugang|Admin-App/.test(m)), areaMsg.join(' | ').slice(0, 120));
await page.fill('textarea.big', 'Ändere die Überschrift auf der Startseite in „Licht in der Dunkelheit“.');
await page.locator('input[type=file]').first().setInputFiles(path.join(filesDir, 'theotokos-hell.png'));
await page.waitForSelector('.attachments .att img');
check('Website: Referenzbild hochgeladen mit Vorschau', true);
await page.waitForTimeout(1000);
await btn('Vorschlag mit Claude erstellen').click();
await page.waitForSelector('.toast.error');
check('Website: ohne KI verständliche Meldung, nichts geändert', /Keine KI/.test(await page.locator('.toast.error').last().innerText()));
await shot('11-website');
const wUrl = page.url();
await page.goto(`${base}/#/website`);
await page.goto(wUrl);
await page.waitForSelector('textarea.big');
check('Website-Entwurf automatisch gespeichert', (await page.inputValue('textarea.big')).includes('Licht in der Dunkelheit'));

// --- Verlauf
await page.click('a.item:has-text("Aufträge")');
await page.waitForSelector('details.box');
await shot('12-verlauf');
check('Verlauf zeigt Aufträge', await page.locator('details.box').count() >= 1);

// --- Sicherung
await page.click('a.item:has-text("Einstellungen")');
await page.waitForSelector('h1:has-text("Einstellungen")');
await btn('Vollständige Sicherung exportieren').click();
await page.waitForSelector('.toast.ok:has-text("Sicherung erstellt")');
const list = await (await page.request.get(`${base}/api/backup/list`)).json();
check('Sicherung exportiert', list.some((b) => b.name.startsWith('APOLOGEA-Studio-Sicherung')));
await shot('13-sicherung');

// --- Kleines Fenster (Skalierung)
await page.setViewportSize({ width: 820, height: 700 });
await page.goto(`${base}/#/produkte/${productId}`);
await page.waitForSelector('#step-base');
const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
check('Kleines Fenster: kein waagerechtes Scrollen', !overflow);
await shot('14-klein');

check('Keine JavaScript-Fehler in der Oberfläche', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
fs.writeFileSync(path.join(shotDir, 'ergebnis.json'), JSON.stringify(results, null, 1));
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} Prüfungen bestanden`);
process.exit(failed.length ? 1 : 0);
