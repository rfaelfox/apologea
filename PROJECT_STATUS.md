# APOLOGEA — NOCTURNE · Projektstatus

> Diese Datei ist der Einstiegspunkt für jede neue Claude-Sitzung.
> Neue Sitzung: „Weiter laut PROJECT_STATUS.md“.

Stand: 2026-10-16 (Sitzung 2) · Branch: `claude/apologea-shopify-theme-9kvfrj`

## Auftrag (Kurzfassung)
Eigenes Shopify-Online-Store-2.0-Theme „NOCTURNE“ für APOLOGEA (Luxury Christian Streetwear),
inkl. Sacred-Cinematic-Animationen, Multi-POD-Datenmodell (MarketPrint zuerst), Produktimport-Workflow,
Dokumentation. Vollständiger Master-Prompt: liegt beim Nutzer; Kernregeln siehe unten.

## Harte Regeln
- Live-Theme **niemals** veröffentlichen, ersetzen oder ändern. Nur unveröffentlichte Entwicklungs-Themes.
- Keine kostenpflichtigen Aktionen, keine echten POD-Aufträge, keine Löschungen ohne Freigabe.
- Original-Logo nicht verändern; bis zur Bereitstellung klar markierter Platzhalter.
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
| Theme-Access-Secret | Als Network Secret hinterlegt (Header `X-Shopify-Access-Token`, Host `theme-kit-access.shopifyapps.com`). **Auch in Sitzung 2 weiterhin 401** (siehe unten) |
| Env-Variable | `SHOPIFY_FLAG_STORE=dfz1mp-1u.myshopify.com` (gilt ab neuer Sitzung) |
| Setup-Skript | `npm install -g @shopify/cli` |
| Shopify CLI | 4.9.4 installierbar ✔ |
| MarketPrint | Status unbekannt — Nutzer fragen, ob App im Shop installiert ist |
| Logo / Assets | noch nicht bereitgestellt |

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

## Nächste Schritte
1. **Nutzer:** Theme-Access-Passwort neu erzeugen und Network Secret neu eintragen (nur der nackte
   `shptka_…`-Wert, ohne Leerzeichen/„Bearer“) — dann neue Sitzung, Verbindungstest wiederholen.
   Alternativ ZIP selbst hochladen (unveröffentlicht).
2. Erstes unveröffentlichtes Theme „APOLOGEA NOCTURNE (Dev)“ hochladen
   (`shopify theme push --unpublished`, siehe `shopify-theme/README.md`), Vorschau-Link an Nutzer, visuell prüfen.
3. Metafeld-Definitionen anlegen (manuell im Admin — kein Admin-API-Zugang vorhanden).
4. Feinschliff nach Vorschau: Mega-Menü, Ajax-Warenkorb-Drawer, Produkt-Empfehlungen, Lookbook-Sektion.
5. Echtes Logo einsetzen, sobald geliefert.

## Offen beim Nutzer
- Logo (SVG + transparentes PNG)
- MarketPrint-App installiert? Was bietet sie an?
- Impressum-/Geschäftsdaten, Rechtstext-Anbieter, Social-Links
- 3–5 Beispielmotive (Druck-PNG + Mockups)
