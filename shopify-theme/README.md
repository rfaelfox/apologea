# APOLOGEA NOCTURNE — Shopify-Theme

Online-Store-2.0-Theme (JSON-Templates, Sektionen überall). Designsystem: `../docs/DESIGN_SYSTEM.md`,
Produkt-Metafelder: `../docs/POD_DATA_MODEL.md`.

## Struktur
```
layout/      theme.liquid, password.liquid
sections/    Header/Footer-Gruppen, Startseiten-Sektionen, main-* für jede Seitenart
snippets/    logo, icon, price, product-card, ornament, pagination, meta-tags, css-variables
templates/   JSON-Templates (+ customers/*, gift_card.liquid)
assets/      nocturne.css (Tokens, Komponenten, Animationen), nocturne.js (Reveal, Drawer, Varianten)
config/      settings_schema.json, settings_data.json
locales/     de.default.json, en.json
```

## Prüfen
```bash
shopify theme check --path shopify-theme
```

## Hochladen (nur unveröffentlicht!)
```bash
NODE_USE_ENV_PROXY=1 shopify theme push --path shopify-theme --unpublished \
  --theme "APOLOGEA NOCTURNE (Dev)" --password shptka_placeholder
```
Niemals `--publish` oder `--live` verwenden. Live-Theme „Horizon“ und Entwurf „Feather“ nicht anfassen.

Alternative ohne CLI: `shopify-theme/` als ZIP packen (Inhalt ohne README.md, nicht der Ordner selbst — z. B. `cd shopify-theme && zip -r ../nocturne.zip . -x README.md`) und im Admin
unter *Onlineshop → Themes → Theme hinzufügen → ZIP-Datei hochladen* einspielen. Es landet unveröffentlicht
in der Theme-Bibliothek.

## Sektionen
| Sektion | Zweck |
|---|---|
| Hero „Sacred“ | Vollbild-Hero mit Lichtstrahlen, Ken-Burns, gestaffeltem Text-Reveal |
| Ausgewählte Kollektion | Produktraster; auf Produktseiten automatisch „Weitere Stücke“ |
| Bibelstelle | Vers + Referenz, vom Händler einzutragen (keine Vorgaben im Theme) |
| Bild mit Text | Markengeschichte |
| Kollektionen | Kacheln mit Bild |
| Text / Manifest | zentrierter Text |
| Newsletter | Kundenformular mit Tag `newsletter` |
