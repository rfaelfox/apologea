# APOLOGEA Studio – technische Dokumentation

Lokale Windows-Arbeitsoberfläche für (1) Änderungen am bestehenden Shopify-Shop und (2) neue Produkte über MarketPrint.
Quellcode: `studio/` · Installationspaket: `node studio/tools/build-package.mjs` → `studio/dist/APOLOGEA-Studio-Installer.zip`.

## 1. Geprüfte Schnittstellen (Stand 2026-10-16)

| Dienst | Was tatsächlich geprüft wurde | Ergebnis |
|---|---|---|
| **MarketPrint** | MCP-Connector im Claude-Konto, Werkzeuge und Schemata direkt gelesen; nur lesende Aufrufe (`get_account_info`, `list_base_products`, `get_base_product_details`) | Werkzeuge: `get_account_info`, `list_base_products`, `get_base_product_details`, `list_my_images`, `upload_image` (URL oder base64 < ca. 100 KB), `upload_neckprint`, `create_shop_product`. **`create_shop_product` legt ein echtes, sofort öffentlich gelistetes Produkt an.** Kein Werkzeug für Musterbestellungen, Zahlungen, Kollektionen oder Tags. Konto ist mit zwei Shops verbunden (`dfz1mp-1u…` = APOLOGEA und ein weiterer). |
| MarketPrint-Doku | help.marketprint.de („MarketPrint mit Claude verbinden“, „… mit ChatGPT verbinden“) | Nur über Suchergebnisse lesbar (Seite aus der Sandbox nicht erreichbar). ChatGPT-Anleitung nennt eine **MCP-Server-URL mit OAuth** → direkte Nutzung aus eigenen Programmen ist technisch vorgesehen, ob MarketPrint externe Clients zulässt, ist **nicht bestätigt**. |
| **Shopify** Theme Access | Live gegen den Shop: GraphQL-Introspektion (2026-07), Themes und Theme-Dateien gelesen | Nur Themes (`themes`, `theme.files`, `themeFilesUpsert`, `themeDuplicate`, `themeDelete`). Zugriff auf `products`/`collections` → `ACCESS_DENIED`. |
| Shopify Admin-App | Introspektion der Mutationen, Doku-Recherche | Seiten (`pageCreate/pageUpdate`), Produkte (`productUpdate` mit `collectionsToJoin`, `tags`), Dateien (`stagedUploadsCreate` + `fileCreate`). `collectionAddProducts` ist veraltet. Zugang: App im **Dev Dashboard**, **Client-Credentials-Grant** (nur eigene Organisation), Token 24 h. |
| **Claude** | Anthropic-Doku (Skill), Claude-Code-CLI lokal getestet (`claude -p --output-format stream-json`) | API: eigener Schlüssel, nutzungsabhängig, unabhängig vom Abo. Claude Code: offizieller Druckmodus für Skripte; nutzt das eigene Abo-Kontingent. Drittanbieter-Produkte dürfen kein claude.ai-Login anbieten – das Studio liest daher **keine** Claude-Anmeldedaten aus, sondern ruft nur die installierte CLI auf. |

## 2. Architektur

```
Edge-App-Fenster (127.0.0.1, Sitzungs-Cookie)
        │  fetch + X-Studio-Header
Lokaler Dienst  src/server/index.js  (nur 127.0.0.1, Host-/Origin-Prüfung, Startschlüssel)
  ├─ services/  products · website · designs · backup · jobs   (Abläufe, Freigaben, Doppelschutz)
  ├─ ai/claude.js            Anthropic API (SDK) | Claude Code CLI
  ├─ integrations/shopify.js  Admin GraphQL (Theme Access | Dev-Dashboard-App)
  ├─ integrations/marketprint.js  über Claude Code | direktes MCP (OAuth) | Simulation
  ├─ secrets.js              Windows DPAPI (CurrentUser)
  └─ store.js                JSON je Sammlung, atomar geschrieben
Daten: Dokumente\APOLOGEA Studio\  (Designs, Website-Uploads, Exporte, Sicherungen, .studio\db …)
```

* **Keine API-Schlüssel im Browser**: Zugangsdaten nur im Dienst, verschlüsselt mit DPAPI.
* **Kein öffentlicher Server**: Bindung an 127.0.0.1, zufälliger Startschlüssel, HttpOnly/SameSite-Cookie, CSRF-Header, DNS-Rebinding-Schutz.
* **Keine Kosten beim Öffnen**: KI nur auf Knopfdruck; bei der API vorher Token-Zählung + Kostenschätzung + Bestätigung.
* **Inhalte ≠ Anweisungen**: Dateien, Theme-Code und MarketPrint-Texte gehen als `<daten>` an Claude; die MarketPrint-Brücke vergleicht die tatsächlich gesendeten Werkzeug-Argumente mit den freigegebenen.

