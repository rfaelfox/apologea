import crypto from 'node:crypto';
import { getSettings } from '../store.js';
import { getSecret } from '../secrets.js';

/**
 * Live-Ansicht des Shops im Programm (wie die Vorschau im Shopify-Theme-Editor).
 *
 * Shopify erlaubt nicht, den Shop in fremde Fenster einzubetten. Darum holt der lokale Dienst die Seiten
 * selbst (nur lesend, nur GET, nur vom eigenen Shop) und liefert sie unter /vorschau/<schlüssel>/<theme>/<pfad> aus.
 * Sicherheit: Die Seiten laufen in einer abgeschotteten Umgebung (CSP „sandbox“ + iframe-sandbox) ohne Zugriff
 * auf das Programm, seine Anmeldung oder die Schnittstellen. Der Vorschau-Schlüssel gilt nur für diesen Programmstart.
 * Ist der Shop passwortgeschützt, meldet sich der Dienst mit dem hinterlegten Shop-Passwort an (Einstellungen).
 */

export const previewToken = crypto.randomBytes(18).toString('base64url');
const PREFIX = `/vorschau/${previewToken}`;
const jar = new Map(); // Host → { name: wert }
let allowedHosts = new Set();

function storeBase() {
  if (process.env.APOLOGEA_TEST === '1' && process.env.APOLOGEA_STOREFRONT_URL) return new URL(process.env.APOLOGEA_STOREFRONT_URL);
  const domain = getSettings().shop.domain;
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(domain || '')) return null;
  return new URL(`https://${domain}`);
}

function refreshAllowed(base) {
  const s = getSettings().shop;
  allowedHosts = new Set([base.host]);
  try { if (s.publicUrl) allowedHosts.add(new URL(s.publicUrl).host); } catch { /* ignorieren */ }
  for (const h of jar.keys()) allowedHosts.add(h);
}

function cookieHeader(host) {
  const c = jar.get(host);
  return c ? Object.entries(c).map(([k, v]) => `${k}=${v}`).join('; ') : '';
}

function storeCookies(host, res) {
  const list = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
  if (!list.length) return;
  const c = jar.get(host) || {};
  for (const line of list) {
    const [pair] = line.split(';');
    const i = pair.indexOf('=');
    if (i > 0) c[pair.slice(0, i).trim()] = pair.slice(i + 1).trim();
  }
  jar.set(host, c);
}

/** GET mit eigener Weiterleitungsbehandlung (Cookies je Host, nur Shop-Hosts). */
async function get(url, depth = 0) {
  if (depth > 6) throw new Error('Zu viele Weiterleitungen');
  if (!allowedHosts.has(url.host)) throw new Error(`Fremde Adresse wird nicht geladen: ${url.host}`);
  const res = await fetch(url, { redirect: 'manual', headers: { 'User-Agent': 'Mozilla/5.0 APOLOGEA-Studio-Vorschau', Accept: '*/*', 'Accept-Language': 'de-DE,de;q=0.9', Cookie: cookieHeader(url.host) }, signal: AbortSignal.timeout(30_000) });
  storeCookies(url.host, res);
  if ([301, 302, 303, 307, 308].includes(res.status)) {
    const next = new URL(res.headers.get('location'), url);
    // Weiterleitung von der myshopify-Adresse auf die eigene Domain des Shops zulassen
    if (next.host !== url.host && (url.host.endsWith('.myshopify.com') || allowedHosts.has(url.host)) && depth === 0) allowedHosts.add(next.host);
    return get(next, depth + 1);
  }
  return { res, url };
}

async function login(host) {
  const password = await getSecret('shopify.storefrontPassword');
  if (!password) return false;
  const url = new URL('/password', `https://${host}`);
  if (process.env.APOLOGEA_TEST === '1' && process.env.APOLOGEA_STOREFRONT_URL) url.href = new URL('/password', process.env.APOLOGEA_STOREFRONT_URL).href;
  const body = new URLSearchParams({ form_type: 'storefront_password', utf8: '✓', password });
  const res = await fetch(url, { method: 'POST', redirect: 'manual', body, headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookieHeader(url.host), 'User-Agent': 'Mozilla/5.0 APOLOGEA-Studio-Vorschau' }, signal: AbortSignal.timeout(30_000) });
  storeCookies(url.host, res);
  const loc = res.headers.get('location') || '';
  return res.status >= 300 && res.status < 400 && !/\/password/.test(loc);
}

