// APOLOGEA Kollektionsverwaltung – vollständige ZIP-Sicherung mit Prüfung
using System;
using System.Collections.Generic;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using System.Threading;

namespace Apologea
{
    public class BackupJob
    {
        public volatile bool Running;
        public string Phase = "";
        public int FilesDone, FilesTotal;
        public long BytesDone, BytesTotal;
        public string Result;
        public string Error;
        public DateTime Started;
        public DateTime? Finished;
        public int PieceCount;
        public long ZipSize;
        public bool Verified;

        public Dictionary<string, object> ToApi()
        {
            var d = new Dictionary<string, object>();
            d["laeuft"] = Running;
            d["phase"] = Phase;
            d["dateienFertig"] = FilesDone;
            d["dateienGesamt"] = FilesTotal;
            d["bytesFertig"] = BytesDone;
            d["bytesGesamt"] = BytesTotal;
            d["ergebnis"] = Result;
            d["fehler"] = Error;
            d["pieces"] = PieceCount;
            d["zipGroesse"] = ZipSize;
            d["geprueft"] = Verified;
            d["dauerSekunden"] = (int)((Finished ?? DateTime.Now) - Started).TotalSeconds;
            return d;
        }
    }

    public static class Backup
    {
        public static BackupJob Current;
        static readonly object sync = new object();

        class Item
        {
            public string Entry;
            public string Source;   // Datei auf der Festplatte oder null
            public byte[] Data;     // erzeugter Inhalt
            public long Length;
            public string Hash;
        }

        static readonly HashSet<string> Stored = new HashSet<string>(StringComparer.OrdinalIgnoreCase) {
            ".jpg", ".jpeg", ".png", ".gif", ".webp", ".zip", ".7z", ".rar", ".mp4", ".mov", ".avif", ".pdf", ".docx", ".xlsx", ".pptx" };

        public static BackupJob Start(Collection col, string target, bool includeTrash, bool verify, string programDir)
        {
            lock (sync)
            {
                if (Current != null && Current.Running) throw new UserError("Es läuft bereits eine Sicherung.");
                var job = new BackupJob();
                job.Running = true;
                job.Started = DateTime.Now;
                job.Phase = "Dateien werden gesammelt …";
                Current = job;
                var t = new Thread(delegate () { Run(job, col, target, includeTrash, verify, programDir); });
                t.IsBackground = false; // Sicherung soll auch beim Schließen des Fensters zu Ende laufen
                t.Name = "Sicherung";
                t.Start();
                return job;
            }
        }

        static bool Excluded(string rel, string fullTarget, string full, bool includeTrash)
        {
            string first = rel.Split('\\')[0];
            if (first.Equals(".apologea", StringComparison.OrdinalIgnoreCase))
            {
                // Nur Sammlungskennung und Logo sichern, keine Zwischenablagen
                if (rel.Contains("\\uploads\\") || rel.Contains("\\neu_") || rel.Contains("\\mobil_")) return true;
                return false;
            }
            if (!includeTrash && first.Equals("_Papierkorb", StringComparison.OrdinalIgnoreCase)) return true;
            string name = Path.GetFileName(rel);
            if (name.StartsWith("APOLOGEA_Sicherung", StringComparison.OrdinalIgnoreCase) && (name.EndsWith(".zip", StringComparison.OrdinalIgnoreCase) || name.EndsWith(".teilweise", StringComparison.OrdinalIgnoreCase))) return true;
            if (string.Equals(full, fullTarget, StringComparison.OrdinalIgnoreCase)) return true;
            if (name.EndsWith(".teilweise", StringComparison.OrdinalIgnoreCase)) return true;
            if (name.StartsWith(".neu_") || name.Contains(".schreiben-")) return true;
            if (rel.Equals("Katalog_Ansicht.html", StringComparison.OrdinalIgnoreCase)) return true; // wird frisch erzeugt
            return false;
        }

