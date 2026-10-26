// APOLOGEA Kollektionsverwaltung – Sammlungsordner: Einlesen, Speichern, Ordnerverwaltung, Papierkorb
using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Text;

namespace Apologea
{
    /// <summary>Quelle einer Datei beim Speichern: vorhandene Datei, hochgeladene Datei oder Kopie aus einem anderen Piece.</summary>
    class Source
    {
        public string Art;       // behalten | upload | kopie
        public string FullPath;  // Quelldatei
        public string Rel;       // bei "behalten": relativer Pfad im Produktordner
        public string OrigName;  // ursprünglicher Dateiname
        public string Ext;       // Dateiendung passend zum tatsächlichen Format
        public string UploadId;
        public string TempName;  // temporärer Name während des Speicherns
    }

    /// <summary>Kleine Transaktion: jede Dateioperation hinterlegt ihre Rücknahme.</summary>
    class Tx
    {
        readonly List<KeyValuePair<string, Action>> undo = new List<KeyValuePair<string, Action>>();
        public void Add(string what, Action a) { undo.Add(new KeyValuePair<string, Action>(what, a)); }
        public void Commit() { undo.Clear(); }
        public List<string> Rollback()
        {
            var errors = new List<string>();
            for (int i = undo.Count - 1; i >= 0; i--)
            {
                try { undo[i].Value(); }
                catch (Exception ex) { errors.Add(undo[i].Key + ": " + ex.Message); }
            }
            undo.Clear();
            return errors;
        }
    }

    public class Collection
    {
        public readonly string Root;
        public readonly object Sync = new object();

        Dictionary<string, Piece> pieces = new Dictionary<string, Piece>();
        List<string> categories = new List<string>();
        List<Dictionary<string, object>> fremd = new List<Dictionary<string, object>>();
        List<string> loose = new List<string>();
        List<string> scanNotes = new List<string>();
        Dictionary<string, string> lastSignatures;
        readonly Dictionary<string, string> formatCache = new Dictionary<string, string>();
        DateTime lastScan;

        public string MetaDir { get { return Path.Combine(Root, ".apologea"); } }
        public string UploadDir { get { return Path.Combine(MetaDir, "uploads"); } }
        public string TrashDir { get { return Path.Combine(Root, "_Papierkorb"); } }
        public string TrashPiecesDir { get { return Path.Combine(TrashDir, "Pieces"); } }
        public string TrashFilesDir { get { return Path.Combine(TrashDir, "Dateien"); } }

        static readonly HashSet<string> IgnoredFiles = new HashSet<string>(StringComparer.OrdinalIgnoreCase) {
            Piece.DataFile, "_Papierkorb-Info.json", "desktop.ini", "Thumbs.db", ".DS_Store" };

        public Collection(string root)
        {
            Root = Path.GetFullPath(root).TrimEnd('\\');
            if (!Directory.Exists(Root)) throw new UserError("Der Sammlungsordner wurde nicht gefunden: " + Root);
            try
            {
                var di = Directory.CreateDirectory(MetaDir);
                di.Attributes |= FileAttributes.Hidden;
                Directory.CreateDirectory(UploadDir);
                string marker = Path.Combine(MetaDir, "sammlung.json");
                if (!File.Exists(marker))
                {
                    var m = new Dictionary<string, object>();
                    m["format"] = "APOLOGEA-Sammlung/1";
                    m["angelegt"] = Util.Iso(DateTime.Now);
                    m["hinweis"] = "Dieser Ordner ist eine APOLOGEA-Sammlung. Jeder Produktordner enthält eine Produktdaten.json. Bitte diesen versteckten Ordner nicht löschen.";
                    Util.WriteAllTextAtomic(marker, Json.Write(m, true));
                }
                CleanupTemp();
            }
            catch (UnauthorizedAccessException)
            {
                throw new UserError("In den Sammlungsordner kann nicht geschrieben werden: " + Root);
            }
        }

        void CleanupTemp()
        {
            try
            {
                foreach (var f in Directory.GetFiles(UploadDir))
                    if (File.GetLastWriteTime(f) < DateTime.Now.AddDays(-1)) try { File.Delete(f); } catch { }
                foreach (var d in Directory.GetDirectories(MetaDir, "neu_*"))
                    try { Util.DeleteDirectory(d); Util.Log("Unvollständigen Zwischenordner entfernt: " + d); } catch { }
            }
            catch { }
        }

        static string NewId() { return Guid.NewGuid().ToString("N"); }

        // ================================================================ Einlesen

        public static bool IsCategoryDirName(string name)
        {
            return !(name.StartsWith("_") || name.StartsWith("."));
        }

        /// <summary>Liest den gesamten Sammlungsordner neu ein und meldet Änderungen gegenüber dem letzten Stand.</summary>
        public Dictionary<string, object> Scan()
        {
            lock (Sync)
            {
                var notes = new List<string>();
                var newPieces = new Dictionary<string, Piece>();
                var newCats = new List<string>();
                var newFremd = new List<Dictionary<string, object>>();
                var newLoose = new List<string>();

                foreach (var catDir in Directory.GetDirectories(Root).OrderBy(x => x, StringComparer.OrdinalIgnoreCase))
                {
                    string cat = Path.GetFileName(catDir);
                    if (!IsCategoryDirName(cat)) continue;
                    try { if ((File.GetAttributes(catDir) & (FileAttributes.Hidden | FileAttributes.System)) != 0) continue; } catch { continue; }
                    newCats.Add(cat);
                    string[] subDirs;
                    try { subDirs = Directory.GetDirectories(catDir); }
                    catch (Exception ex) { notes.Add("Kategorie „" + cat + "“ konnte nicht gelesen werden: " + Util.IoMessage(ex)); continue; }
                    foreach (var pdir in subDirs.OrderBy(x => x, StringComparer.OrdinalIgnoreCase))
                    {
                        string leaf = Path.GetFileName(pdir);
                        if (leaf.StartsWith(".")) continue;
                        string json = Path.Combine(pdir, Piece.DataFile);
                        if (!File.Exists(json))
                        {
                            newFremd.Add(FremdInfo(pdir, cat, null));
                            continue;
                        }
                        try
                        {
                            var p = LoadPiece(pdir, cat, newPieces, notes);
                            newPieces[p.Id] = p;
                        }
                        catch (Exception ex)
                        {
                            newFremd.Add(FremdInfo(pdir, cat, "Produktdaten.json ist nicht lesbar: " + ex.Message));
                        }
                    }
                    try
                    {
                        foreach (var f in Directory.GetFiles(catDir))
                            if (!IgnoredFiles.Contains(Path.GetFileName(f))) newLoose.Add(Util.RelPath(Root, f));
                    }
                    catch { }
                }

                // doppelte Nummern
                foreach (var g in newPieces.Values.GroupBy(p => p.Nummer).Where(g => g.Count() > 1))
                {
                    foreach (var p in g)
                    {
                        var others = g.Where(o => o != p).Select(o => o.Kategorie + "\\" + Path.GetFileName(o.Dir));
                        p.Probleme.Add("Doppelte Nummer " + p.NummerText + " – ebenfalls vergeben an: " + string.Join(", ", others) + ". Bitte eine der Nummern ändern.");
                    }
                }

                // Änderungen gegenüber dem letzten Einlesen
                var changes = new Dictionary<string, object>();
                int changed = 0, added = 0, removed = 0;
                var newSigs = newPieces.ToDictionary(kv => kv.Key, kv => kv.Value.Signatur);
                if (lastSignatures != null)
                {
                    foreach (var kv in newSigs)
                    {
                        string old;
                        if (!lastSignatures.TryGetValue(kv.Key, out old)) added++;
                        else if (old != kv.Value) changed++;
                    }
                    foreach (var k in lastSignatures.Keys) if (!newSigs.ContainsKey(k)) removed++;
                }
                changes["geaendert"] = changed;
                changes["neu"] = added;
                changes["entfernt"] = removed;
                changes["hinweise"] = notes;

                pieces = newPieces;
                categories = newCats;
                fremd = newFremd;
                loose = newLoose;
                scanNotes = notes;
                lastSignatures = newSigs;
                lastScan = DateTime.Now;
                return changes;
            }
        }

        Dictionary<string, object> FremdInfo(string dir, string cat, string fehler)
        {
            var d = new Dictionary<string, object>();
            d["ordner"] = Util.RelPath(Root, dir);
            d["ordnerName"] = Path.GetFileName(dir);
            d["kategorie"] = cat;
            int n = 0, imgs = 0;
            try
            {
                foreach (var f in Directory.GetFiles(dir, "*", SearchOption.AllDirectories))
                {
                    n++;
                    if (Util.IsImageExt(Path.GetExtension(f))) imgs++;
                }
            }
            catch { }
            d["dateien"] = n;
            d["bilder"] = imgs;
            d["fehler"] = fehler;
            return d;
        }

