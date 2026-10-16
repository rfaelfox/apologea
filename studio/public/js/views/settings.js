import { h, clear, get, post, put, upload, fmtDate, fmtBytes, showError, toast, busy, confirmDialog, dropzone, extLink, ornament, userError } from '../core.js';
import { state, reloadBoot } from '../app.js';
import { loadConnections } from './dashboard.js';

const MODELS = [
  ['claude-opus-5-5', 'Claude Opus 5.5 – höchste Qualität ($4 / $20 je 1 Mio. Token)'],
  ['claude-sonnet-5-5', 'Claude Sonnet 5.5 – günstiger ($2 / $10)'],
  ['claude-haiku-5-5', 'Claude Haiku 5.5 – sehr günstig, einfache Texte ($0,10 / $0,50)'],
];

export async function renderSettings(main) {
  const boot = await reloadBoot();
  const s = boot.settings;
  const secrets = s.secrets;
  const secretState = (n) => (secrets[n]?.set ? h('small', { style: { color: 'var(--ok)' } }, `hinterlegt (${fmtDate(secrets[n].savedAt)})`) : h('small.muted', 'nicht hinterlegt'));

  const secretField = (name, label, placeholder, hint) => {
    const input = h('input', { type: 'password', placeholder, autocomplete: 'off' });
    const saveBtn = h('button.small', { type: 'button' }, 'Speichern');
    const clearBtn = h('button.small.ghost', { type: 'button' }, 'Entfernen');
    const stateBox = h('span', secretState(name));
    saveBtn.addEventListener('click', () => busy(saveBtn, async () => {
      if (!input.value.trim()) return showError(userError('Bitte einen Wert eingeben.'));
      try { const r = await post('/api/secrets', { name, value: input.value }); input.value = ''; loadConnections(connBox); clear(stateBox, h('small', { style: { color: 'var(--ok)' } }, `hinterlegt (${fmtDate(r.info.savedAt)})`)); toast('Sicher gespeichert.', 'ok'); } catch (err) { showError(err); }
    }));
    clearBtn.addEventListener('click', async () => {
      if (!(await confirmDialog({ title: 'Zugang entfernen?', text: label, danger: true, confirmLabel: 'Entfernen' }))) return;
      await post('/api/secrets', { name, value: '' }).catch(showError);
      clear(stateBox, h('small.muted', 'nicht hinterlegt'));
    });
    return h('label.field', h('span', label, ' · ', stateBox), h('div.row', h('div', { style: { flex: '1 1 260px' } }, input), saveBtn, clearBtn), hint ? h('div.hint', hint) : null);
  };

  const saveSettings = async (patch, msg = 'Gespeichert.') => {
    try { await put('/api/settings', patch); await reloadBoot(); toast(msg, 'ok'); loadConnections(connBox); } catch (err) { showError(err); }
  };

  // ---------- Shopify
  const domain = h('input', { type: 'text', value: s.shop.domain });
  const publicUrl = h('input', { type: 'text', value: s.shop.publicUrl });
  const shopifyBox = h('div.frame.stack',
    h('h3', 'Shopify'),
    h('div.grid.cols-2',
      h('label.field', h('span', 'Shop-Adresse (…myshopify.com)'), domain),
      h('label.field', h('span', 'Öffentliche Adresse'), publicUrl)),
    h('button.small', { type: 'button', onclick: () => saveSettings({ shop: { domain: domain.value, publicUrl: publicUrl.value } }) }, 'Adresse speichern'),
    ornament(),
    h('h4', 'A · Theme Access (nur Theme-Dateien)'),
    secretField('shopify.themeAccessPassword', 'Theme-Access-Passwort', 'shptka_…', 'Shopify-Admin → Apps → Theme Access → Passwort erstellen. Erlaubt nur Änderungen an Themes (Texte, Bilder, Farben, Vorlagen), keine Seiten oder Produkte.'),
    h('h4', 'B · Eigene Shopify-App (Theme + Shop-Inhalte)'),
    h('div.inline-msg.info',
      'Für Seiten, Kollektionen, Tags und Bild-Uploads: Im Shopify Dev Dashboard (dev.shopify.com) eine App für deinen Shop anlegen, nur diese Berechtigungen auswählen: ',
      h('strong', 'read_themes, write_themes, read_products, write_products, read_content, write_content, read_files, write_files'),
      '. App im Shop installieren, dann Client-ID und Client-Secret hier eintragen. Das Programm holt sich damit selbst einen Zugangsschlüssel (24 Stunden gültig, wird automatisch erneuert). Das funktioniert nur für Shops deiner eigenen Organisation.'),
    secretField('shopify.clientId', 'Client-ID', 'Client-ID der App'),
    secretField('shopify.clientSecret', 'Client-Secret', 'Client-Secret der App'),
    h('div.row', extLink('Shopify Dev Dashboard', 'https://dev.shopify.com/dashboard'), extLink('Theme Access im Shop', `https://${s.shop.domain}/admin/apps`)));

  // ---------- MarketPrint
  // ---------- Print-on-Demand-Anbieter (je Baustein gleich aufgebaut)
  const radio = (name, value, cur, label, desc) => h('label.check', h('input', { type: 'radio', name, value, checked: cur === value }), h('span', h('strong', label), desc ? h('div.muted', desc) : null));
  const providers = await get('/api/providers');
  const providerBox = (p) => {
    const ps = s[p.id] || {};
    const result = h('div');
    const radios = h('div', p.modes.map((m) => radio(`mode-${p.id}`, m.id, p.mode, m.label, m.desc)));
    const mcpUrl = p.id === 'marketprint' ? h('input', { type: 'url', value: ps.mcpUrl || '', placeholder: 'https://… (aus der MarketPrint-Hilfe)' }) : null;
    const test = h('button.primary', { type: 'button' }, 'Speichern & Verbindung prüfen');
    const allowedBox = h('div');
    const drawAllowed = async () => {
      const allowed = new Set(ps.allowedShops || []);
      let targets = [...allowed].map((x) => ({ id: x, label: x }));
      if (p.connected) { try { const acc = await get(`/api/providers/${p.id}/account`); for (const t of acc.targets) if (!targets.some((x) => x.id === t.id)) targets.push(t); else targets = targets.map((x) => (x.id === t.id ? t : x)); } catch { /* Konto nicht erreichbar */ } }
      clear(allowedBox, h('div.field-label', 'Erlaubte Zielshops'), targets.length ? targets.map((t) => h('label.check',
        h('input', { type: 'checkbox', checked: allowed.has(t.id), onchange: async (e) => {
          if (e.target.checked && !(await confirmDialog({ title: 'Shop als Ziel freigeben?', text: `${t.label} wird als Zielshop für ${p.name}-Veröffentlichungen erlaubt. Nur freigeben, wenn dieser Shop zu APOLOGEA gehört.`, confirmLabel: 'Freigeben' }))) { e.target.checked = false; return; }
          e.target.checked ? allowed.add(t.id) : allowed.delete(t.id);
          ps.allowedShops = [...allowed];
          await saveSettings({ [p.id]: { allowedShops: [...allowed] } }, 'Zielshops gespeichert.');
        } }), h('span', t.label, t.note ? h('div.muted', { style: { fontSize: '.8rem' } }, t.note) : null))) : h('p.muted', 'Nach der Verbindung erscheinen hier deine Shops.'),
        h('p.hint', 'Veröffentlichungen sind nur in freigegebene Shops möglich. Fremde Shops bleiben gesperrt.'));
    };
    drawAllowed();
    test.addEventListener('click', () => busy(test, async () => {
      const mode = radios.querySelector('input:checked')?.value || 'none';
      try {
        await put('/api/settings', { [p.id]: { mode, ...(mcpUrl ? { mcpUrl: mcpUrl.value } : {}) } });
        p.mode = mode; p.connected = mode !== 'none'; p.simulated = mode === 'simulation';
        if (mode === 'none') { clear(result); drawAllowed(); return toast('Gespeichert.', 'ok'); }
        const r = await post(`/api/providers/${p.id}/test`);
        clear(result, h(`div.inline-msg.${r.ok ? 'ok' : 'error'}`, r.message || (r.ok ? 'Verbunden.' : 'Nicht verbunden.')),
          r.account ? h('dl.kv', h('dt', 'Konto'), h('dd', r.account.email || r.account.label || '–'), h('dt', 'Verbundene Shops'), h('dd', (r.account.targets || (r.account.shopDomains || []).map((x) => ({ label: x }))).map((t) => t.label).join(', ') || '–')) : null,
          r.servers?.length ? h('div.muted', 'Gefunden: ' + r.servers.map((x) => `${x.name} (${x.status})`).join(', ')) : null);
        await reloadBoot();
        drawAllowed();
        loadConnections(connBox);
      } catch (err) { clear(result, h('div.inline-msg.error', err.message)); }
    }));
    const caps = p.capabilities;
    const facts = [
      caps.realMockups ? 'echte Mockups vor dem Veröffentlichen' : null,
      caps.twoStep ? 'erst Entwurf beim Anbieter, dann Veröffentlichen' : null,
      caps.directUpload ? 'Druckdateien direkt hochladen' : 'Druckdateien beim Anbieter hochladen und verknüpfen',
      caps.alternativeDesign ? 'Alternativ-Motiv je Farbe' : null,
      caps.tags ? 'Tags werden übertragen' : null,
    ].filter(Boolean);
    return h('div.frame.stack',
      h('div.row.between', h('h3', { style: { margin: 0 } }, p.name), extLink('Website', p.website)),
      h('p.muted', 'Kann: ' + facts.join(' · ') + '. Bestellungen und Zahlungen löst das Programm nie aus.'),
      p.id === 'printful' ? h('div.inline-msg.info', 'Laut Printful-Dokumentation legt die Printful-Schnittstelle Produkte nur in „Manual order / API“-Shops an, nicht in mit Shopify verbundenen Printful-Shops. Für diese bietet das Studio Katalog, Prüfung und echte Mockups; angelegt wird dann in der Printful-Oberfläche.') : null,
      radios,
      p.secrets.map((sec) => secretField(sec.name, sec.label, sec.placeholder, sec.hint)),
      mcpUrl ? h('label.field', h('span', 'MCP-Adresse (nur für „Direkte Verbindung“)'), mcpUrl) : null,
      h('div.row', test), result, allowedBox,
      p.id === 'marketprint' ? h('details.box', h('summary', 'Einrichtung „Über Claude Code“'), h('div', h('ol',
        h('li', 'Claude Code installieren: ', extLink('code.claude.com', 'https://code.claude.com'), '.'),
        h('li', 'Eingabeaufforderung öffnen, „claude“ eingeben und mit deinem Claude-Konto anmelden (das Konto, in dem der MarketPrint-Connector verbunden ist).'),
        h('li', 'Hier „Speichern & Verbindung prüfen“ klicken. Das Programm sucht den MarketPrint-Connector und liest dein Konto.')))) : null);
  };
  const mpBox = h('div.stack', providers.map(providerBox));

  // ---------- Claude
  const engine = s.ai.engine;
  const aiRadios = h('div',
    radio('ai', 'none', engine, 'Keine KI', 'Texte schreibst du selbst; Website-Vorschläge sind dann nicht verfügbar.'),
    radio('ai', 'claude-code', engine, 'Claude Code (über dein Claude-Konto)', 'Keine API-Kosten über dieses Programm. Zählt zu den Nutzungsgrenzen deines Claude-Abos. Voraussetzung: Claude Code installiert und angemeldet.'),
    radio('ai', 'api', engine, 'Anthropic API (eigener API-Schlüssel)', 'Nutzungsabhängige Abrechnung über console.anthropic.com. Dein Claude-Abo ist davon getrennt und wird NICHT als API-Guthaben verwendet.'));
  const model = h('select', MODELS.map(([v, l]) => h('option', { value: v, selected: s.ai.model === v }, l)));
  const confirmEach = h('input', { type: 'checkbox', checked: s.ai.confirmEachPaidCall });
  const aiBox = h('div.frame.stack',
    h('h3', 'Claude'),
    aiRadios,
    h('label.field', h('span', 'Modell'), model, h('div.hint', 'Preise laut Anthropic (Stand Oktober 2026), je 1 Mio. Token Eingabe / Ausgabe. Ein Produkttext kostet mit Opus 5.5 typischerweise wenige Cent, ein Website-Vorschlag mit großem Theme-Kontext eher 0,10–0,80 US-Dollar. Vor jedem Aufruf siehst du eine Schätzung.')),
    h('label.check', confirmEach, h('span', 'Vor jedem kostenpflichtigen Aufruf nachfragen (empfohlen)')),
    secretField('anthropic.apiKey', 'Anthropic-API-Schlüssel (nur für „Anthropic API“)', 'sk-ant-…', 'console.anthropic.com → API Keys. Der Schlüssel wird verschlüsselt gespeichert und nie in der Oberfläche angezeigt.'),
    h('button.primary', { type: 'button', onclick: () => saveSettings({ ai: { engine: aiRadios.querySelector('input:checked')?.value || 'none', model: model.value, confirmEachPaidCall: confirmEach.checked } }) }, 'KI-Einstellungen speichern'),
    h('p.hint', 'Beim bloßen Öffnen des Programms finden keine kostenpflichtigen KI-Aufrufe statt.'));

  // ---------- Marke
  const voice = h('textarea', null);
  voice.value = s.brand.voice;
  const logoPrev = h('div', h('img', { src: boot.logo ? boot.logo + '?v=' + Date.now() : '/brand/logo-29.svg', alt: 'Logo', style: { maxWidth: '240px', background: '#000', padding: '12px', border: '1px solid var(--line)' } }),
    h('div.hint', boot.logo ? 'Eigene Logo-Datei aktiv.' : 'APOLOGEA-Logo Nr. 29 ist eingebunden (Vektorfassung des Originals).'));
  const brandBox = h('div.frame.stack',
    h('h3', 'Marke'),
    h('div.field-label', 'Logo Nr. 29'),
    logoPrev,
    dropzone({ accept: 'image/png,image/svg+xml,image/webp,image/jpeg', multiple: false, label: 'Nur bei Bedarf: andere Logo-Datei hierher ziehen (PNG mit Transparenz oder SVG)', onFiles: async (files) => { try { await upload('/api/upload?kind=logo', files[0]); await reloadBoot(); toast('Logo übernommen.', 'ok'); renderSettings(main); } catch (err) { showError(err); } } }),
    h('label.field', h('span', 'Markenstimme (für Claude)'), voice),
    h('button.small', { type: 'button', onclick: () => saveSettings({ brand: { voice: voice.value } }) }, 'Markenstimme speichern'));

  // ---------- Daten
  const backupList = h('div');
  const drawBackups = async () => {
    try {
      const list = await get('/api/backup/list');
      clear(backupList, list.length ? h('div.table-wrap', h('table.list', h('tbody', list.slice(0, 12).map((b) => h('tr', h('td', b.name), h('td.muted', fmtBytes(b.size)), h('td.muted', fmtDate(b.at)), h('td', h('button.small', { type: 'button', onclick: () => post('/api/backup/reveal', { path: b.path }).catch(showError) }, 'Im Ordner zeigen')))))))
        : h('p.muted', 'Noch keine Sicherungen.'));
    } catch (err) { showError(err); }
  };
  const exportBtn = h('button.primary', { type: 'button' }, 'Vollständige Sicherung exportieren');
  exportBtn.addEventListener('click', () => busy(exportBtn, async () => { try { const r = await post('/api/backup/export'); toast(`Sicherung erstellt: ${r.file}`, 'ok', 10000); drawBackups(); } catch (err) { showError(err); } }));
  const dataBox = h('div.frame.stack',
    h('h3', 'Daten & Sicherung'),
    h('dl.kv', h('dt', 'Datenordner'), h('dd', boot.dirs.data), h('dt', 'Zugangsdaten'), h('dd', s.secretBackend)),
    h('div.row',
      h('button', { type: 'button', onclick: () => post('/api/reveal', { which: 'data' }).catch(showError) }, 'Datenordner öffnen'),
      h('button', { type: 'button', onclick: () => post('/api/reveal', { which: 'exports' }).catch(showError) }, 'Exporte öffnen'),
      h('button', { type: 'button', onclick: () => post('/api/reveal', { which: 'backups' }).catch(showError) }, 'Sicherungen öffnen')),
    h('p.muted', 'Die Sicherung enthält alle Entwürfe, Vorlagen, Designs, Website-Uploads, den Verlauf und die Sicherungen von Website-Änderungen – aber keine Zugangsdaten. Beim Start wird zusätzlich täglich automatisch gesichert (14 Tage).'),
    exportBtn,
    h('div.field-label', 'Sicherung wiederherstellen'),
    dropzone({ accept: '.zip,application/zip', multiple: false, label: 'Sicherungsdatei (.zip) hierher ziehen oder klicken', onFiles: async (files) => {
      if (!(await confirmDialog({ title: 'Sicherung wiederherstellen?', text: ['Der aktuelle Stand wird vorher automatisch gesichert.', 'Danach werden Entwürfe, Vorlagen und Verlauf durch den Stand der Sicherung ersetzt; Dateien werden ergänzt.'], confirmLabel: 'Wiederherstellen' }))) return;
      try { const r = await upload('/api/upload?kind=backup', files[0]); toast(`${r.restored} Dateien wiederhergestellt. Sicherheitskopie: ${r.safetyCopy}`, 'ok', 12000); drawBackups(); } catch (err) { showError(err); }
    } }),
    h('div.field-label', 'Vorhandene Sicherungen'), backupList);

  const connBox = h('div.grid.cols-3');
  clear(main,
    h('div.page-head', h('div', h('div.eyebrow', 'Einrichtung'), h('h1', 'Einstellungen'))),
    h('section.section', h('h2', 'Status'), connBox, h('div.row', { style: { marginTop: '12px' } }, h('button.small', { type: 'button', onclick: () => loadConnections(connBox) }, 'Erneut prüfen'))),
    h('section.section', h('h2', 'Verbindungen'), h('div.grid.cols-2', shopifyBox, aiBox)),
    h('section.section', h('h2', 'Print-on-Demand-Anbieter'), h('div.grid.cols-2', mpBox.children.length ? [...mpBox.children] : mpBox)),
    h('section.section', h('h2', 'Marke & Daten'), h('div.grid.cols-2', brandBox, dataBox)));
  loadConnections(connBox);
  drawBackups();
  if (!s.ui.onboardingDone) put('/api/settings', { ui: { onboardingDone: true } }).catch(() => {});
  void state;
}
