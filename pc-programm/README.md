# APOLOGEA Kollektionsverwaltung (PC-Programm)

C#-Programm für Windows 10/11 mit .NET Framework 4.8 (vorinstalliert). Es startet einen lokalen Server (nur 127.0.0.1)
und zeigt die Oberfläche (`Quellcode/ui`) in einem Edge-App-Fenster. Arbeitet direkt im Sammlungsordner
(`Sammlung\…`, gleiches Format wie die Handy-App im Repository-Hauptordner).

- **Bauen:** `Quellcode\bauen.cmd` (legt `APOLOGEA.exe` neben den Ordner `Quellcode`).
- **Aktualisierung im Programm:** Einstellungen → „Programm-Aktualisierung“. Das Programm liest `pc-programm/update.json`
  des neuesten Commits auf dem Zweig `claude/apologea-shopify-theme-9kvfrj`, lädt alle Dateien, prüft die SHA-256-Summen,
  sichert die bisherige Fassung (`Programm-Sicherung`, letzte 5), ersetzt `Quellcode`, baut mit `bauen.cmd` und startet neu.
  Schlägt das Bauen fehl, wird alles zurückgesetzt.
- **Nach jeder Änderung:** Version in `Quellcode/src/Program.cs` erhöhen, `hinweise.txt` anpassen,
  `python3 pc-programm/tools/manifest.py` ausführen, committen und pushen.
- **Sicherheit:** Wer auf diesen Zweig schreiben kann, kann über die Aktualisierung Programmcode auf den PC bringen.
  Deshalb nur nach ausdrücklichem Klick; das GitHub-Konto sollte mit Zwei-Faktor-Anmeldung geschützt sein.
- **Gemeinsame Dateien mit der Handy-App:** `Sammlung/.apologea/kollektionen.json` (Kollektionen); Import-Regeln und
  Katalog-Gestaltung sind aus `import.js`/`catalog.js` der Handy-App übernommen.
- Schriften (SIL Open Font License): Lizenzen in `Quellcode/ui/schrift-lizenzen`.