        Piece LoadPiece(string pdir, string cat, Dictionary<string, Piece> already, List<string> notes)
        {
            string json = Path.Combine(pdir, Piece.DataFile);
            var p = Piece.FromDict(Json.ParseObject(Util.ReadAllTextShared(json)));
            p.Dir = pdir;
            string leaf = Path.GetFileName(pdir);
            bool dirty = false;
            if (string.IsNullOrEmpty(p.Id) || already.ContainsKey(p.Id))
            {
                if (!string.IsNullOrEmpty(p.Id)) notes.Add("Der Ordner „" + cat + "\\" + leaf + "“ war eine Kopie eines anderen Piece-Ordners und hat eine eigene Kennung erhalten.");
                p.Id = NewId();
                dirty = true;
            }
            if (!string.Equals(p.Kategorie, cat, StringComparison.Ordinal))
            {
                if (!string.IsNullOrEmpty(p.Kategorie))
                    notes.Add("„" + leaf + "“ liegt jetzt in „" + cat + "“ (vorher „" + p.Kategorie + "“) – Kleidungstyp wurde angepasst.");
                p.Kategorie = cat;
                dirty = true;
            }
            if (p.Nummer <= 0)
            {
                int n;
                int us = leaf.IndexOf('_');
                if (us > 0 && int.TryParse(leaf.Substring(0, us), out n) && n > 0) { p.Nummer = n; dirty = true; }
                else p.Probleme.Add("Keine gültige Piece-Nummer hinterlegt.");
            }
            if (dirty)
            {
                try { Util.WriteAllTextAtomic(json, p.ToJson()); }
                catch (Exception ex) { p.Probleme.Add("Produktdaten konnten nicht aktualisiert werden: " + Util.IoMessage(ex)); }
            }

            // Dateien erfassen
            var sig = new StringBuilder();
            foreach (var f in Directory.GetFiles(pdir, "*", SearchOption.AllDirectories).OrderBy(x => x, StringComparer.OrdinalIgnoreCase))
            {
                string name = Path.GetFileName(f);
                if (name.StartsWith(".neu_") || name.Contains(".schreiben-"))
                {
                    try { if (File.GetLastWriteTime(f) < DateTime.Now.AddDays(-1)) File.Delete(f); } catch { }
                    continue;
                }
                var fi = new FileInfo(f);
                string rel = Util.RelPath(pdir, f);
                p.Dateien[rel] = fi;
                sig.Append(rel).Append('|').Append(fi.Length).Append('|').Append(fi.LastWriteTimeUtc.Ticks).Append(';');
            }
            p.Signatur = Util.Sha1(sig.ToString());

            var referenced = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            for (int i = 0; i < Piece.Roles.Length; i++)
            {
                string rel;
                p.Bilder.TryGetValue(Piece.Roles[i], out rel);
                if (rel == null) { p.Probleme.Add("Kein Bild für „" + Piece.RoleLabel[i] + "“ hinterlegt."); continue; }
                referenced.Add(rel);
                FileInfo fi;
                if (!p.Dateien.TryGetValue(rel, out fi))
                {
                    p.Probleme.Add(Piece.RoleLabel[i] + " fehlt: Die Datei „" + rel + "“ wurde im Produktordner nicht gefunden (verschoben, umbenannt oder gelöscht?).");
                    continue;
                }
                string fmt = FormatOf(fi);
                string ext = Path.GetExtension(rel).TrimStart('.').ToLowerInvariant();
                if (ext == "jpeg") ext = "jpg";
                if (ext == "tiff") ext = "tif";
                if (fmt != null && fmt != ext)
                    p.Probleme.Add(Piece.RoleLabel[i] + ": Die Datei „" + rel + "“ ist tatsächlich im Format " + fmt.ToUpperInvariant() + " gespeichert, trägt aber die Endung ." + ext + ".");
                if (fi.Length == 0) p.Probleme.Add(Piece.RoleLabel[i] + ": Die Datei „" + rel + "“ ist leer (0 Byte).");
            }
            foreach (var a in p.Arbeitsdateien)
            {
                referenced.Add(a);
                if (!p.Dateien.ContainsKey(a)) p.Probleme.Add("Arbeitsdatei fehlt: „" + a + "“ wurde im Produktordner nicht gefunden.");
            }
            foreach (var rel in p.Dateien.Keys)
            {
                if (IgnoredFiles.Contains(Path.GetFileName(rel)) && !rel.Contains("\\")) continue;
                if (!referenced.Contains(rel)) p.Unzugeordnet.Add(rel);
            }
            return p;
        }

        string FormatOf(FileInfo fi)
        {
            string key = fi.FullName + "|" + fi.Length + "|" + fi.LastWriteTimeUtc.Ticks;
            string fmt;
            if (formatCache.TryGetValue(key, out fmt)) return fmt;
            fmt = Util.DetectFormat(fi.FullName);
            formatCache[key] = fmt;
            return fmt;
        }

        // ================================================================ Abfragen

        public Piece Get(string id)
        {
            lock (Sync)
            {
                Piece p;
                if (id == null || !pieces.TryGetValue(id, out p))
                    throw new UserError("Dieses Piece wurde nicht gefunden. Möglicherweise wurde es außerhalb des Programms verschoben. Bitte „Aktualisieren“ wählen.", 404);
                return p;
            }
        }

        public List<Piece> All()
        {
            lock (Sync) return pieces.Values.ToList();
        }

        public List<string> Categories()
        {
            lock (Sync) return categories.ToList();
        }

        HashSet<int> TrashNumbers()
        {
            var res = new HashSet<int>();
            if (!Directory.Exists(TrashPiecesDir)) return res;
            foreach (var d in Directory.GetDirectories(TrashPiecesDir))
            {
                try
                {
                    var o = Json.ParseObject(Util.ReadAllTextShared(Path.Combine(d, Piece.DataFile)));
                    int? n = Json.Int(o, "nummer");
                    if (n.HasValue) res.Add(n.Value);
                }
                catch { }
            }
            return res;
        }

        public int NextNumber()
        {
            lock (Sync)
            {
                int max = 0;
                foreach (var p in pieces.Values) max = Math.Max(max, p.Nummer);
                foreach (var n in TrashNumbers()) max = Math.Max(max, n);
                foreach (var f in fremd)
                {
                    string leaf = (string)f["ordnerName"];
                    int us = leaf.IndexOf('_');
                    int n;
                    if (us > 0 && int.TryParse(leaf.Substring(0, us), out n) && n < 100000) max = Math.Max(max, n);
                }
                return max + 1;
            }
        }

        /// <summary>Liefert eine Beschreibung des Pieces, das die Nummer bereits verwendet, sonst null.</summary>
        string NumberOwner(int nummer, string exceptId)
        {
            foreach (var p in pieces.Values)
                if (p.Nummer == nummer && p.Id != exceptId) return p.Titel + " in " + p.Kategorie;
            if (TrashNumbers().Contains(nummer)) return "ein Piece im Papierkorb";
            return null;
        }

        public Dictionary<string, object> FileApi(Piece p, string rel)
        {
            var d = new Dictionary<string, object>();
            d["datei"] = rel.Replace('\\', '/');
            d["name"] = Path.GetFileName(rel);
            string ext = Path.GetExtension(rel).TrimStart('.').ToLowerInvariant();
            d["ext"] = ext;
            FileInfo fi;
            bool exists = p.Dateien.TryGetValue(rel, out fi);
            d["vorhanden"] = exists;
            d["pfad"] = Util.RelPath(Root, Path.Combine(p.Dir, rel)).Replace('\\', '/');
            if (exists)
            {
                d["groesse"] = fi.Length;
                d["geaendert"] = Util.Iso(fi.LastWriteTime);
                d["v"] = fi.LastWriteTimeUtc.Ticks.ToString("x") + "-" + fi.Length.ToString("x");
            }
            d["bild"] = Util.IsImageExt(ext);
            d["vorschau"] = Util.CanThumb(ext) || Util.BrowserCanShow(ext);
            return d;
        }

        public string Status(Piece p)
        {
            if (p.Entwurf) return "Entwurf";
            foreach (var r in Piece.Roles)
            {
                string rel;
                p.Bilder.TryGetValue(r, out rel);
                if (rel == null || !p.Dateien.ContainsKey(rel)) return "Unvollständig";
            }
            return "Vollständig";
        }