        static void Run(BackupJob job, Collection col, string target, bool includeTrash, bool verify, string programDir)
        {
            string partial = target + ".teilweise";
            try
            {
                col.Scan();
                var items = new List<Item>();
                string fullTarget = Path.GetFullPath(target);
                lock (col.Sync)
                {
                    foreach (var f in Directory.GetFiles(col.Root, "*", SearchOption.AllDirectories))
                    {
                        string rel = Util.RelPath(col.Root, f);
                        if (Excluded(rel, fullTarget, Path.GetFullPath(f), includeTrash)) continue;
                        var it = new Item();
                        it.Entry = "Sammlung/" + rel.Replace('\\', '/');
                        it.Source = f;
                        it.Length = new FileInfo(f).Length;
                        items.Add(it);
                    }
                    // leere Kategorien als Ordner erhalten
                    foreach (var c in col.Categories())
                        if (!Directory.EnumerateFileSystemEntries(Path.Combine(col.Root, c)).Any())
                            items.Add(new Item { Entry = "Sammlung/" + c + "/", Data = null, Length = 0 });
                    job.PieceCount = col.All().Count;
                    var html = HtmlExport.Build(col);
                    items.Add(new Item { Entry = "Sammlung/Katalog_Ansicht.html", Data = Util.Utf8.GetBytes(html) });
                }
                // Programmdateien für die Wiederherstellung
                string exe = System.Reflection.Assembly.GetExecutingAssembly().Location;
                items.Add(new Item { Entry = "APOLOGEA.exe", Source = exe, Length = new FileInfo(exe).Length });
                if (programDir != null)
                {
                    foreach (var name in new[] { "ANLEITUNG.html", "PRUEFBERICHT.txt" })
                    {
                        string f = Path.Combine(programDir, name);
                        if (File.Exists(f)) items.Add(new Item { Entry = name, Source = f, Length = new FileInfo(f).Length });
                    }
                    string src = Path.Combine(programDir, "Quellcode");
                    if (Directory.Exists(src))
                        foreach (var f in Directory.GetFiles(src, "*", SearchOption.AllDirectories))
                        {
                            string rel = Util.RelPath(src, f);
                            if (rel.StartsWith("build\\", StringComparison.OrdinalIgnoreCase)) continue;
                            items.Add(new Item { Entry = "Quellcode/" + rel.Replace('\\', '/'), Source = f, Length = new FileInfo(f).Length });
                        }
                }
                items.Add(new Item { Entry = "WIEDERHERSTELLEN.txt", Data = Util.Utf8.GetBytes(RestoreText(job.PieceCount)) });
                foreach (var it in items) if (it.Data != null) it.Length = it.Data.Length;

                job.FilesTotal = items.Count;
                job.BytesTotal = items.Sum(i => i.Length);
                var drive = new DriveInfo(Path.GetPathRoot(fullTarget));
                try
                {
                    if (drive.IsReady && drive.AvailableFreeSpace < job.BytesTotal + 50L * 1024 * 1024)
                        throw new UserError("Am Speicherort ist nicht genug Platz frei (benötigt etwa " + Util.FormatBytes(job.BytesTotal) + ", frei " + Util.FormatBytes(drive.AvailableFreeSpace) + ").");
                }
                catch (UserError) { throw; }
                catch { }

                job.Phase = "ZIP-Datei wird geschrieben …";
                if (File.Exists(partial)) File.Delete(partial);
                var buf = new byte[1 << 16];
                using (var fs = new FileStream(partial, FileMode.CreateNew, FileAccess.Write, FileShare.None, 1 << 16))
                using (var zip = new ZipArchive(fs, ZipArchiveMode.Create, false, Encoding.UTF8))
                {
                    foreach (var it in items)
                    {
                        if (it.Entry.EndsWith("/")) { zip.CreateEntry(it.Entry); job.FilesDone++; continue; }
                        var level = Stored.Contains(Path.GetExtension(it.Entry)) ? CompressionLevel.NoCompression : CompressionLevel.Optimal;
                        var entry = zip.CreateEntry(it.Entry, level);
                        if (it.Source != null) entry.LastWriteTime = File.GetLastWriteTime(it.Source);
                        using (var es = entry.Open())
                        using (var sha = SHA256.Create())
                        {
                            Stream input = it.Source != null
                                ? (Stream)new FileStream(it.Source, FileMode.Open, FileAccess.Read, FileShare.ReadWrite, 1 << 16)
                                : new MemoryStream(it.Data);
                            using (input)
                            {
                                long len = 0;
                                int n;
                                while ((n = input.Read(buf, 0, buf.Length)) > 0)
                                {
                                    es.Write(buf, 0, n);
                                    sha.TransformBlock(buf, 0, n, null, 0);
                                    len += n;
                                    job.BytesDone += n;
                                }
                                sha.TransformFinalBlock(buf, 0, 0);
                                it.Hash = Util.Hex(sha.Hash);
                                it.Length = len;
                            }
                        }
                        job.FilesDone++;
                    }
                }

                if (verify)
                {
                    job.Phase = "Sicherung wird geprüft …";
                    job.FilesDone = 0;
                    job.BytesDone = 0;
                    var expected = items.Where(i => !i.Entry.EndsWith("/")).ToDictionary(i => i.Entry, i => i);
                    using (var zip = ZipFile.OpenRead(partial))
                    {
                        int found = 0;
                        foreach (var e in zip.Entries)
                        {
                            if (e.FullName.EndsWith("/")) { job.FilesDone++; continue; }
                            Item it;
                            if (!expected.TryGetValue(e.FullName, out it)) throw new IOException("Unerwarteter Eintrag in der Sicherung: " + e.FullName);
                            using (var es = e.Open())
                            using (var sha = SHA256.Create())
                            {
                                long len = 0;
                                int n;
                                while ((n = es.Read(buf, 0, buf.Length)) > 0)
                                {
                                    sha.TransformBlock(buf, 0, n, null, 0);
                                    len += n;
                                    job.BytesDone += n;
                                }
                                sha.TransformFinalBlock(buf, 0, 0);
                                if (len != it.Length || Util.Hex(sha.Hash) != it.Hash)
                                    throw new IOException("Prüfung fehlgeschlagen für „" + e.FullName + "“ – Inhalt weicht ab.");
                            }
                            found++;
                            job.FilesDone++;
                        }
                        if (found != expected.Count) throw new IOException("In der Sicherung fehlen " + (expected.Count - found) + " Dateien.");
                    }
                    job.Verified = true;
                }

                if (File.Exists(target)) File.Delete(target);
                File.Move(partial, target);
                job.ZipSize = new FileInfo(target).Length;
                job.Result = target;
                job.Phase = "Fertig";
                Util.Log("Sicherung erstellt: " + target + " (" + job.FilesTotal + " Dateien, " + Util.FormatBytes(job.ZipSize) + ", geprüft: " + job.Verified + ")");
            }
            catch (Exception ex)
            {
                job.Error = (ex is UserError ? ex.Message : "Die Sicherung ist fehlgeschlagen: " + Util.IoMessage(ex)) + " Es wurde keine unvollständige Sicherung hinterlassen.";
                job.Phase = "Fehlgeschlagen";
                Util.Log("Sicherung fehlgeschlagen: " + ex);
                try { if (File.Exists(partial)) File.Delete(partial); } catch { }
            }
            finally
            {
                job.Finished = DateTime.Now;
                job.Running = false;
            }
        }

