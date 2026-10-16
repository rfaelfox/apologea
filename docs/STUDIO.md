# APOLOGEA Studio – technische Dokumentation (Version 1.1)

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

## 1a. Weitere Print-on-Demand-Anbieter (geprüft 2026-10-16, nur Doku/Recherche – noch keine Konten)

| Anbieter | Schnittstelle | Was das Studio damit kann |
|---|---|---|
| **Printify** | Offizielle REST-API v1 (`api.printify.com/v1`), persönlicher Zugangsschlüssel (Bearer). Grenzen laut Doku: 600 Anfragen/Min., Katalog 100/Min., Veröffentlichen 200 je 30 Min. | Katalog (Blueprints) → Druckdienstleister → Varianten/Druckflächen; Datei-Upload (base64); Produkt als **Entwurf** im Printify-Konto anlegen (echte Mockups ansehen); **Veröffentlichen** an den verbundenen Shopify-Shop (asynchron – Erfolg erst, wenn Printify die Shopify-ID meldet). Preise in Cent. Einkaufspreise liefert der Katalog nicht → werden nicht angezeigt/erfunden. |
| **Printful** | Offizielle REST-API v1 (`api.printful.com`), privater Zugangsschlüssel, `X-PF-Store-Id`. | Katalog mit Grundpreisen, Druckflächen (Printfiles), echte Mockups (Mockup-Generator). **Anlegen nur in „Manual order / API“-Shops** – laut Printful-Doku unterstützt die Products-API keine Produkte in Shopify-verbundenen Shops. Dateien nimmt Printful nur per öffentlicher URL an → Datei in der Printful-Datei-Bibliothek hochladen und per ID verknüpfen. |

## 2. Architektur

```
Edge-App-Fenster (127.0.0.1, Sitzungs-Cookie)
        │  fetch + X-Studio-Header
Lokaler Dienst  src/server/index.js  (nur 127.0.0.1, Host-/Origin-Prüfung, Startschlüssel)
  ├─ services/  products · website · designs · backup · jobs   (Abläufe, Freigaben, Doppelschutz)
  ├─ ai/claude.js            Anthropic API (SDK) | Claude Code CLI
  ├─ integrations/shopify.js  Admin GraphQL (Theme Access | Dev-Dashboard-App)
  ├─ providers/              Print-on-Demand-Bausteine (einheitlicher Vertrag, siehe Abschnitt 2a)
  │    ├─ registry.js         Liste der Anbieter
  │    ├─ base.js             Vertrag, REST-Aufrufe, Zwischenspeicher, Simulation
  │    ├─ marketprint.js      → integrations/marketprint.js (Claude Code | MCP | Simulation)
  │    ├─ printify.js         REST-API v1 | Simulation
  │    └─ printful.js         REST-API v1 | Simulation
  ├─ secrets.js              Windows DPAPI (CurrentUser)
  └─ store.js                JSON je Sammlung, atomar geschrieben
Daten: Dokumente\APOLOGEA Studio\  (Designs, Website-Uploads, Exporte, Sicherungen, .studio\db …)
```

* **Keine API-Schlüssel im Browser**: Zugangsdaten nur im Dienst, verschlüsselt mit DPAPI.
* **Kein öffentlicher Server**: Bindung an 127.0.0.1, zufälliger Startschlüssel, HttpOnly/SameSite-Cookie, CSRF-Header, DNS-Rebinding-Schutz.
* **Keine Kosten beim Öffnen**: KI nur auf Knopfdruck; bei der API vorher Token-Zählung + Kostenschätzung + Bestätigung.
* **Inhalte ≠ Anweisungen**: Dateien, Theme-Code und MarketPrint-Texte gehen als `<daten>` an Claude; die MarketPrint-Brücke vergleicht die tatsächlich gesendeten Werkzeug-Argumente mit den freigegebenen.

### 2a. Anbieter-Bausteine – neuen Anbieter ergänzen
1. `studio/src/server/providers/<id>.js` anlegen und den Vertrag aus `providers/base.js` erfüllen:
   `meta` (Name, Verbindungsarten, Zugangsschlüssel, Fähigkeiten), `account`, `testConnection`, `catalog`, `catalogOptions`,
   `details` (einheitliches Format: Druckflächen in Pixeln, Varianten mit Farbe/Größe/Preis oder `null`), `listImages`, `uploadImage`,
   `buildRequest` (exakt gesendete Daten – Grundlage für den Freigabe-Hash), `publish`, `reconcile`, optional `mockups`, `verifyImage`.