        public Dictionary<string, object> PieceApi(Piece p)
        {
            var d = new Dictionary<string, object>();
            d["id"] = p.Id;
            d["nummer"] = p.Nummer;
            d["nummerText"] = p.NummerText;
            d["name"] = p.Name;
            d["motivtitel"] = p.Motivtitel;
            d["kategorie"] = p.Kategorie;
            d["serie"] = p.Serie;
            d["beschreibung"] = p.Beschreibung;
            d["schlagwoerter"] = p.Schlagwoerter;
            d["entwurf"] = p.Entwurf;
            d["status"] = Status(p);
            d["erstellt"] = Util.Iso(p.Erstellt);
            d["geaendert"] = Util.Iso(p.Geaendert);
            d["herkunft"] = p.Herkunft;
            d["vorlage_von"] = p.VorlageVon;
            d["ordner"] = Util.RelPath(Root, p.Dir);
            d["ordnerName"] = Path.GetFileName(p.Dir);
            d["ordnerVoll"] = p.Dir;
            var b = new Dictionary<string, object>();
            foreach (var r in Piece.Roles)
            {
                string rel;
                p.Bilder.TryGetValue(r, out rel);
                b[r] = rel == null ? null : FileApi(p, rel);
            }
            d["bilder"] = b;
            d["arbeitsdateien"] = p.Arbeitsdateien.Select(a => (object)FileApi(p, a)).ToList();
            d["unzugeordnet"] = p.Unzugeordnet.Select(a => (object)FileApi(p, a)).ToList();
            d["probleme"] = p.Probleme;
            return d;
        }

        public Dictionary<string, object> OverviewApi()
        {
            lock (Sync)
            {
                var d = new Dictionary<string, object>();
                d["pfad"] = Root;
                var cats = new List<object>();
                foreach (var c in categories)
                {
                    var cd = new Dictionary<string, object>();
                    cd["name"] = c;
                    cd["anzahl"] = pieces.Values.Count(p => p.Kategorie == c);
                    cats.Add(cd);
                }
                d["kategorien"] = cats;
                d["pieces"] = pieces.Values.OrderBy(p => p.Nummer).Select(p => (object)PieceApi(p)).ToList();
                d["fremdordner"] = fremd;
                d["loseDateien"] = loose;
                d["hinweise"] = scanNotes;
                var trashNums = TrashNumbers();
                d["papierkorbNummern"] = trashNums.OrderBy(x => x).ToList();
                d["naechsteNummer"] = NextNumber();
                d["gescannt"] = Util.Iso(lastScan);
                return d;
            }
        }

        // ================================================================ Kategorien

        public static string SafeCategoryName(string name)
        {
            string s = Util.Transliterate((name ?? "").Trim());
            var sb = new StringBuilder();
            foreach (char c in s)
            {
                if (c < 32 || "<>:\"/\\|?*".IndexOf(c) >= 0) continue;
                sb.Append(c);
            }
            s = sb.ToString();
            while (s.Contains("  ")) s = s.Replace("  ", " ");
            s = s.Trim().Trim('.', '_').Trim();
            if (s.Length > 40) s = s.Substring(0, 40).Trim();
            return s;
        }

        public string CreateCategory(string name)
        {
            lock (Sync)
            {
                string safe = SafeCategoryName(name);
                if (safe.Length == 0) throw new UserError("Bitte einen gültigen Namen für den Kleidungstyp eingeben.");
                if (Util.SafeSegment(safe, 40).Length == 0) throw new UserError("Dieser Name ist unter Windows nicht als Ordnername erlaubt.");
                foreach (var c in categories)
                    if (string.Equals(c, safe, StringComparison.OrdinalIgnoreCase))
                        throw new UserError("Den Kleidungstyp „" + c + "“ gibt es bereits.");
                string dir = Path.Combine(Root, safe);
                if (Directory.Exists(dir) || File.Exists(dir)) throw new UserError("Ein Ordner „" + safe + "“ existiert bereits im Sammlungsordner.");
                Directory.CreateDirectory(dir);
                Util.Log("Kategorie angelegt: " + safe);
                Scan();
                return safe;
            }
        }

        public void DeleteCategory(string name)
        {
            lock (Sync)
            {
                if (!categories.Contains(name)) throw new UserError("Diesen Kleidungstyp gibt es nicht.");
                string dir = Path.Combine(Root, name);
                var entries = Directory.GetFileSystemEntries(dir).Where(e => !IgnoredFiles.Contains(Path.GetFileName(e))).ToList();
                if (entries.Count > 0) throw new UserError("Der Kleidungstyp „" + name + "“ ist nicht leer und kann daher nicht entfernt werden.");
                Util.DeleteDirectory(dir);
                Util.Log("Leere Kategorie entfernt: " + name);
                Scan();
            }
        }

        // ================================================================ Hochladen (Zwischenablage für das Formular)

        public Dictionary<string, object> SaveUpload(Stream input, long length, string origName)
        {
            string id = NewId();
            string part = Path.Combine(UploadDir, id + ".teil");
            string dat = Path.Combine(UploadDir, id + ".dat");
            long total = 0;
            try
            {
                using (var fs = new FileStream(part, FileMode.CreateNew, FileAccess.Write, FileShare.None, 1 << 16))
                {
                    var buf = new byte[1 << 16];
                    while (total < length)
                    {
                        int n = input.Read(buf, 0, (int)Math.Min(buf.Length, length - total));
                        if (n <= 0) break;
                        fs.Write(buf, 0, n);
                        total += n;
                    }
                }
                if (total != length) throw new UserError("Die Datei wurde nicht vollständig übertragen. Bitte erneut versuchen.");
                File.Move(part, dat);
            }
            catch
            {
                try { if (File.Exists(part)) File.Delete(part); } catch { }
                throw;
            }
            string fmt = Util.DetectFormat(dat);
            string origExt = Path.GetExtension(origName ?? "").TrimStart('.').ToLowerInvariant();
            if (origExt == "jpeg") origExt = "jpg";
            if (origExt == "tiff") origExt = "tif";
            // Endung nach tatsächlichem Format wählen – keine Umwandlung durch bloßes Umbenennen
            string ext = fmt ?? origExt;
            if (origExt == "svg" && fmt == null) ext = "svg";
            var meta = new Dictionary<string, object>();
            meta["name"] = origName;
            meta["groesse"] = total;
            meta["format"] = fmt;
            meta["ext"] = ext;
            Util.WriteAllTextAtomic(Path.Combine(UploadDir, id + ".json"), Json.Write(meta, false));
            var res = new Dictionary<string, object>(meta);
            res["upload"] = id;
            res["bild"] = Util.IsImageExt(ext);
            res["endungKorrigiert"] = fmt != null && origExt != "" && fmt != origExt;
            return res;
        }

        Source UploadSource(string id)
        {
            if (string.IsNullOrEmpty(id) || id.Any(c => !Uri.IsHexDigit(c)))
                throw new UserError("Ungültige Upload-Kennung.");
            string dat = Path.Combine(UploadDir, id + ".dat");
            string meta = Path.Combine(UploadDir, id + ".json");
            if (!File.Exists(dat) || !File.Exists(meta))
                throw new UserError("Eine hinzugefügte Datei ist nicht mehr verfügbar (Zwischenspeicher abgelaufen). Bitte die Datei erneut auswählen.");
            var m = Json.ParseObject(File.ReadAllText(meta, Util.Utf8));
            var s = new Source();
            s.Art = "upload";
            s.UploadId = id;
            s.FullPath = dat;
            s.OrigName = Json.StrOr(m, "name", "Datei");
            s.Ext = Json.StrOr(m, "ext", "");
            return s;
        }

        void DeleteUpload(string id)
        {
            try
            {
                File.Delete(Path.Combine(UploadDir, id + ".dat"));
                File.Delete(Path.Combine(UploadDir, id + ".json"));
            }
            catch { }
        }

        // ================================================================ Speichern