function rewrite(text, hosts, themePart, kind) {
  const P = `${PREFIX}/${themePart}`;
  let out = text;
  for (const host of hosts) {
    const h = host.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    out = out.replace(new RegExp(`https?:(\\\\?/){2}${h}(?=[/"'\\\\?#]|$)`, 'g'), P).replace(new RegExp(`(["'(\\s,])//${h}(?=/)`, 'g'), `$1${P}`);
  }
  if (kind === 'html') {
    out = out.replace(/((?:href|src|action|srcset|data-src|data-srcset|poster|content)=["'])\/(?!\/|vorschau\/)/gi, `$1${P}/`);
    out = out.replace(/([\s,]["']?)\/cdn\/shop\//g, `$1${P}/cdn/shop/`);
  }
  out = out.replace(/url\((["']?)\/(?!\/|vorschau\/)/g, `url($1${P}/`);
  return out;
}

const INJECT = `<style>
.__studio-hl{outline:2px solid #b8955a!important;outline-offset:-2px;cursor:pointer;position:relative}
.__studio-sel{outline:3px solid #cfae72!important;outline-offset:-3px}
#__studio-tag{position:fixed;z-index:2147483647;pointer-events:none;background:#b8955a;color:#0b0a09;font:600 12px/1.6 Segoe UI,sans-serif;padding:2px 8px;display:none}
</style><script>(function(){
var mode='select',hl=null,sel=null,tag=document.createElement('div');tag.id='__studio-tag';
function sec(el){while(el&&el!==document.body){if(el.id&&el.id.indexOf('shopify-section-')===0)return el;el=el.parentElement}return null}
function label(el){var h=el.querySelector('h1,h2,h3');var t=el.id.replace('shopify-section-','');return (h&&h.textContent.trim().slice(0,40))||(t.indexOf('__')>0?'Abschnitt':t)}
function send(m){try{parent.postMessage(Object.assign({__studio:1},m),'*')}catch(e){}}
document.addEventListener('DOMContentLoaded',function(){document.body.appendChild(tag);send({type:'page',path:location.pathname.replace(${JSON.stringify(PREFIX)}+'/','/').replace(/^\\/[^/]+/,''),title:document.title,sections:[].map.call(document.querySelectorAll('[id^="shopify-section-"]'),function(s){return {domId:s.id,label:label(s)}})})});
document.addEventListener('mouseover',function(e){if(mode!=='select')return;var s=sec(e.target);if(hl&&hl!==s)hl.classList.remove('__studio-hl');hl=s;if(s){s.classList.add('__studio-hl');var r=s.getBoundingClientRect();tag.textContent=label(s);tag.style.display='block';tag.style.left=Math.max(0,r.left)+'px';tag.style.top=Math.max(0,r.top)+'px'}else tag.style.display='none'},true);
document.addEventListener('click',function(e){var a=e.target.closest&&e.target.closest('a[href]');if(mode==='select'){var s=sec(e.target);if(s){e.preventDefault();e.stopPropagation();if(sel)sel.classList.remove('__studio-sel');sel=s;s.classList.add('__studio-sel');send({type:'select',domId:s.id,label:label(s)})}return}
if(a){var u=new URL(a.href,location.href);if(u.origin!==location.origin){e.preventDefault();send({type:'external',href:a.href})}}},true);
document.addEventListener('submit',function(e){e.preventDefault()},true);
window.addEventListener('message',function(e){var d=e.data||{};if(d.__studio!==1)return;if(d.type==='mode'){mode=d.mode;if(hl)hl.classList.remove('__studio-hl');tag.style.display='none'}
if(d.type==='highlight'){var el=document.getElementById(d.domId);if(el){if(sel)sel.classList.remove('__studio-sel');sel=el;el.classList.add('__studio-sel');el.scrollIntoView({behavior:'smooth',block:'center'})}}});
})();</script>`;

function infoPage(title, text) {
  return `<!doctype html><meta charset="utf-8"><title>${title}</title><body style="margin:0;display:grid;place-items:center;min-height:100vh;background:#121110;color:#efe6d4;font:15px/1.6 Segoe UI,sans-serif"><div style="max-width:520px;padding:32px;border:1px solid #3a342a"><h2 style="font-family:Palatino Linotype,Georgia,serif;color:#cfae72;font-weight:400">${title}</h2><p>${text}</p></div></body>`;
}

const HOP = new Set(['content-encoding', 'content-length', 'transfer-encoding', 'connection', 'content-security-policy', 'content-security-policy-report-only', 'x-frame-options', 'set-cookie', 'strict-transport-security', 'report-to', 'nel', 'link', 'alt-svc']);

/** Bearbeitet /vorschau/<schlüssel>/<theme|live>/<pfad>. */
export async function handle(req, res, url) {
  const send = (status, body, type = 'text/html; charset=utf-8', extra = {}) => {
    res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'Content-Security-Policy': 'sandbox allow-scripts', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', ...extra });
    res.end(body);
  };
  const rest = url.pathname.slice('/vorschau/'.length).split('/');
  const tok = rest.shift() || '';
  if (tok.length !== previewToken.length || !crypto.timingSafeEqual(Buffer.from(tok), Buffer.from(previewToken))) return send(403, 'Vorschau-Schlüssel ungültig. Bitte die Website-Ansicht neu öffnen.', 'text/plain; charset=utf-8');
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(405, infoPage('Nur Ansicht', 'In der Vorschau können keine Formulare abgeschickt werden.'));
  const themePart = rest.shift() || 'live';
  if (!/^(live|\d{1,20})$/.test(themePart)) return send(400, 'Ungültiges Theme', 'text/plain; charset=utf-8');
  const base = storeBase();
  if (!base) return send(200, infoPage('Shop-Adresse fehlt', 'Bitte in den Einstellungen die Shop-Adresse (name.myshopify.com) eintragen.'));
  refreshAllowed(base);

  // Zielhost: Pfadteil „~host~“ steht für Dateien von einer anderen erlaubten Adresse (z. B. eigene Domain)
  let host = base.host;
  if (rest[0]?.startsWith('~') && rest[0].endsWith('~')) { const h = rest.shift().slice(1, -1); if (allowedHosts.has(h)) host = h; }
  const target = new URL('/' + rest.map(encodeURIComponent).join('/').replace(/%2F/g, '/'), `${base.protocol}//${host}`);
  for (const [k, v] of url.searchParams) target.searchParams.append(k, v);
  if (themePart !== 'live') target.searchParams.set('preview_theme_id', themePart);

  let r;
  try {
    r = await get(target);
    if (/\/password$/.test(r.url.pathname) && !/\/password$/.test(target.pathname)) {
      const ok = await login(r.url.host);
      if (!ok) {
        const has = Boolean(await getSecret('shopify.storefrontPassword'));
        return send(200, infoPage('Shop ist passwortgeschützt', has ? 'Die Anmeldung mit dem hinterlegten Shop-Passwort hat nicht geklappt. Bitte unter Einstellungen → Shopify → „Shop-Passwort (Vorschau)“ prüfen.' : 'Dein Shop ist noch mit einem Passwort geschützt. Bitte das Shop-Passwort unter Einstellungen → Shopify → „Shop-Passwort (Vorschau)“ hinterlegen. Es wird verschlüsselt auf diesem PC gespeichert.'));
      }
      r = await get(target);
    }
  } catch (err) {
    return send(502, infoPage('Shop nicht erreichbar', String(err.message || err)));
  }
  const ct = r.res.headers.get('content-type') || 'application/octet-stream';
  const headers = {};
  for (const [k, v] of r.res.headers) if (!HOP.has(k.toLowerCase()) && !['content-type', 'cache-control'].includes(k.toLowerCase())) headers[k] = v;
  const hosts = [...allowedHosts];
  if (/text\/html/.test(ct)) {
    let html = rewrite(await r.res.text(), hosts, themePart, 'html');
    html = html.includes('</head>') ? html.replace('</head>', `${INJECT}</head>`) : INJECT + html;
    // Shopify-Leiste „Vorschau“ ausblenden (gehört zum Shopify-Admin, nicht zum Shop)
    html = html.replace('</head>', '<style>#preview-bar-iframe,#PBarNextFrameWrapper{display:none!important}</style></head>');
    return send(r.res.status, html, ct, headers);
  }
  if (/text\/css|javascript|json/.test(ct)) return send(r.res.status, rewrite(await r.res.text(), hosts, themePart, 'css'), ct, headers);
  return send(r.res.status, Buffer.from(await r.res.arrayBuffer()), ct, headers);
}

export function previewBase(themeId) {
  return `${PREFIX}/${themeId ? String(themeId).replace(/\D/g, '') : 'live'}`;
}

export function resetSession() { jar.clear(); }
