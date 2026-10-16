# APOLOGEA — NOCTURNE · Projektstatus

> Diese Datei ist der Einstiegspunkt für jede neue Claude-Sitzung.
> Neue Sitzung: „Weiter laut PROJECT_STATUS.md“.

Stand: 2026-10-16 · Branch: `claude/apologea-shopify-theme-9kvfrj`

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
| Theme-Access-Secret | Als Network Secret hinterlegt (Header `X-Shopify-Access-Token`, Host `theme-kit-access.shopifyapps.com`). In der Einrichtungs-Sitzung noch 401 → **in neuer Sitzung testen** |
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

## Nächste Schritte
1. **Verbindungstest (neue Sitzung):** `NODE_USE_ENV_PROXY=1 shopify theme list --password shptka_placeholder`
   - Erfolg → Themes werden gelistet. Dann nur `shopify theme push --unpublished` verwenden.
   - Weiter 401 → Secret prüfen (Header-Name, Wert ohne „Bearer“-Präfix) bzw. ZIP-Variante nutzen.
2. Phase 2: NOCTURNE-Designsystem → `docs/DESIGN_SYSTEM.md`, CSS-Tokens.
3. Phase 3: Theme-Grundstruktur in `shopify-theme/` (layout, sections, snippets, templates, locales, config).
4. Erstes unveröffentlichtes Theme „APOLOGEA NOCTURNE (Dev)“ hochladen, Vorschau-Link an Nutzer.

## Offen beim Nutzer
- Logo (SVG + transparentes PNG)
- MarketPrint-App installiert? Was bietet sie an?
- Impressum-/Geschäftsdaten, Rechtstext-Anbieter, Social-Links
- 3–5 Beispielmotive (Druck-PNG + Mockups)