        Source ResolveSource(Dictionary<string, object> s, Piece current)
        {
            if (s == null) return null;
            string art = Json.Str(s, "art");
            if (art == "upload") return UploadSource(Json.Str(s, "upload"));
            if (art == "behalten")
            {
                if (current == null) throw new UserError("Ungültige Dateiangabe für ein neues Piece.");
                string rel = (Json.Str(s, "datei") ?? "").Replace('/', '\\');
                string full = Util.SafeCombine(current.Dir, rel);
                if (!File.Exists(full)) throw new UserError("Die Datei „" + rel + "“ ist nicht mehr im Produktordner vorhanden. Bitte „Aktualisieren“ wählen.");
                var src = new Source();
                src.Art = "behalten";
                src.Rel = Util.RelPath(current.Dir, full);
                src.FullPath = full;
                src.OrigName = Path.GetFileName(full);
                src.Ext = Path.GetExtension(full).TrimStart('.').ToLowerInvariant();
                return src;
            }
            if (art == "kopie")
            {
                Piece other;
                if (!pieces.TryGetValue(Json.Str(s, "piece") ?? "", out other))
                    throw new UserError("Das Vorlage-Piece wurde nicht gefunden.");
                string rel = (Json.Str(s, "datei") ?? "").Replace('/', '\\');
                string full = Util.SafeCombine(other.Dir, rel);
                if (!File.Exists(full)) throw new UserError("Die Vorlagedatei „" + rel + "“ wurde nicht gefunden.");
                var src = new Source();
                src.Art = "kopie";
                src.FullPath = full;
                src.OrigName = Path.GetFileName(full);
                string fmt = Util.DetectFormat(full);
                src.Ext = fmt ?? Path.GetExtension(full).TrimStart('.').ToLowerInvariant();
                return src;
            }
            throw new UserError("Unbekannte Dateiangabe.");
        }

        public Dictionary<string, object> PreviewFolder(Dictionary<string, object> req)
        {
            lock (Sync)
            {
                var res = new Dictionary<string, object>();
                string id = Json.Str(req, "id");
                Piece old = null;
                if (!string.IsNullOrEmpty(id)) pieces.TryGetValue(id, out old);
                string kategorie = Json.StrOr(req, "kategorie", "");
                int nummer = Json.Int(req, "nummer") ?? 0;
                string name = Json.StrOr(req, "name", "").Trim();
                string motiv = Json.StrOr(req, "motivtitel", "").Trim();
                string leaf;
                if (old != null && old.Name == name && old.Motivtitel == motiv && old.Nummer == nummer) leaf = Path.GetFileName(old.Dir);
                else leaf = Piece.FolderNameFor(nummer, name, motiv);
                string target = Path.Combine(Root, kategorie, leaf);
                bool exists = Directory.Exists(target) && (old == null || !string.Equals(Path.GetFullPath(target), Path.GetFullPath(old.Dir), StringComparison.OrdinalIgnoreCase));
                if (exists) target = Util.UniqueDirPath(Path.Combine(Root, kategorie), leaf);
                res["ordner"] = Util.RelPath(Root, target);
                res["ordnerVorhanden"] = exists;
                res["wirdVerschoben"] = old != null && !string.Equals(Path.GetFullPath(target), Path.GetFullPath(old.Dir), StringComparison.OrdinalIgnoreCase);
                string owner = nummer > 0 ? NumberOwner(nummer, old == null ? null : old.Id) : null;
                res["nummerVergeben"] = owner;
                res["naechsteNummer"] = NextNumber();
                return res;
            }
        }

        public Piece Save(Dictionary<string, object> req)
        {
            lock (Sync)
            {
                string id = Json.Str(req, "id");
                Piece old = null;
                if (!string.IsNullOrEmpty(id) && !pieces.TryGetValue(id, out old))
                    throw new UserError("Das Piece wurde nicht gefunden. Möglicherweise wurde es außerhalb des Programms verändert. Bitte „Aktualisieren“ wählen.", 404);
                if (old != null && !Directory.Exists(old.Dir))
                    throw new UserError("Der Produktordner „" + Util.RelPath(Root, old.Dir) + "“ ist nicht mehr vorhanden. Bitte „Aktualisieren“ wählen.");

                string name = (Json.Str(req, "name") ?? "").Trim();
                if (name.Length == 0) throw new UserError("Bitte einen Produktnamen eingeben.");
                if (name.Length > 60) throw new UserError("Der Produktname ist zu lang (höchstens 60 Zeichen).");
                if (Util.SafeSegment(name, 40).Length == 0) throw new UserError("Der Produktname muss mindestens einen Buchstaben oder eine Ziffer enthalten.");
                string kategorie = Json.Str(req, "kategorie") ?? "";
                if (!categories.Contains(kategorie) || !Directory.Exists(Path.Combine(Root, kategorie)))
                    throw new UserError("Bitte einen vorhandenen Kleidungstyp auswählen.");
                int? nr = Json.Int(req, "nummer");
                if (!nr.HasValue || nr.Value <= 0 || nr.Value > 99999)
                    throw new UserError("Bitte eine gültige Piece-Nummer eingeben (ganze Zahl von 1 bis 99999).");
                string owner = NumberOwner(nr.Value, old == null ? null : old.Id);
                if (owner != null)
                    throw new UserError("Die Nummer " + nr.Value.ToString("000") + " ist bereits vergeben (" + owner + "). Frei wäre z. B. " + NextNumber().ToString("000") + ".", 409);
                string motiv = (Json.Str(req, "motivtitel") ?? "").Trim();
                if (motiv.Length > 80) throw new UserError("Der Motivtitel ist zu lang (höchstens 80 Zeichen).");
                bool entwurf = Json.Bool(req, "entwurf");

                var bilderReq = Json.Obj(req, "bilder");
                var sources = new Dictionary<string, Source>();
                var missing = new List<string>();
                for (int i = 0; i < Piece.Roles.Length; i++)
                {
                    var s = ResolveSource(Json.Obj(bilderReq, Piece.Roles[i]), old);
                    if (s != null && s.Art != "behalten" && !Util.IsImageExt(s.Ext))
                        throw new UserError("„" + s.OrigName + "“ ist keine unterstützte Bilddatei für „" + Piece.RoleLabel[i] + "“. Andere Dateien bitte als Arbeitsdatei hinzufügen.");
                    sources[Piece.Roles[i]] = s;
                    if (s == null) missing.Add(Piece.RoleLabel[i]);
                }
                if (!entwurf && missing.Count > 0)
                    throw new UserError("Für ein vollständiges Piece fehlen noch: " + string.Join(", ", missing) + ". Bitte ergänzen oder „Als Entwurf speichern“ wählen.", 422);
                var work = new List<Source>();
                foreach (var w in Json.Arr(req, "arbeitsdateien"))
                {
                    var s = ResolveSource(w as Dictionary<string, object>, old);
                    if (s != null) work.Add(s);
                }

                var p = old == null ? new Piece() : old.Clone();
                p.Nummer = nr.Value;
                p.Name = name;
                p.Motivtitel = motiv;
                p.Kategorie = kategorie;
                p.Serie = (Json.Str(req, "serie") ?? "").Trim();
                p.Beschreibung = (Json.Str(req, "beschreibung") ?? "").Replace("\r\n", "\n").Trim();
                p.Schlagwoerter = Json.StrList(req, "schlagwoerter").Distinct(StringComparer.OrdinalIgnoreCase).ToList();
                p.Entwurf = entwurf;
                p.Geaendert = DateTime.Now;

                Piece saved;
                if (old == null)
                {
                    p.Id = NewId();
                    p.Erstellt = DateTime.Now;
                    string vorlage = Json.Str(req, "vorlage_von");
                    Piece tpl = null;
                    if (!string.IsNullOrEmpty(vorlage) && pieces.TryGetValue(vorlage, out tpl))
                    {
                        p.VorlageVon = tpl.Id;
                        p.Herkunft = "Im Programm erstellt am " + DateTime.Now.ToString("dd.MM.yyyy") + " nach Vorlage " + tpl.Titel + ".";
                    }
                    else p.Herkunft = "Im Programm erstellt am " + DateTime.Now.ToString("dd.MM.yyyy") + ".";
                    // Import: eigener Herkunftsvermerk und zusätzliche Felder aus einer mitgelieferten Produktdaten.json
                    string herkunft = (Json.Str(req, "herkunft") ?? "").Trim();
                    if (herkunft.Length > 0) p.Herkunft = herkunft.Length > 400 ? herkunft.Substring(0, 400) : herkunft;
                    var extra = Json.Obj(req, "extra");
                    if (extra != null) foreach (var kv in extra) if (!Piece.IsKnownKey(kv.Key)) p.Extra[kv.Key] = kv.Value;
                    saved = CreateNew(p, sources, work);
                }
                else
                {
                    saved = UpdateExisting(old, p, sources, work);
                }
                foreach (var s in sources.Values) if (s != null && s.Art == "upload") DeleteUpload(s.UploadId);
                foreach (var s in work) if (s.Art == "upload") DeleteUpload(s.UploadId);
                Util.Log((old == null ? "Neu angelegt: " : "Gespeichert: ") + saved.Titel + " -> " + Util.RelPath(Root, saved.Dir));
                Scan();
                return pieces[saved.Id];
            }
        }

