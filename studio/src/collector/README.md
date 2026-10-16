# APOLOGEA Live-View-Dienst (Cloudflare Worker)

Kleiner, eigener Dienst für die **Live View** im APOLOGEA Studio. Er nimmt die Shopify-Kundenereignisse
(Web Pixel) entgegen und liefert dem Studio, wie viele Besucher in den letzten 5 Minuten aktiv waren und
welche Produkte angesehen wurden. Ohne diesen Dienst zeigt das Studio „Live-Daten nicht verfügbar“ –
es werden **nie** erfundene Werte angezeigt.

Kosten: Der kostenlose Cloudflare-Tarif (Workers + D1) reicht für einen kleinen Shop. Es wird nichts bezahlt,
solange du kein kostenpflichtiges Paket auswählst.

## Datenschutz (DSGVO)
- Das Pixel sendet nur, wenn Besucher der **Analyse** zugestimmt haben (Shopify Customer Privacy API).
- Keine IP-Adressen, keine Namen/E-Mails, keine eigenen Cookies.
- Besucher-Kennung = Hash aus Tagessalz + Pixel-Client-ID, wechselt täglich und ist nicht rückführbar.
- Land nur grob (2 Buchstaben) aus dem Cloudflare-Netz.
- Einzelereignisse werden nach **48 Stunden** gelöscht, Tageszähler für Produktaufrufe nach 400 Tagen.
- Abfragen nur mit geheimem Lese-Schlüssel (`READ_TOKEN`), der verschlüsselt im Studio liegt und nie im Code steht.

Textbaustein für die Datenschutzerklärung (bitte rechtlich prüfen lassen):

> **Reichweitenmessung (Live-Statistik).** Wenn du der Analyse zugestimmt hast, übermitteln wir beim Besuch
> unseres Shops Seitenaufrufe, angesehene Produkte, Warenkorb- und Kassenereignisse ohne IP-Adresse an einen
> von uns betriebenen Dienst bei Cloudflare, Inc. (Auftragsverarbeitung, EU-Standardvertragsklauseln).
> Die Besucherkennung wird täglich neu pseudonymisiert. Die Daten werden nach 48 Stunden gelöscht, nur
> zusammengefasste Tageszahlen je Produkt bleiben bis zu 400 Tage erhalten. Rechtsgrundlage: Art. 6 Abs. 1 lit. a
> DSGVO (Einwilligung), jederzeit widerrufbar über die Cookie-Einstellungen.

## Einrichtung – einfacher Weg (empfohlen)
Im Studio: **Analytics → Einrichtung → Schritt 5**. Dort Cloudflare-Konto anlegen, einen API-Token erstellen
(Vorlage „Cloudflare Workers bearbeiten“ + „Konto · D1 · Bearbeiten“) und einfügen → „Live-Dienst jetzt einrichten“.
Das Studio legt Datenbank, Tabellen, Worker, stündliches Aufräumen und die workers.dev-Adresse über die
Cloudflare-Schnittstelle an und trägt Adresse und Lese-Schlüssel selbst ein. Schritt 6 liefert den fertigen Pixel-Code.

## Einrichtung – manuell mit wrangler (nur für Fortgeschrittene)
Voraussetzung: kostenloses Cloudflare-Konto und Node.js mit npm.

1. Eingabeaufforderung in diesem Ordner (`studio/src/collector`) öffnen.
2. `npm i -g wrangler`
3. `wrangler login` (Browser öffnet sich → Cloudflare bestätigen)
4. `wrangler d1 create apologea-live` → die angezeigte `database_id` in `wrangler.toml` bei
   `HIER-DIE-ID-AUS-wrangler-d1-create-EINTRAGEN` eintragen.
5. `wrangler d1 execute apologea-live --remote --file=schema.sql`
6. `wrangler secret put READ_TOKEN` → ein langes Zufallspasswort eingeben (z. B. 40 Zeichen) und notieren.
7. `wrangler deploy` → Adresse wie `https://apologea-live.<name>.workers.dev` notieren.
8. Prüfen: `https://apologea-live.<name>.workers.dev/v1/health` im Browser zeigt `unauthorized` – richtig so.

## Pixel im Shop einfügen
1. In `pixel.js` bei `ENDPOINT` deine Worker-Adresse eintragen (Ende `/v1/e` beibehalten).
2. Shopify-Admin → **Einstellungen → Kundenereignisse → Benutzerdefiniertes Pixel hinzufügen**, Name „APOLOGEA Live“.
3. Inhalt von `pixel.js` einfügen.
4. Berechtigung: **Erforderlich → Analyse**. Datenverkauf: „Erfasste Daten gelten nicht als Datenverkauf“.
5. Speichern → **Verbinden**.

## Im Studio verbinden
Einstellungen → **Analytics** → „Live-View-Dienst“: Adresse (ohne `/v1/...`) und Lese-Schlüssel eintragen →
„Verbindung testen“. Danach zeigt Analytics → Live View echte Werte (Aktualisierung alle 15 Sekunden).

## Hinweise
- Shopify lädt Pixel nur im Online-Shop (nicht in der Vorschau des Theme-Editors).
- Die Zahlen beruhen nur auf Besuchern mit Einwilligung und weichen daher von Shopifys eigener Live-Ansicht ab.
- Weitere erlaubte Herkunft (z. B. eigene Domain) in `wrangler.toml` bei `ALLOWED_ORIGINS`.
