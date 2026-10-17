import { h, clear, get, post, toast, showError, busy, openExternal } from '../core.js';

/**
 * Einrichtungs-Assistent für Analytics: jeder Schritt wird vom Programm echt geprüft (Häkchen erst,
 * wenn es wirklich funktioniert). Knöpfe öffnen genau die Seite, auf der etwas zu tun ist.
 */

const SCOPES = 'read_orders, read_reports, read_products, read_all_orders';

const PRIVACY_TEXT = 'Reichweitenmessung (Live-Statistik). Wenn du der Analyse zugestimmt hast, übermitteln wir beim Besuch unseres Shops Seitenaufrufe, angesehene Produkte, Warenkorb- und Kassenereignisse ohne IP-Adresse an einen von uns betriebenen Dienst bei Cloudflare, Inc. (Auftragsverarbeitung, EU-Standardvertragsklauseln). Die Besucherkennung wird täglich neu pseudonymisiert. Die Daten werden nach 48 Stunden gelöscht, nur zusammengefasste Tageszahlen je Produkt bleiben bis zu 400 Tage erhalten. Rechtsgrundlage: Art. 6 Abs. 1 lit. a DSGVO (Einwilligung), jederzeit widerrufbar über die Cookie-Einstellungen.';

const STATE_LABEL = { ok: 'Erledigt', warn: 'Erledigt – Hinweis', todo: 'Zu tun', blocked: 'Wartet', optional: 'Empfohlen' };
const STATE_ICON = { ok: '✓', warn: '✓', todo: '•', blocked: '…', optional: '○' };

async function copy(text, btn, label = 'Kopiert ✓') {
  let ok = false;
  try { await navigator.clipboard.writeText(text); ok = true; } catch {
    const ta = h('textarea', { style: { position: 'fixed', opacity: '0' } }, text);
    document.body.append(ta); ta.select();
    try { ok = document.execCommand('copy'); } catch { /* nicht möglich */ }
    ta.remove();
  }
  if (ok && btn) { const old = btn.textContent; btn.textContent = label; setTimeout(() => { btn.textContent = old; }, 2500); }
  if (!ok) toast('Kopieren nicht möglich – bitte den Text markieren und mit Strg+C kopieren.', 'warn');
  return ok;
}

const openBtn = (label, url, primary = false) => h(`button.small${primary ? '.primary' : ''}`, { type: 'button', onclick: () => openExternal(url) }, label, ' ↗');
const copyBtn = (label, textFn) => { const b = h('button.small', { type: 'button' }, label); b.addEventListener('click', async () => copy(typeof textFn === 'function' ? await textFn() : textFn, b)); return b; };

