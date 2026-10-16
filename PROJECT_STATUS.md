# APOLOGEA — NOCTURNE · Projektstatus

> Diese Datei ist der Einstiegspunkt für jede neue Claude-Sitzung.
> Neue Sitzung: „Weiter laut PROJECT_STATUS.md“.

Stand: 2026-10-16 (Sitzung 3, Teil 2) · Branch: `claude/apologea-shopify-theme-9kvfrj`

## Auftrag (Kurzfassung)
Eigenes Shopify-Online-Store-2.0-Theme „NOCTURNE“ für APOLOGEA (Luxury Christian Streetwear),
inkl. Sacred-Cinematic-Animationen, Multi-POD-Datenmodell (MarketPrint zuerst), Produktimport-Workflow,
Dokumentation. Vollständiger Master-Prompt: liegt beim Nutzer; Kernregeln siehe unten.

## Harte Regeln
- Live-Theme **niemals** veröffentlichen, ersetzen oder ändern. Nur unveröffentlichte Entwicklungs-Themes.
- Keine kostenpflichtigen Aktionen, keine echten POD-Aufträge, keine Löschungen ohne Freigabe.
- Original-Logo nicht verändern (liegt jetzt vor, siehe `docs/brand/`).
- Keine erfundenen Tool-Ergebnisse, Bibelzitate, theologischen/historischen Fakten, Rechtsaussagen.
- Die bestehende **APOLOGEA Handy-App** (PWA im Repo-Root: index.html, app.js, …) bleibt unangetastet.
  Theme-Code kommt nach `shopify-theme/`, Doku nach `docs/`.

## Phase 1 — Technical Discovery (Ergebnis)
| Punkt | Befund |
|---|---|
| Repository | Enthält nur die Handy-App (OneDrive-Kollektionsverwaltung). Kein Theme vorhanden. |
| Shopify-Store | `dfz1mp-1u.myshopify.com` (Shop-Name „Apologea“) |
| Live-Theme | „Horizon“ (benannt „apologea.eu“) — **nicht anfassen** |
| Weitere Themes | Entwurf „Feather“ — nicht anfassen |
| Theme Access App | im Shop installiert; Passwort vom Nutzer erzeugt |
| Claude-Connectors | nur Gmail. **Kein Shopify-, kein MarketPrint-Connector.** |
| Netzwerk | Benutzerdefiniert: `*.myshopify.com`, `theme-kit-access.shopifyapps.com` + Paketmanager. Erreichbarkeit getestet ✔ |
| Theme-Access-Secret | Als Network Secret hinterlegt (Header `X-Shopify-Access-Token`, ohne Präfix, Host `theme-kit-access.shopifyapps.com`). **Funktioniert ab Sitzung 3** ✔ |
| Env-Variable | `SHOPIFY_FLAG_STORE=dfz1mp-1u.myshopify.com` (gilt ab neuer Sitzung) |
| Setup-Skript | `npm install -g @shopify/cli` |
| Shopify CLI | 4.9.4 installierbar ✔ |
| MarketPrint | Status unbekannt — Nutzer fragen, ob App im Shop installiert ist |
| Logo / Assets | Logo geliefert ✔ → `docs/brand/` (Original + 3 SVGs) |

### Wichtiger technischer Hinweis
Node-`fetch` ignoriert den Proxy. Shopify-CLI-Befehle **immer** mit `NODE_USE_ENV_PROXY=1` ausführen, z. B.:
```bash
NODE_USE_ENV_PROXY=1 shopify theme list --password shptka_placeholder
```
Das echte Passwort injiziert der Proxy als Header; im Befehl steht nur ein Platzhalter mit Präfix `shptka_`
(die CLI erkennt daran den Theme-Access-Modus).

## Sitzung 2 (2026-10-16) — Ergebnis

### Verbindungstest
`NODE_USE_ENV_PROXY=1 shopify theme list --store dfz1mp-1u.myshopify.com --password shptka_placeholder`
→ **401 „Invalid API key or access token (unrecognized login or wrong password)“**.
Gegenprobe per `curl` direkt an `https://theme-kit-access.shopifyapps.com/cli/admin/api/2025-07/graphql.json`
(mit und ohne eigenen Header): ebenfalls 401. Netzwerk/Proxy funktionieren also, aber das injizierte
Passwort wird von Theme Access abgelehnt. Wahrscheinliche Ursachen (vom Nutzer zu prüfen):
- Wert im Network Secret enthält Leerzeichen/Zeilenumbruch, ein Präfix wie „Bearer “ oder ist abgeschnitten.
- Passwort wurde in der Theme-Access-App neu erzeugt/widerrufen → altes ungültig.
- Passwort gehört zu einem anderen Shop.
→ Bis das gelöst ist: Theme per **ZIP-Upload** einspielen (siehe `shopify-theme/README.md`).

### Phase 2 — Designsystem ✔
`docs/DESIGN_SYSTEM.md`: Farben (aus der App-Palette übernommen, Kontraste berechnet), Typografie,
Raster, Formensprache, Bewegungsregeln „Sacred Cinematic“, Komponenten, Logo-Platzhalter-Regel.

### Phase 3 — Theme-Grundstruktur ✔ (`shopify-theme/`)
- Layouts: `theme`, `password`. Header-/Footer-Gruppen.
- Startseite: Hero „Sacred“ (Lichtstrahlen, Ken-Burns, gestaffelter Reveal), Ausgewählte Kollektion,
  Bibelstelle (leer, vom Händler zu füllen), Bild mit Text, Kollektionen, Manifest, Newsletter.