2. In `providers/registry.js` eintragen; Zugangsschlüssel-Namen in `src/server/index.js` (`SECRET_NAMES`) ergänzen.
3. Optional Simulationsdaten unter `fixtures/<id>/sim.js` (klar als erfundene Beispieldaten markiert) und Tests nach dem Muster `test/providers.test.mjs`.
Alles Übrige – Oberfläche (Anbieterwahl, Katalog, Varianten, Druckflächen, Platzierung, Verknüpfungen, Einstellungen), Druckdatei-Prüfung,
Freigabe, Doppelschutz, Zielshop-Sperre, Ergebnisprüfung, Vorlagen, Verlauf – funktioniert ohne weitere Änderungen.
Die Oberfläche blendet Funktionen anhand von `meta.capabilities` ein oder aus (z. B. benannte Positionen, Mockup-Auswahl, echte Mockups).

### Zuverlässige Ausführung
* Freigabe = Hash über die exakten Aufrufdaten. Jede Änderung danach macht die Freigabe ungültig.
* Vor dem Schreibaufruf wird `Wird ausgeführt` dauerhaft gespeichert. Gleichzeitige Aufrufe → nur einer läuft (getestet: 3 parallele → 1× 200, 2× 409).
* Unklarer Ausgang (Abbruch, Zeitüberschreitung, Programmende) → `Ergebnis muss geprüft werden`; erneutes Ausführen gesperrt, bis der Zustand geklärt ist (automatische Suche in Shopify oder Bestätigung).
* `Erfolgreich` erst nach Bestätigung der Plattform; Website-Änderungen werden zurückgelesen (Prüfsummen).
* Website: Konfliktprüfung (Datei/Seite seit Vorschlag geändert → Abbruch ohne Schreiben), Sicherung aller betroffenen Originale (Datei + Datenbank), Wiederherstellung auf Knopfdruck. Vorschau in einer Theme-Kopie (`themeDuplicate`), das Live-Theme bleibt bis zur Freigabe unberührt.

## 2b. Programm-Aktualisierung (ab 1.2.0)
- Einstellungen → „Programm“ bzw. Hinweis auf der Startseite. Suchen = eine kostenlose Abfrage bei GitHub
  (öffentliches Repository `rfaelfox/apologea`, Zweig `claude/apologea-shopify-theme-9kvfrj`, Ordner `studio/`).
- `studio/update.json` listet alle Programmdateien mit SHA-256. Erzeugen mit `node tools/manifest.mjs`
  (passiert auch beim Paketbau); ein Test schlägt fehl, wenn die Liste nicht zum Stand passt.
- Erst nach Klick und Bestätigung: geänderte Dateien des geprüften Commits laden, jede Prüfsumme kontrollieren
  (bei Abweichung wird nichts verändert), alte Fassung nach `.studio/programm-sicherung/` sichern (letzte 5),
  Dateien ersetzen, Dienst mit gleichem Port und Startschlüssel neu starten – das Fenster lädt sich neu.
- Geschrieben werden nur `launcher.js`, `package*.json`, `src/`, `public/`, `fixtures/`. Daten, Zugangsdaten,
  `node_modules` und die Node.js-Laufzeit bleiben unberührt. Ändern sich Abhängigkeiten, verlangt das Programm
  einmal das Installationspaket. Während ein Vorgang läuft, wird nicht aktualisiert.
- Sicherheitshinweis: Wer auf diesen Zweig schreiben kann, kann über die Aktualisierung Programmcode auf den PC
  bringen. Darum nur nach ausdrücklichem Klick, und das GitHub-Konto sollte mit Zwei-Faktor-Anmeldung geschützt sein.

