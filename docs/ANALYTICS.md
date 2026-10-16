# APOLOGEA Studio – Analytics & Business Intelligence (ab 2.0.0)

Erweiterung der bestehenden Kommandozentrale. Alle bisherigen Funktionen bleiben erhalten.
Sicherungspunkt vor der Erweiterung: Commit `4b4f447`, Tag `sicherung-vor-analytics-1.5.0`.

## Bereiche (Navigation „Analytics“)
| Bereich | Inhalt |
|---|---|
| Übersicht | KPI-Karten (Gesamt-/Nettoumsatz, Bestellungen, Besucher online, Sitzungen, Conversion, Ø Bestellwert, verkaufte Artikel, Erstattungen, geschätzter Gewinn, Umsatzveränderung) mit Erklärung und Vergleich zum Vorzeitraum, Umsatzverlauf, Hinweise |
| Live View | Aktivität der letzten 5 Minuten (Besucher, Produktaufrufe, Warenkörbe, Kassen), letzte Käufe, Stand-Zeit, Aktualisierung alle 15 s |
| Verkäufe & Umsatz | Aufschlüsselung brutto → Rabatte → Erstattungen → Steuern/Versand → netto, Verlauf, Kategorien, Top/Flop, Länder, Bestellhistorie mit Suche/Filter/Sortierung |
| Kunden & Besucher | Neu-/Stammkunden, Sitzungen, Traffic-Quellen, Länder (ShopifyQL) |
| Produktperformance | Rangliste je Piece mit Bild, Anbieter, Preis, Stück, Umsatz, Aufrufen, Conversion, Herstellkosten, Marge, Deckungsbeitrag; Detailseite je Produkt |
| Gewinn & POD-Kosten | Umsatz → Deckungsbeitrag → Gewinn, Kostenquellen (Printify, Printful, Gelato, Katalogschätzung, manuell), fehlende Posten |
| Berichte | PDF/CSV/Excel für Tag/Woche/Monat/eigenen Zeitraum, regelbasierte Hinweise und gekennzeichnete Prognose |

| Einrichtung | Assistent mit 7 Schritten; jeder Haken wird echt geprüft (App-Verbindung, Berechtigungen, geschützte Kundendaten, erster Abgleich, Live-Dienst, Pixel-Ereignisse, Kosten) |

Zeitfilter: heute, gestern, 7/30/90 Tage, dieses Jahr, eigener Zeitraum. Zeitzone = Shop-Zeitzone.

## Definitionen
- **Bruttoumsatz:** Artikelpreise vor Rabatten, ohne Steuer und Versand (bei Preisen inkl. MwSt. wird die Steuer herausgerechnet).
- **Nettoumsatz:** Bruttoumsatz − Rabatte − Rücksendungen (Warenwert der Erstattungen, ohne Steuer).
- **Gesamtumsatz:** Nettoumsatz + Versand + Steuern (wie „Gesamtumsatz“ in den Shopify-Berichten).
- Erstattungen zählen am Tag der Erstattung, nicht am Bestelltag.
- **Deckungsbeitrag:** Erlös ohne Steuer (Artikel nach Rabatt + vom Kunden bezahlter Versand) − Erstattungen − POD-Produktions- und Versandkosten − Zahlungs-/Shopify-Gebühren.
- **Gewinn (geschätzt):** Deckungsbeitrag − Werbung − manuelle Kosten.
- Fehlen Kosten, heißt das Ergebnis **„vorläufig“**, die Marge wird als „–“ gezeigt und die fehlenden Posten werden aufgelistet.
- Ausgeschlossen: Testbestellungen, Zahlungsstatus VOIDED/EXPIRED. Stornierte Bestellungen mindern den Umsatz über ihre Erstattung.
- Doppelte Bestellungen sind ausgeschlossen (Speicherung je Shopify-ID, Aktualisierung über `updated_at`).
- Fremdwährung: Shop-Währung aus `shopMoney`; POD-Kosten in USD werden mit dem in den Einstellungen hinterlegten Kurs umgerechnet.

## Technik
- **Shopify Admin GraphQL** (`orders`, Seitengröße 50, Pause zwischen Seiten, Wiederholung bei Drosselung),
  inkrementeller Abgleich nach `updated_at` mit 10 Minuten Überlappung. Automatisch alle *n* Minuten (Einstellung), manuell per Knopf.