        Piece CreateNew(Piece p, Dictionary<string, Source> sources, List<Source> work)
        {
            string staging = Path.Combine(MetaDir, "neu_" + Guid.NewGuid().ToString("N").Substring(0, 12));
            Directory.CreateDirectory(staging);
            try
            {
                for (int i = 0; i < Piece.Roles.Length; i++)
                {
                    var s = sources[Piece.Roles[i]];
                    if (s == null) { p.Bilder[Piece.Roles[i]] = null; continue; }
                    string target = Util.UniqueFilePath(staging, Piece.RoleBase[i] + (s.Ext.Length > 0 ? "." + s.Ext : ""), null);
                    CopyVerified(s.FullPath, target);
                    p.Bilder[Piece.Roles[i]] = Path.GetFileName(target);
                }
                p.Arbeitsdateien = new List<string>();
                if (work.Count > 0)
                {
                    string wdir = Path.Combine(staging, "Arbeitsdateien");
                    Directory.CreateDirectory(wdir);
                    foreach (var s in work)
                    {
                        string target = Util.UniqueFilePath(wdir, Util.SafeFileName(s.OrigName), null);
                        CopyVerified(s.FullPath, target);
                        p.Arbeitsdateien.Add("Arbeitsdateien\\" + Path.GetFileName(target));
                    }
                }
                File.WriteAllText(Path.Combine(staging, Piece.DataFile), p.ToJson(), Util.Utf8);
                string catDir = Path.Combine(Root, p.Kategorie);
                string target2 = Util.UniqueDirPath(catDir, Piece.FolderNameFor(p.Nummer, p.Name, p.Motivtitel));
                Util.RetryIo(delegate { Directory.Move(staging, target2); });
                p.Dir = target2;
                return p;
            }
            catch
            {
                try { if (Directory.Exists(staging)) Util.DeleteDirectory(staging); } catch { }
                throw;
            }
        }

        static void CopyVerified(string src, string dst)
        {
            File.Copy(src, dst, false);
            if (new FileInfo(src).Length != new FileInfo(dst).Length)
                throw new IOException("Die Kopie von „" + Path.GetFileName(src) + "“ ist unvollständig.");
        }

        static void MoveDir(string from, string to)
        {
            if (string.Equals(from, to, StringComparison.OrdinalIgnoreCase))
            {
                // nur Groß-/Kleinschreibung ändert sich: über einen Zwischennamen umbenennen
                string tmp = from + ".umbenennen-" + Guid.NewGuid().ToString("N").Substring(0, 6);
                Util.RetryIo(delegate { Directory.Move(from, tmp); });
                Util.RetryIo(delegate { Directory.Move(tmp, to); });
            }
            else Util.RetryIo(delegate { Directory.Move(from, to); });
        }

        static void MoveFile(string from, string to)
        {
            string dir = Path.GetDirectoryName(to);
            if (!Directory.Exists(dir)) Directory.CreateDirectory(dir);
            Util.RetryIo(delegate { File.Move(from, to); });
        }

        Piece UpdateExisting(Piece old, Piece p, Dictionary<string, Source> sources, List<Source> work)
        {
            var tx = new Tx();
            string dir = old.Dir;
            string trashBatch = null;
            try
            {
                // 1. Neue Dateien zunächst unter temporärem Namen in den Produktordner kopieren
                var incoming = sources.Values.Where(s => s != null && s.Art != "behalten").Concat(work.Where(s => s.Art != "behalten")).ToList();
                foreach (var s in incoming)
                {
                    s.TempName = ".neu_" + Guid.NewGuid().ToString("N").Substring(0, 10) + (s.Ext.Length > 0 ? "." + s.Ext : "");
                    string tmpPath = Path.Combine(dir, s.TempName);
                    CopyVerified(s.FullPath, tmpPath);
                    string capturedName = s.TempName;
                    string origDir = old.Dir; // Rücknahme läuft nach dem Zurückbenennen des Ordners
                    tx.Add("Temporäre Datei entfernen", delegate { string f = Path.Combine(origDir, capturedName); if (File.Exists(f)) File.Delete(f); });
                }

                // 2. Ordner umbenennen bzw. in andere Kategorie verschieben
                bool renameNeeded = old.Name != p.Name || old.Motivtitel != p.Motivtitel || old.Nummer != p.Nummer;
                string newLeaf = renameNeeded ? Piece.FolderNameFor(p.Nummer, p.Name, p.Motivtitel) : Path.GetFileName(old.Dir);
                string newParent = Path.Combine(Root, p.Kategorie);
                string target = Path.Combine(newParent, newLeaf);
                if (!string.Equals(target, old.Dir, StringComparison.Ordinal))
                {
                    if (!string.Equals(target, old.Dir, StringComparison.OrdinalIgnoreCase) && (Directory.Exists(target) || File.Exists(target)))
                        target = Util.UniqueDirPath(newParent, newLeaf);
                    string from = old.Dir, to = target;
                    MoveDir(from, to);
                    tx.Add("Ordner zurückbenennen", delegate { MoveDir(to, from); });
                    dir = target;
                }

                // 3. Nicht mehr verwendete Dateien in den Papierkorb (Dateien) verschieben
                var kept = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
                foreach (var s in sources.Values) if (s != null && s.Art == "behalten") kept.Add(s.Rel);
                foreach (var s in work) if (s.Art == "behalten") kept.Add(s.Rel);
                var oldRefs = old.Bilder.Values.Where(v => v != null).Concat(old.Arbeitsdateien).Distinct(StringComparer.OrdinalIgnoreCase).ToList();
                foreach (var rel in oldRefs)
                {
                    if (kept.Contains(rel)) continue;
                    string full = Path.Combine(dir, rel);
                    if (!File.Exists(full)) continue;
                    if (trashBatch == null)
                        trashBatch = Util.UniqueDirPath(TrashFilesDir, DateTime.Now.ToString("yyyy-MM-dd_HHmmss") + "_" + Piece.FolderNameFor(old.Nummer, old.Name, ""));
                    string dest = Path.Combine(trashBatch, rel);
                    MoveFile(full, dest);
                    string a = full, b = dest;
                    tx.Add("Datei zurückholen", delegate { MoveFile(b, a); });
                }

                // 4. Temporäre Dateien auf ihre endgültigen Namen bringen
                var taken = new List<string>();
                for (int i = 0; i < Piece.Roles.Length; i++)
                {
                    var s = sources[Piece.Roles[i]];
                    if (s == null) { p.Bilder[Piece.Roles[i]] = null; continue; }
                    if (s.Art == "behalten") { p.Bilder[Piece.Roles[i]] = s.Rel; continue; }
                    string final = Util.UniqueFilePath(dir, Piece.RoleBase[i] + (s.Ext.Length > 0 ? "." + s.Ext : ""), taken);
                    string tmp = Path.Combine(dir, s.TempName);
                    MoveFile(tmp, final);
                    taken.Add(final);
                    string a = tmp, b = final;
                    tx.Add("Datei zurückbenennen", delegate { MoveFile(b, a); });
                    p.Bilder[Piece.Roles[i]] = Path.GetFileName(final);
                }
                p.Arbeitsdateien = new List<string>();
                foreach (var s in work)
                {
                    if (s.Art == "behalten") { p.Arbeitsdateien.Add(s.Rel); continue; }
                    string wdir = Path.Combine(dir, "Arbeitsdateien");
                    if (!Directory.Exists(wdir))
                    {
                        Directory.CreateDirectory(wdir);
                        string createdDir = wdir;
                        tx.Add("Unterordner entfernen", delegate { if (Directory.Exists(createdDir) && !Directory.EnumerateFileSystemEntries(createdDir).Any()) Util.DeleteDirectory(createdDir); });
                    }
                    string final = Util.UniqueFilePath(wdir, Util.SafeFileName(s.OrigName), taken);
                    string tmp = Path.Combine(dir, s.TempName);
                    MoveFile(tmp, final);
                    taken.Add(final);
                    string a = tmp, b = final;
                    tx.Add("Datei zurückbenennen", delegate { MoveFile(b, a); });
                    p.Arbeitsdateien.Add(Util.RelPath(dir, final));
                }

                // 5. Produktdaten sicher schreiben
                string jsonPath = Path.Combine(dir, Piece.DataFile);
                string oldJson = File.Exists(jsonPath) ? Util.ReadAllTextShared(jsonPath) : null;
                Util.WriteAllTextAtomic(jsonPath, p.ToJson());
                if (oldJson != null) tx.Add("Produktdaten zurücksetzen", delegate { Util.WriteAllTextAtomic(jsonPath, oldJson); });
                tx.Commit();
                p.Dir = dir;
                return p;
            }
            catch (Exception ex)
            {
                var errors = tx.Rollback();
                Util.Log("Speichern fehlgeschlagen (" + old.Titel + "): " + ex + (errors.Count > 0 ? " | Rücknahme-Fehler: " + string.Join("; ", errors) : ""));
                if (errors.Count > 0)
                    throw new UserError(Util.IoMessage(ex) + " Achtung: Einige Schritte konnten nicht vollständig zurückgenommen werden. Bitte „Sammlung prüfen“ öffnen. Details stehen im Protokoll.", 500);
                throw new UserError("Speichern nicht möglich – es wurde nichts verändert. " + Util.IoMessage(ex), 500);
            }
        }

