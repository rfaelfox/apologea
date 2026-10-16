# NOCTURNE — Designsystem für APOLOGEA

Luxury Christian Streetwear. Leitidee: **„Licht in der Nacht“** — tiefes Schwarz, warmes Antikgold,
Elfenbein als Lesefarbe. Ruhig, sakral, filmisch. Nichts schreit; alles leuchtet langsam auf.

Die Farbwelt übernimmt bewusst die Palette der bestehenden APOLOGEA-Handy-App (`app.css`),
damit Shop und App als eine Marke wirken.

## 1. Farben (CSS-Tokens in `shopify-theme/assets/nocturne.css`)

| Token | Wert | Verwendung |
|---|---|---|
| `--n-night` | `#0b0a09` | Seitenhintergrund |
| `--n-night-2` | `#11100e` | Abschnitts-Wechsel |
| `--n-panel` | `#171614` | Karten, Drawer |
| `--n-panel-2` | `#1e1c19` | Hover-Flächen, Eingabefelder |
| `--n-line` | `#2e2a24` | Haarlinien |
| `--n-line-2` | `#3f3930` | Rahmen, Trenner |
| `--n-gold` | `#b8955a` | Akzent, Links, Ornamente |
| `--n-gold-2` | `#d2b47e` | Hover/aktiver Akzent |
| `--n-gold-dim` | `#7d6440` | dezente Ornamente |
| `--n-ivory` | `#ede5d4` | Fließtext, Überschriften |
| `--n-ivory-2` | `#d9cfbc` | Sekundärtext |
| `--n-muted` | `#a89f8e` | Metadaten |
| `--n-danger` | `#e09481` | Fehler |
| `--n-ok` | `#a7c493` | Erfolg |

Gold, Elfenbein und Hintergrund sind im Theme-Editor unter **Theme-Einstellungen → Farben** änderbar;
alle übrigen Töne bleiben fest, damit die Balance erhalten bleibt.

Kontrast: Elfenbein auf Nacht ≈ 15,8:1, Gold auf Nacht ≈ 7,1:1, Muted auf Nacht ≈ 7,5:1 — alle ≥ WCAG AA (berechnet nach WCAG 2.x).

## 2. Typografie

| Rolle | Schrift | Stil |
|---|---|---|
| Display / Überschriften | Shopify-Font (Standard: *Cormorant*) | Versalien, Laufweite `0.18–0.32em` |
| Fließtext | Shopify-Font (Standard: *Inter*) | 16 px / 1.6 |
| Eyebrow / Labels | Fließtextschrift | 11–12 px, Versalien, Laufweite `0.24em`, Gold |

Skala (fluid, `clamp`): `--n-fs-display` 44→96 px · `--n-fs-h1` 34→60 · `--n-fs-h2` 26→40 · `--n-fs-h3` 20→26 · `--n-fs-body` 16 · `--n-fs-small` 13.

## 3. Raster & Abstände
- Container: max. 1440 px, Seitenrand `clamp(16px, 4vw, 56px)`.
- Abstandsskala: 4 · 8 · 12 · 16 · 24 · 32 · 48 · 72 · 112 px (`--n-s-1` … `--n-s-9`).
- Abschnittsabstand oben/unten: pro Abschnitt im Editor einstellbar (Standard 72 px mobil / 112 px Desktop).
- Produktraster: 2 Spalten mobil, 3–4 Desktop.

## 4. Formensprache
- Ecken: **eckig** (0 px) für Bilder und Buttons — Luxus, Strenge. Nur Badges 2 px.
- Ornament: Raute ◇ als Leitmotiv (Trennlinien, Listenpunkte, Ladeindikator) — identisch zur App.
- Linien: 1 px Haarlinien in `--n-line`; goldene Linien nur als Akzent.
- Körnung: feines Film-Grain-Overlay (SVG-Noise, 4 % Deckkraft), abschaltbar.

## 5. Bewegung — „Sacred Cinematic“

| Effekt | Beschreibung | Dauer / Kurve |
|---|---|---|
| `reveal` | Elemente gleiten 24 px nach oben und blenden ein, wenn sie ins Bild kommen | 1100 ms, `cubic-bezier(.2,.7,.2,1)` |
| `reveal--stagger` | Kinder nacheinander, 90 ms Versatz | — |
| `light-rays` | Hero: langsam atmende Lichtkegel aus warmem Gold hinter dem Motiv | 12 s Loop |
| `ken-burns` | Hero-Bild zoomt minimal (1 → 1.06) | 18 s, alternierend |
| `gold-draw` | Ornamentlinien ziehen sich von der Mitte nach außen auf | 1400 ms |
| `glow-hover` | Produktkarten: Bild hellt leicht auf, goldene Unterkante wächst | 600 ms |

Regeln:
- `prefers-reduced-motion: reduce` → alle Animationen aus, Inhalte sofort sichtbar.
- Ohne JavaScript ist jeder Inhalt sichtbar (`.js`-Klasse am `<html>` schaltet Reveal erst ein).
- Animationen global abschaltbar: **Theme-Einstellungen → Animationen**.
- Nur `transform` und `opacity` animieren (GPU, kein Layout-Shift).

## 6. Komponenten
Buttons (primär = Gold-Outline mit Füllung beim Hover, sekundär = Elfenbein-Haarlinie), Produktkarte,
Preis, Badge, Ornament-Trenner, Eyebrow, Formfelder, Drawer-Navigation, Scripture-Block (Bibelstelle
+ Referenz, vom Händler einzutragen — das Theme liefert **keine** vorgefertigten Zitate).

## 7. Logo
Original vom Inhaber geliefert (2026-10-16): Flechtkreuz-Emblem über Schriftzug „APOLOGEA“ (O mit Raute), Gold auf Schwarz.
Ablage: `docs/brand/apologea-logo-original.webp` (Rasteroriginal, maßgeblich).

**SVG-Fassungen** (Vektorisierung des Originals per Konturnachzeichnung, Flächendeckung ≈ 97,6 % mit dem Original;
das geprägte 3D-Relief des Originals ist als vertikaler Goldverlauf `#EDC889 → #CFA05C → #A06F33` je Form (Buchstabe/Kreuzteil) umgesetzt,
Form und Proportionen unverändert, Hintergrund transparent):

| Datei | Inhalt | Seitenverhältnis | Einsatz |
|---|---|---|---|
| `apologea-logo.svg` | Kreuz + Schriftzug (Original-Anordnung) | 2,06 : 1 | Footer, Passwortseite |
| `apologea-wordmark.svg` | nur Schriftzug | 7,35 : 1 | Header (Standard) |
| `apologea-emblem.svg` | nur Kreuz | 1 : 1 | Favicon, kleine Flächen |

Liegen in `shopify-theme/assets/` und `docs/brand/`. Header-Variante im Theme-Editor wählbar
(**Header → Logo-Variante**); ein hochgeladenes Logo-Bild hat Vorrang. Regeln: nicht verzerren, nicht umfärben
außer Gold/Elfenbein auf dunklem Grund, Schutzraum ≥ Höhe des O rundum, Mindestbreite Schriftzug 96 px.