- **ShopifyQL** (`shopifyqlQuery`) für Sitzungen, Traffic und Länder. Nicht verfügbare Werte werden als „nicht verfügbar“ gekennzeichnet.
- **Web Pixel + eigener Dienst** für die Live View (`studio/src/collector/`, siehe dortige README).
- **Kosten:** Printify-Bestellungen, Printful-Bestellungen, Gelato (`orders:search`), MarketPrint-Katalogpreise als Schätzung, manuelle Kosten.
- **Speicher:** lokal im Studio-Datenordner (`orders`, `costs`, `notices`); Kunden nur als gehashte Kennung, keine Namen/E-Mails/Adressen.
- **Schlüssel:** nur verschlüsselt (Windows DPAPI) auf dem PC, nie im Quellcode oder im Browser.
- **Berichte:** CSV (Excel-kompatibel, Semikolon), XLSX, PDF (über Microsoft Edge). Ablage: `Exporte/Berichte`.
- **Benachrichtigungen:** neue Verkäufe, erreichte Ziele, Erstattungen, fehlgeschlagener Abgleich (im Programm + Windows-Meldung).

## Einrichtungs-Assistent (ab 2.1.0)
- `GET /api/analytics/setup` prüft jeden Schritt live: Admin-Token holen, Bereiche lesen, Probeabfrage `orders(first: 1)`
  (erkennt fehlende Freigabe geschützter Kundendaten), Stand des Abgleichs, `/v1/health` des Live-Dienstes, Ereignisse der letzten 24 h.
- **Live-Dienst mit einem Klick** (`POST /api/analytics/live-setup`, `src/server/analytics/cloudflare.js`): über die Cloudflare-REST-API
  ohne wrangler/npm – Konto lesen → D1 `apologea-live` (vorhandene wird weiterverwendet) → `schema.sql` → Worker-Module
  `worker.js` + `core.js` mit Bindungen (D1, SHOP_DOMAIN, Geheimnis READ_TOKEN) → Cron `17 * * * *` → workers.dev-Subdomain
  (bei Bedarf angelegt) → Adresse und Lese-Schlüssel im Studio speichern → Erreichbarkeit prüfen. Wiederholbar (auch als Update).
- Cloudflare-API-Token: Zugang `cloudflare.apiToken`, verschlüsselt (DPAPI), nur an api.cloudflare.com gesendet.
- `GET /api/analytics/pixel-code` liefert `pixel.js` mit eingesetzter Adresse und Shop-Domain.
- Getestet gegen ein simuliertes Cloudflare (`test/mock-cloudflare.mjs`); gegen ein echtes Cloudflare-Konto noch nicht.

## Was du in Shopify freigeben musst
1. Shopify Dev Dashboard → deine App → **Konfiguration → Admin-API-Bereiche**: `read_orders`, `read_reports`, `read_products`
   (optional `read_all_orders`, sonst liefert Shopify nur die letzten 60 Tage).
2. App → **API-Zugriffsanfragen → Geschützte Kundendaten**: Zugriff beantragen (Begründung: „Umsatzauswertung im eigenen Shop“);
   Felder Name/E-Mail/Adresse werden **nicht** benötigt.
3. Neue Version veröffentlichen und im Shop installieren/aktualisieren.
4. Studio → Einstellungen → Shopify: Client-ID und Client-Secret eintragen → „Verbindung prüfen“.

## Grenzen (ehrlich)
- **Keine Webhooks:** Das Studio läuft auf deinem PC und ist aus dem Internet nicht erreichbar. Deshalb Abgleich per Abfrage
  (Standard alle 3 Minuten). Für Webhooks wäre ein öffentlich erreichbarer Dienst nötig (inkl. HMAC-Prüfung der Shopify-Signatur; nicht umgesetzt).
- **Gelato:** Feldnamen der Kostenabfrage sind nicht gegen ein echtes Konto geprüft; Produkterstellung über Gelato gibt es nicht.
- **MarketPrint** liefert keine Bestellkosten → nur Schätzung aus dem Katalog oder manuelle Eingabe.
- **ShopifyQL:** Spaltennamen ändern sich je nach Shopify-Version; das Studio probiert mehrere Varianten und zeigt sonst „nicht verfügbar“.
- Werte können von den Shopify-Berichten abweichen (Rundung, Zeitpunkt der Erfassung, Einwilligung bei Live-Daten).
  Das Studio behauptet keine vollständige Übereinstimmung mit Shopify.
- Prognosen sind einfache Hochrechnungen und als „Prognose“ gekennzeichnet.

## Tests
`studio/test/cloudflare.test.mjs` prüft die Ein-Klick-Einrichtung und den Assistenten. `studio/test/analytics.test.mjs` prüft mit einem simulierten Shopify (gekennzeichnete Testdaten) Umsatzberechnung inkl. Rabatten,
Steuern, Erstattungen, Stornos, Duplikaten, Zeitfenstern, Kosten, Live-Dienst (Einwilligung, Löschung) und Berichtserzeugung (PDF/CSV/XLSX).