        // ================================================================ Zuordnen, Übernehmen

        public Piece AssignFile(string id, string datei, string rolle)
        {
            lock (Sync)
            {
                var p = Get(id);
                string full = Util.SafeCombine(p.Dir, (datei ?? "").Replace('/', '\\'));
                if (!File.Exists(full)) throw new UserError("Die Datei wurde nicht gefunden. Bitte „Aktualisieren“ wählen.");
                string rel = Util.RelPath(p.Dir, full);
                var n = p.Clone();
                if (rolle == "arbeitsdatei")
                {
                    if (!n.Arbeitsdateien.Contains(rel, StringComparer.OrdinalIgnoreCase)) n.Arbeitsdateien.Add(rel);
                }
                else
                {
                    int i = Piece.RoleIndex(rolle);
                    if (i < 0) throw new UserError("Unbekannte Zuordnung.");
                    if (!Util.IsImageExt(Path.GetExtension(rel))) throw new UserError("Nur Bilddateien können als " + Piece.RoleLabel[i] + " zugeordnet werden.");
                    n.Bilder[rolle] = rel;
                    n.Arbeitsdateien.RemoveAll(a => string.Equals(a, rel, StringComparison.OrdinalIgnoreCase));
                }
                n.Geaendert = DateTime.Now;
                Util.WriteAllTextAtomic(Path.Combine(p.Dir, Piece.DataFile), n.ToJson());
                Util.Log("Datei zugeordnet: " + p.Titel + " / " + rel + " -> " + rolle);
                Scan();
                return pieces[p.Id];
            }
        }

        /// <summary>Übernimmt einen Ordner ohne Produktdaten.json als Piece.</summary>
        public Piece AdoptFolder(string relFolder)
        {
            lock (Sync)
            {
                string dir = Util.SafeCombine(Root, (relFolder ?? "").Replace('/', '\\'));
                if (!Directory.Exists(dir)) throw new UserError("Der Ordner wurde nicht gefunden.");
                if (File.Exists(Path.Combine(dir, Piece.DataFile))) throw new UserError("Dieser Ordner enthält bereits Produktdaten.");
                string cat = Path.GetFileName(Path.GetDirectoryName(dir));
                if (!categories.Contains(cat)) throw new UserError("Der Ordner liegt nicht direkt in einem Kleidungstyp-Ordner.");
                var p = BuildFromFolder(dir, cat, null);
                Util.WriteAllTextAtomic(Path.Combine(dir, Piece.DataFile), p.ToJson());
                Util.Log("Ordner übernommen: " + Util.RelPath(Root, dir));
                Scan();
                return pieces[p.Id];
            }
        }

        Piece BuildFromFolder(string dir, string cat, int? wantedNumber)
        {
            string leaf = Path.GetFileName(dir);
            var p = new Piece();
            p.Id = NewId();
            p.Kategorie = cat;
            var parts = leaf.Split(new[] { '_' }, 3);
            int n;
            int rest = 0;
            if (parts.Length > 1 && int.TryParse(parts[0], out n) && n > 0) { p.Nummer = n; rest = 1; }
            if (wantedNumber.HasValue) p.Nummer = wantedNumber.Value;
            if (p.Nummer <= 0 || NumberOwner(p.Nummer, null) != null) p.Nummer = NextNumber();
            p.Name = parts.Length > rest ? parts[rest].Replace('_', ' ').Trim() : leaf;
            if (p.Name.Length == 0) p.Name = leaf;
            p.Motivtitel = parts.Length > rest + 1 ? string.Join(" ", parts.Skip(rest + 1)).Replace('_', ' ').Trim() : "";
            DateTime first = DateTime.Now;
            var files = Directory.GetFiles(dir, "*", SearchOption.AllDirectories).OrderBy(x => x, StringComparer.OrdinalIgnoreCase).ToList();
            foreach (var r in Piece.Roles) p.Bilder[r] = null;
            foreach (var f in files)
            {
                string name = Path.GetFileName(f);
                if (IgnoredFiles.Contains(name) || name.StartsWith(".")) continue;
                var t = File.GetLastWriteTime(f);
                if (t < first) first = t;
                string rel = Util.RelPath(dir, f);
                if (Util.IsImageExt(Path.GetExtension(f)))
                {
                    string role = Piece.GuessRole(name);
                    if (role != null && p.Bilder[role] == null) { p.Bilder[role] = rel; continue; }
                }
                else
                {
                    p.Arbeitsdateien.Add(rel);
                    if (string.Equals(name, "Konzept.txt", StringComparison.OrdinalIgnoreCase) && p.Beschreibung.Length == 0)
                        p.Beschreibung = DescriptionFromKonzept(Util.ReadAllTextShared(f));
                }
            }
            p.Erstellt = first;
            p.Geaendert = DateTime.Now;
            p.Entwurf = p.Bilder.Values.Any(v => v == null);
            p.Herkunft = "Ordner „" + leaf + "“ am " + DateTime.Now.ToString("dd.MM.yyyy") + " in den Katalog übernommen.";
            return p;
        }

        /// <summary>Übernimmt den Text aus Konzept.txt; die erste Zeile (Name/Titelzeile) entfällt, da sie Nummer und Name wiederholt.</summary>
        public static string DescriptionFromKonzept(string text)
        {
            var lines = (text ?? "").Replace("\r\n", "\n").Split('\n').ToList();
            if (lines.Count > 0)
            {
                string first = lines[0].Trim();
                if (first.StartsWith("Name:", StringComparison.OrdinalIgnoreCase) || first.StartsWith("APOLOGEA ", StringComparison.Ordinal))
                    lines.RemoveAt(0);
            }
            return string.Join("\n", lines).Trim();
        }

        /// <summary>Liest den Produktnamen aus der Titelzeile einer Konzept.txt („Name: 41 PANTOKRATOR COLOR“ bzw. „APOLOGEA 132 · BENEDICT“).</summary>
        public static string NameFromKonzept(string text)
        {
            if (string.IsNullOrEmpty(text)) return null;
            string first = text.Replace("\r\n", "\n").Split('\n')[0].Trim();
            var m = System.Text.RegularExpressions.Regex.Match(first, @"^Name:\s*\d+\s+(.+)$");
            if (!m.Success) m = System.Text.RegularExpressions.Regex.Match(first, @"^APOLOGEA\s+\d+\s*·\s*(.+)$");
            return m.Success ? m.Groups[1].Value.Trim() : null;
        }

        // ================================================================ Papierkorb

        public void TrashPiece(string id)
        {
            lock (Sync)
            {
                var p = Get(id);
                Directory.CreateDirectory(TrashPiecesDir);
                string target = Util.UniqueDirPath(TrashPiecesDir, DateTime.Now.ToString("yyyy-MM-dd_HHmmss") + "__" + p.Kategorie + "__" + Path.GetFileName(p.Dir));
                try { MoveDir(p.Dir, target); }
                catch (Exception ex) { throw new UserError("Das Piece konnte nicht in den Papierkorb verschoben werden. " + Util.IoMessage(ex), 500); }
                var info = new Dictionary<string, object>();
                info["id"] = p.Id;
                info["nummer"] = p.Nummer;
                info["name"] = p.Name;
                info["kategorie"] = p.Kategorie;
                info["ursprungsordner"] = Util.RelPath(Root, p.Dir);
                info["geloescht"] = Util.Iso(DateTime.Now);
                try { Util.WriteAllTextAtomic(Path.Combine(target, "_Papierkorb-Info.json"), Json.Write(info, true)); } catch { }
                Util.Log("In Papierkorb: " + p.Titel);
                Scan();
            }
        }