### Zuverlässige Ausführung
* Freigabe = Hash über die exakten Aufrufdaten. Jede Änderung danach macht die Freigabe ungültig.
* Vor dem Schreibaufruf wird `Wird ausgeführt` dauerhaft gespeichert. Gleichzeitige Aufrufe → nur einer läuft (getestet: 3 parallele → 1× 200, 2× 409).
* Unklarer Ausgang (Abbruch, Zeitüberschreitung, Programmende) → `Ergebnis muss geprüft werden`; erneutes Ausführen gesperrt, bis der Zustand geklärt ist (automatische Suche in Shopify oder Bestätigung).
* `Erfolgreich` erst nach Bestätigung der Plattform; Website-Änderungen werden zurückgelesen (Prüfsummen).
* Website: Konfliktprüfung (Datei/Seite seit Vorschlag geändert → Abbruch ohne Schreiben), Sicherung aller betroffenen Originale (Datei + Datenbank), Wiederherstellung auf Knopfdruck. Vorschau in einer Theme-Kopie (`themeDuplicate`), das Live-Theme bleibt bis zur Freigabe unberührt.

## 3. Einschränkungen (ehrlich)
* **Installation auf deinem PC**: konnte aus der Cloud-Umgebung nicht durchgeführt werden. Installer bis zum Anlegen der Verknüpfungen in PowerShell 7 (Linux) erprobt; Verknüpfungen (COM) und Edge-App-Fenster nur unter Windows prüfbar.
* **MarketPrint über Claude Code**: Ablauf mit Ersatz-CLI getestet. Ob die lokale Claude-Code-Installation den claude.ai-Connector im Druckmodus lädt, zeigt erst „Verbindung prüfen“ auf deinem PC.
* **Direktes MCP**: OAuth-Fluss nach MCP-Standard (offizielles SDK) eingebaut, gegen MarketPrint nicht getestet (Adresse/Zulassung unbekannt).
* **Druckdateien bei MarketPrint**: Große Dateien müssen in der MarketPrint-App unter „Meine Designs“ hochgeladen und im Studio verknüpft werden (die Schnittstelle akzeptiert sonst nur öffentliche URLs oder kleine Dateien).
* **Zielshops**: Das MarketPrint-Konto ist auch mit `xgyzvd-1m.myshopify.com` (fremder Shop) verbunden. Freigegeben ist nur `dfz1mp-1u.myshopify.com`; andere Shops sind gesperrt (Prüfung in Formular, Freigabe und unmittelbar vor dem Aufruf).
* **Nackendruck** und **Musterbestellungen**: nicht über das Studio.
* **Mockups**: echte Mockups erzeugt MarketPrint erst beim Anlegen; vorher zeigt das Studio eine gekennzeichnete schematische Vorschau und das leere MarketPrint-Produktfoto.
* **Kollektionen/Tags** nach dem Anlegen nur mit Shopify-Admin-App und eindeutiger Produktsuche.
* **Logo Nr. 29**: noch nicht bereitgestellt → Wortmarke als Platzhalter; Logo unter Einstellungen → Marke hochladen.

## 4. Kosten bei Nutzung
| Posten | Kosten |
|---|---|
| APOLOGEA Studio | keine |
| Claude über **Claude Code** | keine zusätzlichen Kosten über das Studio; zählt zu den Nutzungsgrenzen deines Claude-Abos |
| Claude über **Anthropic API** | nutzungsabhängig (Opus 5.5: $4 / $20 je 1 Mio. Token Ein-/Ausgabe; Sonnet 5.5: $2 / $10; Haiku 5.5: $0,10 / $0,50). Richtwerte Opus 5.5: Produkttext wenige Cent, Website-Vorschlag ca. $0,10–0,80. Vor jedem Aufruf Schätzung. |
| MarketPrint | keine Kosten beim Anlegen; bei Kundenbestellungen mindestens Katalogpreis + Aufschläge (zweite Druckfläche, DTF, Nackendruck) |
| Shopify | keine zusätzlichen; Theme Access und eigene App sind kostenlos |

## 5. Tests
* `npm test` (in `studio/`): 17 automatische Tests – Website-Ablauf gegen **simulierten** Shopify-Server (Vorschlag → Vorschau → Freigabe → Übernahme → Sicherung → Wiederherstellung, Konflikt, ungültiges JSON), Produkt-Freigabe/Doppelschutz/Verbindungsabbruch/Ablehnung/Wiederaufnahme, Zielshop-Schutz (MarketPrint-**Simulation**), Vorlagen, Sicherung Export/Import, Druckdatei-Prüfung, Zugangsdaten, MarketPrint-Brücke mit **Ersatz-CLI**.
* `test/e2e-ui.mjs`: 40 Oberflächenprüfungen mit Playwright im Simulationsmodus (Start, beide Hauptbereiche, Uploads, Vorschauen, Formularprüfung, Speichern/Öffnen, Vorlagen, Freigabe, Doppelklick-Schutz, fehlende Zugänge, Sicherung, kleines Fenster).
* Es wurden **keine** echten Schreibaktionen bei Shopify oder MarketPrint ausgeführt.