- Seiten: Produkt (Varianten-Picker, Metafelder, JSON-LD), Kollektion (Sortierung, Paginierung),
  Kollektionsliste, Warenkorb, Seite, Suche, Blog, Beitrag, 404, Passwort, Kundenkonto (alle 7), Geschenkkarte.
- Theme-Einstellungen: Farben, Schriften, Animationen an/aus, Körnung, Produktkarten, Social Links.
- Sprachen: Deutsch (Standard), Englisch.
- `shopify theme check`: **57 Dateien, 0 Befunde**. JSON- und JS-Syntax geprüft.
- `docs/POD_DATA_MODEL.md`: Metafeld-Entwurf (Namespace `apologea`) + Import-Workflow.
- Noch **nicht** in Shopify hochgeladen (wegen 401) und **nicht** im Browser gerendert getestet.

## Sitzung 3 (2026-10-16) — Ergebnis
- Network Secret vom Nutzer neu angelegt (Header `X-Shopify-Access-Token`, ohne „Bearer“).
- Verbindungstest `shopify theme list` ✔ — Themes: Horizon [live] #202475110735, Feather [unpublished] #202485956943.
- `shopify theme check --path shopify-theme`: 57 Dateien, 0 Befunde.
- `shopify theme push --unpublished --theme "APOLOGEA NOCTURNE (Dev)"` ✔ → neues Theme
  **#202489921871** [unpublished]. Horizon und Feather unverändert.
  (Nach „Theme upload complete“ meldete die CLI ein `ECONNRESET` — nur Nachlauf; per `theme pull`
  geprüft: alle 59 Dateien sind auf dem Server.)
- Vorschau: https://dfz1mp-1u.myshopify.com?preview_theme_id=202489921871
- Editor: https://dfz1mp-1u.myshopify.com/admin/themes/202489921871/editor
- Netzwerk-Allowlist vom Nutzer erweitert: `apologea.eu`, `www.apologea.eu`, `cdn.shopify.com` (wirkt sofort).
- Vorschau per Playwright gerendert (Desktop 1440 px, Mobil 390 px): Shop ist **passwortgeschützt**,
  daher nur die Passwortseite sichtbar — sie rendert mit NOCTURNE korrekt (Lichtstrahlen, Wortmarke,
  Newsletter-Formular, „Shop mit Passwort betreten“), keine Liquid-Fehler. Fehlgeschlagene Requests nur
  Shopify-Tracking/Shop Pay (shop.app, shopifysvc.com, monorail) — nicht theme-relevant.
- Startseite/Produkt/Kollektion etc. noch **nicht** gerendert geprüft → braucht Storefront-Passwort
  (Online Store → Einstellungen) oder Prüfung durch Nutzer im Admin.
- Künftige Updates ins selbe Dev-Theme: `NODE_USE_ENV_PROXY=1 shopify theme push --path shopify-theme
  --theme 202489921871 --password shptka_placeholder` (nie `--publish`/`--live`).

### Sitzung 3, Teil 2 — Logo + Render-Test
- Logo vom Nutzer erhalten (1254×1254 WebP, Gold auf Schwarz). Vektorisiert (vtracer, 4× hochskaliert,
  Schwelle auf Helligkeit) → `apologea-logo.svg` / `-wordmark.svg` / `-emblem.svg`, Abgleich mit Original ≈ 97,6 % IoU.
  Relief → Goldverlauf. Details: `docs/DESIGN_SYSTEM.md` §7.
- Eingebaut: Header (Variante wählbar, Standard Schriftzug 170 px, mobil ≤ 128 px), Footer (Kreuz + Schriftzug),
  Passwortseite (Kreuz + Schriftzug statt Text-H1), Favicon (Kreuz, falls kein eigenes gesetzt).
  Platzhalter-Logik + Übersetzungsschlüssel `general.logo_placeholder` entfernt.
- Render-Test mit Storefront-Passwort (Passwort NICHT im Repo; Nutzer gibt es bei Bedarf erneut an):
  Startseite, Kollektionsliste, Kollektion, Produkt, Warenkorb, Suche, 404 — Desktop 1440 px + Mobil 390 px:
  keine Liquid-Fehler, keine Theme-JS-Fehler, kein horizontales Scrollen.
- Dabei behoben: Produkttitel lief am Desktop rechts aus dem Bild (kleinere Größe + Umbruch);
  `body { overflow-x: clip }` gegen Körnungs-Overlay; Logo-H1 hatte Überschriften-Abstand (Versatz);
  Header-Raster mittig (minmax), mobile Icons 36 px; leere Bibelstelle wird im Shop ausgeblendet (nur im Editor Hinweis).
- Shop enthält nur Beispielprodukte (Horizon-Demo) → „Ausgewählte Kollektion“ zeigt Platzhalter, bis eine Kollektion gewählt ist.
- Theme-Check: 57 Dateien, 0 Befunde. Alles in Dev-Theme #202489921871 gepusht (unveröffentlicht).

## Nächste Schritte
1. **Nutzer:** Vorschau ansehen (Admin → Onlineshop → NOCTURNE → „…“ → Vorschau), Feedback geben.
2. Inhalte im Theme-Editor: Hero-Bild, Kollektion für „Die Kollektion“, Markengeschichte, Manifest, Bibelstelle (Nutzer wählt Vers + Übersetzung).
3. MarketPrint-Status klären (App im Shop installiert?) → Produktimport-Workflow (`docs/POD_DATA_MODEL.md`).
4. Echte Produkte anlegen/importieren, dann Produkt- und Kollektionsseiten erneut prüfen.