        static string RestoreText(int pieces)
        {
            var sb = new StringBuilder();
            sb.AppendLine("APOLOGEA – Vollständige Sicherung");
            sb.AppendLine("Erstellt am " + DateTime.Now.ToString("dd.MM.yyyy 'um' HH:mm 'Uhr'") + " · " + pieces + " Pieces");
            sb.AppendLine();
            sb.AppendLine("INHALT");
            sb.AppendLine("  APOLOGEA.exe            Das Arbeitsprogramm (Windows 10/11, keine Installation nötig)");
            sb.AppendLine("  Sammlung\\               Alle Pieces: Kleidungstyp \\ Nummer_Name \\ Dateien + Produktdaten.json");
            sb.AppendLine("  Sammlung\\Katalog_Ansicht.html   Reine Ansicht mit Suche – im Browser öffnen, ohne Programm");
            sb.AppendLine("  Quellcode\\              Vollständiger Quellcode und Bauanleitung");
            sb.AppendLine();
            sb.AppendLine("WIEDERHERSTELLEN");
            sb.AppendLine("  1. Diese ZIP-Datei vollständig entpacken (Rechtsklick > „Alle extrahieren …“),");
            sb.AppendLine("     am besten in einen neuen, leeren Ordner.");
            sb.AppendLine("  2. Im entpackten Ordner „APOLOGEA.exe“ doppelklicken.");
            sb.AppendLine("  3. Beim allerersten Start auf einem PC wird der Ordner „Sammlung“ daneben automatisch verwendet.");
            sb.AppendLine("     Wurde das Programm auf diesem PC schon benutzt: oben rechts „Einstellungen“ >");
            sb.AppendLine("     „Anderen Sammlungsordner wählen …“ und den entpackten Ordner „Sammlung“ auswählen.");
            sb.AppendLine();
            sb.AppendLine("Alle Bilder liegen als normale Dateien in den Produktordnern und lassen sich auch ohne");
            sb.AppendLine("das Programm mit dem Explorer öffnen. Die Datei Produktdaten.json in jedem Produktordner");
            sb.AppendLine("enthält Nummer, Name, Kleidungstyp, Beschreibung, Schlagwörter und die Bildzuordnung.");
            return sb.ToString();
        }
    }
}