export async function viewSetup(body, _period, { redraw }) {
  const st = await get('/api/analytics/setup');
  const L = st.links;
  const by = Object.fromEntries(st.steps.map((s) => [s.id, s]));

  const recheck = h('button.small', { type: 'button' }, 'Erneut prüfen');
  recheck.addEventListener('click', () => busy(recheck, redraw));

  // --- Schritt 1: Zugangsdaten direkt hier eintragen
  const cid = h('input', { type: 'text', placeholder: 'Client-ID', autocomplete: 'off', spellcheck: 'false' });
  const csec = h('input', { type: 'password', placeholder: 'Client-Secret (beginnt meist mit shpss_)', autocomplete: 'off' });
  const saveApp = h('button.small.primary', { type: 'button' }, 'Speichern & prüfen');
  saveApp.addEventListener('click', () => busy(saveApp, async () => {
    if (!cid.value.trim() || !csec.value.trim()) { toast('Bitte beide Felder ausfüllen.', 'warn'); return; }
    try {
      await post('/api/secrets', { name: 'shopify.clientId', value: cid.value });
      await post('/api/secrets', { name: 'shopify.clientSecret', value: csec.value });
      toast('Gespeichert (verschlüsselt auf diesem PC).', 'ok');
      await redraw();
    } catch (err) { showError(err); }
  }));

  // --- Schritt 4: erster Abgleich
  const syncBtn = h('button.small.primary', { type: 'button' }, 'Bestellungen jetzt laden');
  syncBtn.addEventListener('click', () => busy(syncBtn, async () => {
    try { const r = await post('/api/analytics/sync', {}); toast(`${r.total} Bestellungen übernommen.`, 'ok'); await redraw(); } catch (err) { showError(err); }
  }));

  // --- Schritt 5: Live-Dienst
  const cf = st.cloudflare;
  const tokenIn = h('input', { type: 'password', placeholder: cf.tokenSet ? 'Gespeichert – nur für einen neuen Token ausfüllen' : 'Cloudflare-API-Token hier einfügen', autocomplete: 'off' });
  const progress = h('div.setup-progress');
  const deployBtn = h('button.small.primary', { type: 'button' }, cf.deployed ? 'Erneut einrichten / aktualisieren' : 'Live-Dienst jetzt einrichten');
  deployBtn.addEventListener('click', () => busy(deployBtn, async () => {
    const t = tokenIn.value.trim();
    if (!t && !cf.tokenSet) { toast('Bitte zuerst den API-Token einfügen.', 'warn'); return; }
    clear(progress, h('div.a-loading', h('span.spinner'), 'Richte den Dienst bei Cloudflare ein … (ca. 30 Sekunden)'));
    try {
      const r = await post('/api/analytics/live-setup', t ? { apiToken: t } : {});
      clear(progress, h('ul.setup-log', r.steps.map((s) => h(`li.${s.ok ? 'ok' : s.pending ? 'wait' : 'bad'}`, h('span.ic', s.ok ? '✓' : s.pending ? '…' : '✕'), h('span', s.label), s.detail ? h('small.muted', ` – ${s.detail}`) : null))),
        r.ok ? null : h('div.inline-msg.error', r.error));
      if (r.ok) { toast(r.reachable ? 'Live-Dienst läuft.' : 'Live-Dienst angelegt – Erreichbarkeit folgt in ein paar Minuten.', 'ok'); tokenIn.value = ''; setTimeout(redraw, 1500); }
    } catch (err) { clear(progress); showError(err); }
  }));

  const card = (n, id, title, intro, ...content) => {
    const s = by[id];
    return h(`section.setup-step.s-${s.state}`,
      h('div.setup-head', h('span.setup-num', s.state === 'ok' || s.state === 'warn' ? STATE_ICON.ok : String(n)), h('div', h('h3', title), h('small.setup-state', STATE_LABEL[s.state], s.detail ? ` · ${s.detail}` : ''))),
      s.state === 'ok' && id !== 'live' && id !== 'pixel' ? null : h('div.setup-body', intro ? h('p', intro) : null, ...content));
  };

  clear(body,
    h('div.setup-top',
      h('div', h('h2', 'Einrichtung'), h('p.muted', `${st.done} von ${st.total} Schritten erledigt. Jeder Haken wird vom Programm echt geprüft.`),
        h('div.setup-bar', h('div', { style: { width: `${Math.round((100 * st.done) / st.total)}%` } }))),
      recheck),

    card(1, 'app', 'Shopify-App verbinden',
      'Das Studio liest Bestellungen über die offizielle Shopify-Schnittstelle. Dafür brauchst du eine eigene App im Shopify Dev Dashboard (kostenlos).',
      h('ol.a-steps',
        h('li', 'Dev Dashboard öffnen → „App erstellen“ (Name z. B. „APOLOGEA Studio“). Gibt es schon eine App, diese öffnen.'),
        h('li', 'Unter „Einstellungen“ Client-ID und Client-Secret kopieren und hier einfügen.')),
      h('div.row', openBtn('Dev Dashboard öffnen', L.devDashboard, true)),
      h('div.setup-form', cid, csec, saveApp)),

    card(2, 'scopes', 'Berechtigungen anhaken',
      'In deiner App unter „Versionen → Neue Version“ bei „Zugriffsbereiche“ (Scopes) diese Einträge hinzufügen, Version veröffentlichen und die App im Shop installieren bzw. aktualisieren:',
      h('div.setup-code', h('code', SCOPES)),
      h('div.row', copyBtn('Liste kopieren', SCOPES.replace(/ /g, '')), openBtn('Dev Dashboard öffnen', L.devDashboard)),
      h('p.hint', 'read_all_orders ist optional, sonst sieht das Studio nur die letzten 60 Tage. Bestehende Berechtigungen (z. B. für Bilder/Website) nicht entfernen.')),

    card(3, 'protected', 'Geschützte Kundendaten freischalten',
      'Shopify gibt Bestellungen erst frei, wenn du bestätigst, wofür du sie nutzt.',
      h('ol.a-steps',
        h('li', 'In der App: „API-Zugriffsanfragen“ → „Geschützte Kundendaten“ → „Zugriff anfordern“.'),
        h('li', 'Zweck: „Shop-Analyse und Umsatzauswertung im eigenen Shop“. Die Felder Name, E-Mail, Telefon und Adresse brauchst du NICHT anzufordern.'),
        h('li', 'Fragen zum Datenschutz wahrheitsgemäß beantworten (Daten bleiben auf deinem PC, Kunden nur verschlüsselt gekennzeichnet) und speichern.')),
      h('div.row', openBtn('Dev Dashboard öffnen', L.devDashboard))),

    card(4, 'sync', 'Bestellungen laden',
      'Lädt alle erlaubten Bestellungen einmal vollständig. Danach aktualisiert das Studio automatisch alle paar Minuten.',
      by.sync.state === 'blocked' ? null : h('div.row', syncBtn)),

    card(5, 'live', 'Live View einrichten (Cloudflare)',
      cf.deployed ? null : 'Für „Besucher gerade online“ braucht es einen kleinen Dienst im Internet. Das Studio richtet ihn bei Cloudflare automatisch ein – kostenlos im Free-Tarif.',
      cf.deployed ? h('p.muted', `Konto: ${cf.accountName || '–'} · Dienst-Version ${cf.version || '–'}${cf.updateAvailable ? ` (neu: ${cf.latest})` : ''}`) : h('ol.a-steps',
        h('li', 'Kostenloses Cloudflare-Konto anlegen (falls noch nicht vorhanden) und E-Mail bestätigen.'),
        h('li', 'API-Token erstellen: „Token erstellen“ → Vorlage „Cloudflare Workers bearbeiten“ → „Vorlage verwenden“.'),
        h('li', 'Bei „Berechtigungen“ auf „+ Weitere hinzufügen“: ', h('strong', 'Konto · D1 · Bearbeiten'), '. Bei „Kontoressourcen“ dein Konto wählen, „Zonenressourcen“ auf „Alle Zonen“ lassen.'),
        h('li', '„Weiter zur Zusammenfassung“ → „Token erstellen“ → Token kopieren und unten einfügen.')),
      cf.deployed ? null : h('div.row', openBtn('Cloudflare-Konto anlegen', L.cloudflareSignup), openBtn('API-Token erstellen', L.cloudflareTokens, true)),
      h('div.setup-form', tokenIn, deployBtn),
      progress,
      h('p.hint', 'Der Token wird verschlüsselt nur auf diesem PC gespeichert und nur an Cloudflare gesendet.')),

    card(6, 'pixel', 'Pixel in den Shop einfügen',
      by.pixel.state === 'blocked' ? null : 'Das Pixel meldet Besuche an deinen Live-Dienst – nur bei Besuchern, die der Analyse zugestimmt haben.',
      by.pixel.state === 'blocked' ? null : h('ol.a-steps',
        h('li', '„Pixel-Code kopieren“ klicken (deine Adresse ist schon eingesetzt).'),
        h('li', '„Kundenereignisse öffnen“ → „Benutzerdefiniertes Pixel hinzufügen“ → Name „APOLOGEA Live“.'),
        h('li', 'Alles im Code-Feld löschen und den kopierten Code einfügen.'),
        h('li', 'Berechtigung: „Erforderlich“ → „Analyse“. Datenverkauf: „Erfasste Daten gelten nicht als Datenverkauf“.'),
        h('li', '„Speichern“ → „Verbinden“. Danach deinen Shop einmal selbst besuchen, Cookies erlauben, hier „Erneut prüfen“.')),
      by.pixel.state === 'blocked' ? null : h('div.row', copyBtn('Pixel-Code kopieren', async () => (await get('/api/analytics/pixel-code')).code), openBtn('Kundenereignisse öffnen', L.customerEvents, true)),
      by.pixel.state === 'blocked' ? null : h('details.setup-privacy', h('summary', 'Datenschutzerklärung ergänzen'),
        h('p', 'Füge diesen Absatz in deine Datenschutzerklärung ein (bitte rechtlich prüfen lassen):'),
        h('blockquote', PRIVACY_TEXT),
        h('div.row', copyBtn('Text kopieren', PRIVACY_TEXT), openBtn('Rechtliches in Shopify öffnen', L.privacyPolicy)))),

    card(7, 'costs', 'Kosten & Gebühren eintragen',
      'Damit „Gewinn“ nicht nur „vorläufig“ ist: Zahlungsgebühren (stehen in Shopify unter Einstellungen → Zahlungen), POD-Versand je Bestellung und Stückkosten.',
      h('div.row', h('a.btn.small', { href: '#/einstellungen/analytics' }, 'Zu den Einstellungen'), h('a.btn.small.ghost', { href: '#/analytics/produkte' }, 'Stückkosten je Produkt'))),

    h('p.muted.setup-foot', `Zuletzt geprüft: ${new Date(st.checkedAt).toLocaleTimeString('de-DE')}`));
}
