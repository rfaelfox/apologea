# Multi-POD-Datenmodell (Produkt-Metafelder)

Ziel: Produkte können von verschiedenen Print-on-Demand-Anbietern stammen (zuerst **MarketPrint**),
ohne dass das Theme anbieterspezifisch wird. Alle Felder liegen im Namespace **`apologea`**.
Das Theme liest sie in `shopify-theme/sections/main-product.liquid`.

> Stand: Entwurf. Ob und wie die MarketPrint-App Metafelder selbst befüllt, ist noch offen
> (beim Nutzer erfragt). Die Definitionen müssen im Shopify-Admin unter
> *Einstellungen → Benutzerdefinierte Daten → Produkte* angelegt werden — das ist **noch nicht passiert**.

## Sichtbare Felder (Storefront)

| Schlüssel | Typ | Anzeige | Beispielinhalt (Format) |
|---|---|---|---|
| `apologea.material` | Einzeiliger Text | Details-Akkordeon | Materialangabe laut Anbieter-Datenblatt |
| `apologea.fit` | Einzeiliger Text | Details-Akkordeon | „Oversized“, „Regular“ … |
| `apologea.print_method` | Einzeiliger Text | Details-Akkordeon | „DTG“, „Stick“ … |
| `apologea.care` | Mehrzeiliger Text | Details-Akkordeon | Pflegehinweise laut Anbieter |
| `apologea.production_time` | Einzeiliger Text | unter dem Kaufen-Button | Produktionszeit laut Anbieter |
| `apologea.motif_story` | Rich Text | Block „Motiv-Geschichte“ | Geschichte/Bedeutung des Motivs |
| `apologea.scripture_text` | Mehrzeiliger Text | Block „Motiv-Geschichte“ | Bibelvers (Wortlaut aus einer Übersetzung) |
| `apologea.scripture_reference` | Einzeiliger Text | Block „Motiv-Geschichte“ | Referenz inkl. Übersetzung |

Leere Felder werden nicht angezeigt. Das Theme erfindet keine Inhalte.

## Interne Felder (nie im Shop sichtbar)

| Schlüssel | Typ | Zweck |
|---|---|---|
| `apologea.pod_provider` | Einzeiliger Text (Auswahl: `marketprint`, später weitere) | Welcher Anbieter fertigt |
| `apologea.pod_product_id` | Einzeiliger Text | Produkt-ID beim Anbieter |
| `apologea.pod_variant_map` | JSON | Zuordnung Shopify-Varianten-ID → Anbieter-Varianten-ID |
| `apologea.print_file` | Datei | Druckdatei (PNG) |
| `apologea.mockups_source` | Einzeiliger Text | Herkunft der Mockups |

Varianten-Metafelder sind optional (`apologea.pod_sku` pro Variante), falls ein Anbieter
SKUs pro Größe/Farbe braucht.

## Import-Workflow (Entwurf)
1. Motiv + Druck-PNG + Mockups vom Nutzer.
2. Produkt über die POD-App (MarketPrint) anlegen → App erstellt Shopify-Produkt + Varianten.
3. Metafelder (sichtbar) ergänzen: Material/Passform/Pflege aus dem Anbieter-Datenblatt übernehmen,
   Motivgeschichte und ggf. Bibelstelle vom Nutzer.
4. Produkt in Kollektion(en) einordnen, Entwurf prüfen, erst dann veröffentlichen (durch den Nutzer).

Keine echten POD-Aufträge, keine kostenpflichtigen Aktionen ohne Freigabe.