## 3. Einschränkungen (ehrlich)
* **Installation auf deinem PC**: konnte aus der Cloud-Umgebung nicht durchgeführt werden. Installer bis zum Anlegen der Verknüpfungen in PowerShell 7 (Linux) erprobt; Verknüpfungen (COM) und Edge-App-Fenster nur unter Windows prüfbar.
* **MarketPrint über Claude Code**: Ablauf mit Ersatz-CLI getestet. Ob die lokale Claude-Code-Installation den claude.ai-Connector im Druckmodus lädt, zeigt erst „Verbindung prüfen“ auf deinem PC.
* **Direktes MCP**: OAuth-Fluss nach MCP-Standard (offizielles SDK) eingebaut, gegen MarketPrint nicht getestet (Adresse/Zulassung unbekannt).
* **Druckdateien bei MarketPrint**: Große Dateien müssen in der MarketPrint-App unter „Meine Designs“ hochgeladen und im Studio verknüpft werden (die Schnittstelle akzeptiert sonst nur öffentliche URLs oder kleine Dateien).
* **Printify/Printful**: Ohne Konten nur gegen simulierte Server getestet. Abweichungen der echten API (Feldnamen, Grenzen) zeigen sich bei der ersten Verbindung; der Baustein meldet sie verständlich und schreibt bei Unklarheit nichts erneut.
* **Zielshops**: Das MarketPrint-Konto ist auch mit `xgyzvd-1m.myshopify.com` (fremder Shop) verbunden. Freigegeben ist nur `dfz1mp-1u.myshopify.com`; andere Shops sind gesperrt (Prüfung in Formular, Freigabe und unmittelbar vor dem Aufruf).
* **Nackendruck** und **Musterbestellungen**: nicht über das Studio.
* **Mockups**: echte Mockups erzeugt MarketPrint erst beim Anlegen; vorher zeigt das Studio eine gekennzeichnete schematische Vorschau und das leere MarketPrint-Produktfoto.
* **Kollektionen/Tags** nach dem Anlegen nur mit Shopify-Admin-App und eindeutiger Produktsuche.
* **Logo Nr. 29**: vom Inhaber bestätigt (= `docs/brand/`, Kreuz + Schriftzug). Eingebunden als `public/brand/logo-29.svg` (Navigation), Emblem als Programmsymbol (`icon.svg`, `icon.ico`). Eine eigene Datei unter Einstellungen → Marke hat Vorrang.

## 4. Kosten bei Nutzung
| Posten | Kosten |
|---|---|
| APOLOGEA Studio | keine |
| Claude über **Claude Code** | keine zusätzlichen Kosten über das Studio; zählt zu den Nutzungsgrenzen deines Claude-Abos |
| Claude über **Anthropic API** | nutzungsabhängig (Opus 5.5: $4 / $20 je 1 Mio. Token Ein-/Ausgabe; Sonnet 5.5: $2 / $10; Haiku 5.5: $0,10 / $0,50). Richtwerte Opus 5.5: Produkttext wenige Cent, Website-Vorschlag ca. $0,10–0,80. Vor jedem Aufruf Schätzung. |
| MarketPrint | keine Kosten beim Anlegen; bei Kundenbestellungen mindestens Katalogpreis + Aufschläge (zweite Druckfläche, DTF, Nackendruck) |
| Printify / Printful | Konten kostenlos; Kosten erst bei Kundenbestellungen (Produktions- und Versandkosten des Anbieters). Optionale Bezahlpläne der Anbieter sind nicht nötig. |
| Shopify | keine zusätzlichen; Theme Access und eigene App sind kostenlos |

## 5. Tests
* `npm test` (in `studio/`): 26 automatische Tests (davon 9 für Printify/Printful gegen simulierte HTTP-Server) – Website-Ablauf gegen **simulierten** Shopify-Server (Vorschlag → Vorschau → Freigabe → Übernahme → Sicherung → Wiederherstellung, Konflikt, ungültiges JSON), Produkt-Freigabe/Doppelschutz/Verbindungsabbruch/Ablehnung/Wiederaufnahme, Zielshop-Schutz (MarketPrint-**Simulation**), Vorlagen, Sicherung Export/Import, Druckdatei-Prüfung, Zugangsdaten, MarketPrint-Brücke mit **Ersatz-CLI**.
* `test/e2e-ui.mjs`: 48 Oberflächenprüfungen (inkl. Printify-Durchlauf in der Simulation) mit Playwright im Simulationsmodus (Start, beide Hauptbereiche, Uploads, Vorschauen, Formularprüfung, Speichern/Öffnen, Vorlagen, Freigabe, Doppelklick-Schutz, fehlende Zugänge, Sicherung, kleines Fenster).
* Es wurden **keine** echten Schreibaktionen bei Shopify oder MarketPrint ausgeführt.