        public List<object> ListTrash()
        {
            lock (Sync)
            {
                var res = new List<object>();
                if (Directory.Exists(TrashPiecesDir))
                {
                    foreach (var d in Directory.GetDirectories(TrashPiecesDir).OrderByDescending(x => x))
                    {
                        var e = new Dictionary<string, object>();
                        e["art"] = "piece";
                        e["eintrag"] = Path.GetFileName(d);
                        e["ordnerVoll"] = d;
                        try
                        {
                            var info = File.Exists(Path.Combine(d, "_Papierkorb-Info.json")) ? Json.ParseObject(Util.ReadAllTextShared(Path.Combine(d, "_Papierkorb-Info.json"))) : new Dictionary<string, object>();
                            var pd = Json.ParseObject(Util.ReadAllTextShared(Path.Combine(d, Piece.DataFile)));
                            var tp = Piece.FromDict(pd);
                            e["nummer"] = tp.Nummer;
                            e["nummerText"] = tp.NummerText;
                            e["name"] = tp.Name;
                            e["kategorie"] = Json.StrOr(info, "kategorie", tp.Kategorie);
                            e["ursprungsordner"] = Json.Str(info, "ursprungsordner");
                            e["geloescht"] = Json.Str(info, "geloescht") ?? Util.Iso(Directory.GetLastWriteTime(d));
                            string img = null;
                            foreach (var r in new[] { "mockup", "design", "kleidungsansicht" })
                            {
                                string rel;
                                if (tp.Bilder.TryGetValue(r, out rel) && rel != null && File.Exists(Path.Combine(d, rel))) { img = Util.RelPath(Root, Path.Combine(d, rel)).Replace('\\', '/'); break; }
                            }
                            e["bild"] = img;
                        }
                        catch (Exception ex) { e["fehler"] = "Produktdaten nicht lesbar: " + ex.Message; e["name"] = Path.GetFileName(d); }
                        res.Add(e);
                    }
                }
                if (Directory.Exists(TrashFilesDir))
                {
                    foreach (var d in Directory.GetDirectories(TrashFilesDir).OrderByDescending(x => x))
                    {
                        var e = new Dictionary<string, object>();
                        e["art"] = "dateien";
                        e["eintrag"] = Path.GetFileName(d);
                        e["ordnerVoll"] = d;
                        e["dateien"] = Directory.GetFiles(d, "*", SearchOption.AllDirectories).Select(f => (object)Util.RelPath(d, f)).ToList();
                        e["geloescht"] = Util.Iso(Directory.GetCreationTime(d));
                        res.Add(e);
                    }
                }
                return res;
            }
        }

        string TrashEntryDir(string art, string eintrag)
        {
            if (string.IsNullOrEmpty(eintrag) || eintrag.Contains("\\") || eintrag.Contains("/") || eintrag.Contains(".."))
                throw new UserError("Ungültiger Papierkorb-Eintrag.");
            string d = Path.Combine(art == "dateien" ? TrashFilesDir : TrashPiecesDir, eintrag);
            if (!Directory.Exists(d)) throw new UserError("Der Papierkorb-Eintrag wurde nicht gefunden.");
            return d;
        }

        public Piece RestorePiece(string eintrag)
        {
            lock (Sync)
            {
                string d = TrashEntryDir("piece", eintrag);
                string infoPath = Path.Combine(d, "_Papierkorb-Info.json");
                var info = File.Exists(infoPath) ? Json.ParseObject(Util.ReadAllTextShared(infoPath)) : new Dictionary<string, object>();
                string jsonPath = Path.Combine(d, Piece.DataFile);
                var p = Piece.FromDict(Json.ParseObject(Util.ReadAllTextShared(jsonPath)));
                string cat = p.Kategorie;
                if (string.IsNullOrEmpty(cat)) cat = Json.StrOr(info, "kategorie", "Wiederhergestellt");
                string origLeaf = Path.GetFileName(Json.StrOr(info, "ursprungsordner", Piece.FolderNameFor(p.Nummer, p.Name, p.Motivtitel)));
                string note = "";
                // Die Nummer zählt im Papierkorb als vergeben – hier nur gegen aktive Pieces prüfen
                if (pieces.Values.Any(x => x.Nummer == p.Nummer) || pieces.ContainsKey(p.Id ?? ""))
                {
                    if (pieces.ContainsKey(p.Id ?? "")) p.Id = NewId();
                    if (pieces.Values.Any(x => x.Nummer == p.Nummer))
                    {
                        int old = p.Nummer;
                        p.Nummer = NextNumber();
                        origLeaf = Piece.FolderNameFor(p.Nummer, p.Name, p.Motivtitel);
                        note = " Die Nummer " + old.ToString("000") + " war inzwischen vergeben; neue Nummer: " + p.NummerText + ".";
                    }
                    Util.WriteAllTextAtomic(jsonPath, p.ToJson());
                }
                string catDir = Path.Combine(Root, cat);
                Directory.CreateDirectory(catDir);
                string target = Util.UniqueDirPath(catDir, origLeaf);
                try { MoveDir(d, target); }
                catch (Exception ex) { throw new UserError("Wiederherstellen nicht möglich. " + Util.IoMessage(ex), 500); }
                try { File.Delete(Path.Combine(target, "_Papierkorb-Info.json")); } catch { }
                Util.Log("Wiederhergestellt: " + p.Titel + " -> " + Util.RelPath(Root, target) + note);
                Scan();
                Piece res;
                if (!pieces.TryGetValue(p.Id, out res)) throw new UserError("Wiederhergestellt, aber nicht eingelesen. Bitte „Aktualisieren“ wählen.");
                res.Extra["_hinweis"] = note;
                return res;
            }
        }

        public void DeleteTrashForever(string art, string eintrag)
        {
            lock (Sync)
            {
                string d = TrashEntryDir(art, eintrag);
                try { Util.DeleteDirectory(d); }
                catch (Exception ex) { throw new UserError("Endgültiges Löschen nicht vollständig möglich. " + Util.IoMessage(ex) + " Bitte später erneut versuchen.", 500); }
                Util.Log("Endgültig gelöscht: " + art + " / " + eintrag);
            }
        }

        // ================================================================ Import des Altbestands

