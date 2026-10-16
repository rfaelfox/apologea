/* APOLOGEA Handy-App – Anmeldung bei Microsoft (OAuth 2.0 mit PKCE, ohne Fremdbibliothek)
   Die Anmeldung erfolgt ausschließlich auf der Microsoft-Seite; die App sieht nie ein Passwort. */
'use strict';

const Auth = (() => {
  const cfg = window.APOLOGEA_CONFIG;
  const SCOPES = 'openid offline_access User.Read Files.ReadWrite';
  const K = 'apologea.auth.';
  const redirectUri = () => location.origin + location.pathname;

  const ls = {
    get(k) { try { return localStorage.getItem(K + k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(K + k, v); } catch (e) { /* privat */ } },
    del(k) { try { localStorage.removeItem(K + k); } catch (e) { /* privat */ } }
  };

  function b64url(bytes) {
    let s = '';
    bytes.forEach(b => { s += String.fromCharCode(b); });
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function randomString(n) {
    const a = new Uint8Array(n);
    crypto.getRandomValues(a);
    return b64url(a);
  }
  async function challenge(verifier) {
    const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
    return b64url(new Uint8Array(d));
  }

  function configured() {
    return cfg && cfg.clientId && !/HIER-CLIENT-ID/.test(cfg.clientId);
  }

  async function login() {
    const verifier = randomString(48);
    const state = randomString(16);
    ls.set('verifier', verifier);
    ls.set('state', state);
    const p = new URLSearchParams({
      client_id: cfg.clientId,
      response_type: 'code',
      redirect_uri: redirectUri(),
      response_mode: 'query',
      scope: SCOPES,
      state,
      code_challenge: await challenge(verifier),
      code_challenge_method: 'S256',
      prompt: 'select_account'
    });
    location.assign(cfg.authority + '/oauth2/v2.0/authorize?' + p.toString());
  }

  async function tokenRequest(params) {
    const body = new URLSearchParams(Object.assign({ client_id: cfg.clientId, scope: SCOPES }, params));
    const r = await fetch(cfg.authority + '/oauth2/v2.0/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString()
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) {
      const err = new Error(d.error_description ? 'Anmeldung fehlgeschlagen: ' + d.error_description.split('\r\n')[0] : 'Anmeldung fehlgeschlagen.');
      err.code = d.error;
      throw err;
    }
    ls.set('access', d.access_token);
    ls.set('expires', String(Date.now() + (d.expires_in - 120) * 1000));
    if (d.refresh_token) ls.set('refresh', d.refresh_token);
    return d.access_token;
  }

  /** Nach der Rückkehr von Microsoft: Code gegen Token tauschen. Gibt true zurück, wenn eine Anmeldung abgeschlossen wurde. */
  async function handleRedirect() {
    const q = new URLSearchParams(location.search);
    if (q.get('error')) {
      history.replaceState(null, '', redirectUri());
      throw new Error('Anmeldung abgebrochen: ' + (q.get('error_description') || q.get('error')));
    }
    const code = q.get('code');
    if (!code) return false;
    history.replaceState(null, '', redirectUri());
    if (q.get('state') !== ls.get('state')) throw new Error('Anmeldung konnte nicht bestätigt werden (ungültiger Status). Bitte erneut anmelden.');
    await tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: redirectUri(), code_verifier: ls.get('verifier') });
    ls.del('verifier'); ls.del('state');
    return true;
  }

  function signedIn() { return !!(ls.get('refresh') || ls.get('access')); }

  let refreshing = null;
  /** Liefert ein gültiges Zugriffstoken; erneuert es bei Bedarf. */
  async function token() {
    const t = ls.get('access');
    if (t && Date.now() < +(ls.get('expires') || 0)) return t;
    const rt = ls.get('refresh');
    if (!rt) { const e = new Error('Bitte erneut anmelden.'); e.code = 'login_required'; throw e; }
    if (!refreshing) {
      refreshing = tokenRequest({ grant_type: 'refresh_token', refresh_token: rt })
        .catch(err => { if (err.code === 'invalid_grant') { ls.del('refresh'); ls.del('access'); err.code = 'login_required'; err.message = 'Die Anmeldung ist abgelaufen. Bitte erneut anmelden.'; } throw err; })
        .finally(() => { refreshing = null; });
    }
    return refreshing;
  }

  function logout() {
    ['access', 'refresh', 'expires', 'verifier', 'state'].forEach(ls.del);
  }

  return { configured, login, handleRedirect, signedIn, token, logout, redirectUri };
})();