        public Dictionary<string, object> ImportLegacy(string source, Action<string> progress)
        {
            lock (Sync)
            {
                source = Path.GetFullPath(source).TrimEnd('\\');
                if (!Directory.Exists(source)) throw new UserError("Der Quellordner wurde nicht gefunden.");
                if (string.Equals(source, Root, StringComparison.OrdinalIgnoreCase) || Root.StartsWith(source + "\\", StringComparison.OrdinalIgnoreCase) || source.StartsWith(Root + "\\", StringComparison.OrdinalIgnoreCase))
                    throw new UserError("Quellordner und Sammlungsordner dürfen nicht ineinander liegen.");
                Scan();
                var report = new StringBuilder();
                report.AppendLine("APOLOGEA – Importbericht");
                report.AppendLine("Quelle:   " + source);
                report.AppendLine("Ziel:     " + Root);
                report.AppendLine("Zeitpunkt: " + DateTime.Now.ToString("dd.MM.yyyy HH:mm"));
                report.AppendLine();

                // Einträge bestimmen: bevorzugt aus Gesamtindex.json, sonst aus der Ordnerstruktur
                var entries = new List<Dictionary<string, object>>();
                string indexPath = Path.Combine(source, "Gesamtindex.json");
                bool fromIndex = File.Exists(indexPath);
                if (fromIndex)
                {
                    var arr = Json.Parse(Util.ReadAllTextShared(indexPath)) as object[];
                    if (arr == null) throw new UserError("Gesamtindex.json hat ein unerwartetes Format.");
                    foreach (var o in arr) { var e = o as Dictionary<string, object>; if (e != null) entries.Add(e); }
                    report.AppendLine("Grundlage: Gesamtindex.json mit " + entries.Count + " Einträgen.");
                }
                else
                {
                    foreach (var cd in Directory.GetDirectories(source))
                        foreach (var pd in Directory.GetDirectories(cd))
                        {
                            var e = new Dictionary<string, object>();
                            e["Ordner"] = Util.RelPath(source, pd).Replace('\\', '/');
                            e["Kategorie"] = Path.GetFileName(cd);
                            entries.Add(e);
                        }
                    report.AppendLine("Grundlage: Ordnerstruktur (keine Gesamtindex.json gefunden), " + entries.Count + " Ordner.");
                }
                var indexedDirs = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
                int ok = 0, skipped = 0, renumbered = 0, files = 0;
                long bytes = 0;
                var problems = new List<string>();
                int k = 0;
                foreach (var e in entries)
                {
                    k++;
                    string relDir = (Json.Str(e, "Ordner") ?? "").Replace('/', '\\');
                    string srcDir = Path.Combine(source, relDir);
                    indexedDirs.Add(Path.GetFullPath(srcDir));
                    if (progress != null) progress("Übernehme " + k + " von " + entries.Count + ": " + relDir);
                    if (!Directory.Exists(srcDir)) { problems.Add("Ordner fehlt in der Quelle: " + relDir); skipped++; continue; }
                    string cat = Json.Str(e, "Kategorie") ?? Path.GetFileName(Path.GetDirectoryName(srcDir));
                    cat = SafeCategoryName(cat);
                    string leaf = Path.GetFileName(srcDir);
                    // bereits übernommen? (gleicher Ordner mit Produktdaten)
                    if (Directory.Exists(Path.Combine(Root, cat, leaf)))
                    {
                        problems.Add("Übersprungen, Zielordner existiert bereits: " + cat + "\\" + leaf);
                        skipped++;
                        continue;
                    }
                    int? nr = Json.Int(e, "Nr");
                    var p = BuildFromFolder(srcDir, cat, nr);
                    if (nr.HasValue && p.Nummer != nr.Value)
                    {
                        problems.Add("Nummer " + nr.Value.ToString("000") + " war bereits vergeben – „" + leaf + "“ erhielt die Nummer " + p.NummerText + ".");
                        renumbered++;
                        leaf = p.NummerText + leaf.Substring(leaf.IndexOf('_') < 0 ? leaf.Length : leaf.IndexOf('_'));
                    }
                    if (fromIndex)
                    {
                        string nm = Json.Str(e, "Name");
                        if (!string.IsNullOrEmpty(nm)) p.Name = nm.Trim();
                        p.Motivtitel = (Json.Str(e, "Motivtitel") ?? p.Motivtitel).Trim();
                        p.Serie = (Json.Str(e, "Serie") ?? "").Trim();
                        string konzeptFile = Path.Combine(srcDir, "Konzept.txt");
                        string konzept = File.Exists(konzeptFile) ? Util.ReadAllTextShared(konzeptFile) : Json.Str(e, "Konzept");
                        p.Beschreibung = DescriptionFromKonzept(konzept);
                        // Der Gesamtindex schreibt manche Namen mit Unterstrichen (aus dem Ordnernamen);
                        // die Konzeptdatei enthält die eigentliche Schreibweise mit Leerzeichen.
                        string kname = NameFromKonzept(konzept);
                        if (kname != null && p.Name.Contains("_") && string.Equals(kname.Replace(' ', '_'), p.Name, StringComparison.OrdinalIgnoreCase))
                            p.Name = kname;
                        var bild = Json.StrList(e, "Bilddateien");
                        foreach (var r in Piece.Roles) p.Bilder[r] = null;
                        var rest = new List<string>();
                        foreach (var b in bild)
                        {
                            string role = Piece.GuessRole(b);
                            if (role != null && p.Bilder[role] == null) p.Bilder[role] = b;
                            else rest.Add(b);
                        }
                        // Arbeitsdateien: alle übrigen Dateien des Ordners
                        p.Arbeitsdateien = new List<string>();
                        foreach (var f in Directory.GetFiles(srcDir, "*", SearchOption.AllDirectories))
                        {
                            string rel = Util.RelPath(srcDir, f);
                            if (IgnoredFiles.Contains(Path.GetFileName(f))) continue;
                            if (p.Bilder.Values.Any(v => string.Equals(v, rel, StringComparison.OrdinalIgnoreCase))) continue;
                            if (!Util.IsImageExt(Path.GetExtension(f))) p.Arbeitsdateien.Add(rel);
                        }
                        string status = Json.Str(e, "Status") ?? "";
                        p.Entwurf = p.Bilder.Values.Any(v => v == null || !File.Exists(Path.Combine(srcDir, v)));
                        p.Herkunft = "Übernommen am " + DateTime.Now.ToString("dd.MM.yyyy") + " aus „" + Path.GetFileName(source) + "“ (Gesamtindex.json, Nr. " + (nr.HasValue ? nr.Value.ToString("000") : "–") + (status.Length > 0 ? ", Status: " + status : "") + ").";
                        var imp = new Dictionary<string, object>();
                        imp["quelle"] = Util.RelPath(source, srcDir).Replace('\\', '/');
                        imp["status_alt"] = status;
                        if (nr.HasValue) imp["nummer_alt"] = nr.Value;
                        p.Extra["import"] = imp;
                    }
                    p.Kategorie = cat;
                    // Kopie anlegen: erst Zwischenordner, dann atomar an Ort und Stelle verschieben
                    string catDir = Path.Combine(Root, cat);
                    Directory.CreateDirectory(catDir);
                    string staging = Path.Combine(MetaDir, "neu_" + Guid.NewGuid().ToString("N").Substring(0, 12));
                    try
                    {
                        foreach (var f in Directory.GetFiles(srcDir, "*", SearchOption.AllDirectories))
                        {
                            string rel = Util.RelPath(srcDir, f);
                            string dst = Path.Combine(staging, rel);
                            Directory.CreateDirectory(Path.GetDirectoryName(dst));
                            File.Copy(f, dst, false);
                            File.SetLastWriteTimeUtc(dst, File.GetLastWriteTimeUtc(f));
                            if (Util.Sha256File(f) != Util.Sha256File(dst)) throw new IOException("Prüfsumme der Kopie stimmt nicht: " + rel);
                            files++;
                            bytes += new FileInfo(f).Length;
                        }
                        File.WriteAllText(Path.Combine(staging, Piece.DataFile), p.ToJson(), Util.Utf8);
                        string target = Util.UniqueDirPath(catDir, leaf);
                        Util.RetryIo(delegate { Directory.Move(staging, target); });
                        p.Dir = target;
                        pieces[p.Id] = p; // damit Nummern innerhalb des Imports als vergeben gelten
                        ok++;
                        if (p.Entwurf) problems.Add("Unvollständig (als Entwurf markiert): " + cat + "\\" + leaf);
                    }
                    catch (Exception ex)
                    {
                        try { if (Directory.Exists(staging)) Util.DeleteDirectory(staging); } catch { }
                        problems.Add("FEHLER bei " + relDir + ": " + Util.IoMessage(ex));
                        skipped++;
                    }
                }
                // Ordner in der Quelle, die nicht im Index stehen
                if (fromIndex)
                {
                    foreach (var cd in Directory.GetDirectories(source))
                        foreach (var pd in Directory.GetDirectories(cd))
                            if (!indexedDirs.Contains(Path.GetFullPath(pd)))
                                problems.Add("Nicht im Gesamtindex enthalten (nicht übernommen): " + Util.RelPath(source, pd));
                }
                // Katalogdaten des Altbestands zur Nachvollziehbarkeit sichern
                string archive = Util.UniqueDirPath(Path.Combine(Root, "_Altbestand"), Path.GetFileName(source));
                Directory.CreateDirectory(archive);
                foreach (var f in Directory.GetFiles(source))
                {
                    string ext = Path.GetExtension(f).ToLowerInvariant();
                    if (ext == ".json" || ext == ".txt" || ext == ".csv" || ext == ".md")
                        File.Copy(f, Path.Combine(archive, Path.GetFileName(f)), false);
                    else
                        problems.Add("Nicht in die Sammlung kopiert (bleibt im Original erhalten): " + Path.GetFileName(f) + " (" + Util.FormatBytes(new FileInfo(f).Length) + ")");
                }
                report.AppendLine();
                report.AppendLine("Übernommene Pieces: " + ok);
                report.AppendLine("Übersprungen/Fehler: " + skipped);
                report.AppendLine("Neu nummeriert: " + renumbered);
                report.AppendLine("Kopierte Dateien: " + files + " (" + Util.FormatBytes(bytes) + "), jede Kopie per SHA-256 mit dem Original verglichen.");
                report.AppendLine();
                report.AppendLine(problems.Count == 0 ? "Keine Auffälligkeiten." : "Hinweise:");
                foreach (var pr in problems) report.AppendLine(" - " + pr);
                File.WriteAllText(Path.Combine(archive, "Importbericht.txt"), report.ToString(), Util.Utf8);
                Util.Log("Import abgeschlossen: " + ok + " Pieces aus " + source);
                Scan();
                var res = new Dictionary<string, object>();
                res["uebernommen"] = ok;
                res["uebersprungen"] = skipped;
                res["neuNummeriert"] = renumbered;
                res["dateien"] = files;
                res["hinweise"] = problems;
                res["bericht"] = Path.Combine(archive, "Importbericht.txt");
                return res;
            }
        }
    }
}
