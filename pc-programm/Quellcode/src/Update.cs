// APOLOGEA Kollektionsverwaltung – Programm-Aktualisierung aus GitHub (nur nach ausdrücklichem Klick)
// Quelle: öffentliches Repository rfaelfox/apologea, Zweig claude/apologea-shopify-theme-9kvfrj, Ordner pc-programm/
//   update.json = { "app", "version", "hinweise", "files": { "src/Api.cs": "<sha256>", … } }
// Ablauf: neuesten Commit ermitteln → update.json dieses Commits → alle Dateien laden und Prüfsummen kontrollieren
// (bei Abweichung wird nichts verändert) → bisherigen Quellcode und EXE sichern (letzte 5) → Dateien ersetzen →
// bauen.cmd → bei Erfolg Neustart, bei Fehler alles zurück.
// Hinweis: Wer auf diesen Zweig schreiben kann, kann darüber Programmcode auf den PC bringen – daher nur per Klick.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Net;
using System.Security.Cryptography;
using System.Text;

namespace Apologea
{
    public static class Updater
    {
        public const string AppName = "APOLOGEA Kollektionsverwaltung";
        const string Repo = "rfaelfox/apologea";
        const string Branch = "claude/apologea-shopify-theme-9kvfrj";
        const string Folder = "pc-programm";
        // Nur zum Testen umstellbar (z. B. auf einen lokalen Prüfserver)
        static string ApiBase { get { return Environment.GetEnvironmentVariable("APOLOGEA_UPDATE_API") ?? "https://api.github.com"; } }
        static string RawBase { get { return Environment.GetEnvironmentVariable("APOLOGEA_UPDATE_RAW") ?? "https://raw.githubusercontent.com"; } }
        static readonly string[] AllowedDirs = { "src/", "ui/" };
        static readonly string[] AllowedTop = { "bauen.cmd", "app.manifest", "apologea.ico", "symbol_erzeugen.ps1" };
        static readonly object Gate = new object();
        static bool running;

        public static string SourceDir { get { return Path.Combine(Program.ExeDir, "Quellcode"); } }
        static string ExePath { get { return System.Reflection.Assembly.GetExecutingAssembly().Location; } }

        static Updater()
        {
            try { ServicePointManager.SecurityProtocol |= SecurityProtocolType.Tls12; } catch { }
        }

        static WebClient Client()
        {
            var w = new WebClient();
            w.Headers[HttpRequestHeader.UserAgent] = "APOLOGEA-Kollektionsverwaltung/" + Program.Version;
            w.Encoding = Util.Utf8;
            return w;
        }

        /// <summary>Versionsvergleich „1.2.0“ gegen „1.10.0“ (zahlenweise)</summary>
        public static int Compare(string a, string b)
        {
            Func<string, int[]> parse = s => (s ?? "0").Split('.').Select(x => { int n; return int.TryParse(x, out n) ? n : 0; }).Concat(new[] { 0, 0, 0 }).Take(3).ToArray();
            var x1 = parse(a); var x2 = parse(b);
            for (int i = 0; i < 3; i++) if (x1[i] != x2[i]) return x1[i].CompareTo(x2[i]);
            return 0;
        }

        static Dictionary<string, object> FetchManifest(WebClient w, out string sha)
        {
            string commitJson;
            try { commitJson = w.DownloadString(ApiBase + "/repos/" + Repo + "/commits/" + Uri.EscapeDataString(Branch)); }
            catch (WebException ex) { throw new UserError("GitHub ist gerade nicht erreichbar (" + ex.Message + "). Bitte Internetverbindung prüfen und später erneut versuchen."); }
            sha = Json.Str(Json.ParseObject(commitJson), "sha") ?? "";
            if (sha.Length < 7 || sha.Any(c => !Uri.IsHexDigit(c))) throw new UserError("Die Antwort von GitHub war unerwartet.");
            string text;
            try { text = w.DownloadString(RawBase + "/" + Repo + "/" + sha + "/" + Folder + "/update.json"); }
            catch (WebException ex) { throw new UserError("Die Update-Beschreibung konnte nicht geladen werden (" + ex.Message + ")."); }
            var man = Json.ParseObject(text);
            if (Json.Str(man, "app") != AppName) throw new UserError("Die Update-Beschreibung gehört nicht zu diesem Programm.");
            return man;
        }

        public static Dictionary<string, object> Check()
        {
            using (var w = Client())
            {
                string sha;
                var man = FetchManifest(w, out sha);
                string ver = Json.Str(man, "version") ?? "0";
                var r = new Dictionary<string, object>();
                r["ok"] = true;
                r["aktuell"] = Program.Version;
                r["neueste"] = ver;
                r["verfuegbar"] = Compare(ver, Program.Version) > 0;
                r["commit"] = sha;
                r["hinweise"] = Json.Str(man, "hinweise") ?? "";
                r["laeuft"] = running;
                return r;
            }
        }

        static void CheckRel(string rel)
        {
            if (string.IsNullOrEmpty(rel) || rel.Contains("..") || rel.Contains("\\") || rel.StartsWith("/") || rel.Contains(":"))
                throw new UserError("Ungültiger Dateiname in der Update-Beschreibung: " + rel);
            bool ok = AllowedTop.Contains(rel) || AllowedDirs.Any(d => rel.StartsWith(d));
            if (!ok) throw new UserError("Die Update-Beschreibung enthält eine nicht erlaubte Datei: " + rel);
        }

        static string Sha256(byte[] b) { using (var s = SHA256.Create()) return Util.Hex(s.ComputeHash(b)); }

        static string RawUrl(string sha, string rel)
        {
            return RawBase + "/" + Repo + "/" + sha + "/" + Folder + "/Quellcode/" + string.Join("/", rel.Split('/').Select(Uri.EscapeDataString));
        }

        public static Dictionary<string, object> Install(string expectedCommit)
        {
            lock (Gate)
            {
                if (running) throw new UserError("Die Aktualisierung läuft bereits.");
                running = true;
            }
            try
            {
                if (Backup.Current != null && Backup.Current.Running) throw new UserError("Es läuft gerade eine Sicherung. Bitte warten, bis sie abgeschlossen ist.");
                string exe = ExePath;
                if (!string.Equals(Path.GetFileName(exe), "APOLOGEA.exe", StringComparison.OrdinalIgnoreCase))
                    throw new UserError("Die Aktualisierung funktioniert nur, wenn das Programm als „APOLOGEA.exe“ neben dem Ordner „Quellcode“ liegt.");

                // 1. Alles laden und prüfen – bis hierhin wird nichts verändert
                string sha;
                Dictionary<string, object> man;
                var data = new Dictionary<string, byte[]>();
                using (var w = Client())
                {
                    man = FetchManifest(w, out sha);
                    if (!string.IsNullOrEmpty(expectedCommit) && expectedCommit != sha)
                        throw new UserError("Inzwischen gibt es einen neueren Stand. Bitte erneut „Nach Updates suchen“ wählen.", 409);
                    string ver0 = Json.Str(man, "version");
                    if (Compare(ver0, Program.Version) <= 0) throw new UserError("Das Programm ist bereits aktuell (" + Program.Version + ").");
                    var files = Json.Obj(man, "files");
                    if (files == null || files.Count == 0) throw new UserError("Die Update-Beschreibung enthält keine Dateien.");
                    if (!files.ContainsKey("bauen.cmd")) throw new UserError("Die Update-Beschreibung ist unvollständig (bauen.cmd fehlt).");
                    foreach (var kv in files)
                    {
                        CheckRel(kv.Key);
                        string want = (kv.Value as string ?? "").ToLowerInvariant();
                        byte[] b;
                        try { b = w.DownloadData(RawUrl(sha, kv.Key)); }
                        catch (WebException ex) { throw new UserError("Die Datei „" + kv.Key + "“ konnte nicht geladen werden (" + ex.Message + "). Es wurde nichts verändert."); }
                        if (Sha256(b) != want) throw new UserError("Die Datei „" + kv.Key + "“ stimmt nicht mit der Prüfsumme überein. Es wurde nichts verändert.");
                        data[kv.Key] = b;
                    }
                }
                string ver = Json.Str(man, "version");

                // 2. Bisherigen Quellcode und EXE sichern (die letzten 5 Sicherungen bleiben)
                string backupRoot = Path.Combine(Program.ExeDir, "Programm-Sicherung");
                string backup = Path.Combine(backupRoot, Program.Version + "_" + DateTime.Now.ToString("yyyy-MM-dd_HHmmss"));
                Directory.CreateDirectory(backup);
                if (Directory.Exists(SourceDir)) CopyDir(SourceDir, Path.Combine(backup, "Quellcode"));
                File.Copy(exe, Path.Combine(backup, "APOLOGEA.exe"));
                Prune(backupRoot, 5);

                // 3. Dateien ersetzen
                foreach (var kv in data)
                {
                    string t = Path.Combine(SourceDir, kv.Key.Replace('/', Path.DirectorySeparatorChar));
                    Directory.CreateDirectory(Path.GetDirectoryName(t));
                    string tmp = t + ".neu-" + Guid.NewGuid().ToString("N").Substring(0, 6);
                    File.WriteAllBytes(tmp, kv.Value);
                    if (File.Exists(t)) File.Delete(t);
                    File.Move(tmp, t);
                }

                // 4. Bauen: die laufende EXE darf unter Windows umbenannt werden – so kann bauen.cmd die neue ablegen
                string old = Path.Combine(Program.ExeDir, "APOLOGEA.alt.exe");
                try { if (File.Exists(old)) File.Delete(old); } catch { }
                File.Move(exe, old);
                DateTime started = DateTime.Now.AddSeconds(-2);
                string output;
                int code;
                try { code = RunBuild(out output); }
                catch (Exception ex) { code = -1; output = ex.Message; }
                bool built = code == 0 && File.Exists(exe) && File.GetLastWriteTime(exe) >= started;
                if (!built)
                {
                    try { if (File.Exists(exe)) File.Delete(exe); } catch { }
                    File.Move(old, exe);
                    try
                    {
                        string saved = Path.Combine(backup, "Quellcode");
                        if (Directory.Exists(saved)) { foreach (var kv in data) { string t = Path.Combine(SourceDir, kv.Key.Replace('/', Path.DirectorySeparatorChar)); string s = Path.Combine(saved, kv.Key.Replace('/', Path.DirectorySeparatorChar)); if (File.Exists(s)) File.Copy(s, t, true); else if (File.Exists(t)) File.Delete(t); } }
                    }
                    catch (Exception ex) { Util.Log("Quellcode konnte nicht vollständig zurückgesetzt werden: " + ex.Message); }
                    Util.Log("Update auf " + ver + " fehlgeschlagen (Bauen, Code " + code + "): " + output);
                    throw new UserError("Die neue Version konnte nicht gebaut werden. Die bisherige Version bleibt unverändert in Betrieb. Details stehen im Protokoll (Einstellungen → Protokoll öffnen).");
                }
                Util.Log("Aktualisiert von " + Program.Version + " auf " + ver + " (Commit " + sha.Substring(0, 7) + "), Sicherung: " + backup);
                Program.RestartSoon();
                var r = new Dictionary<string, object>();
                r["ok"] = true;
                r["version"] = ver;
                r["sicherung"] = backup;
                return r;
            }
            finally { lock (Gate) running = false; }
        }

        static int RunBuild(out string output)
        {
            string test = Environment.GetEnvironmentVariable("APOLOGEA_UPDATE_BUILD"); // nur für Tests: eigenes Bau-Kommando
            ProcessStartInfo psi;
            if (!string.IsNullOrEmpty(test))
            {
                int sp = test.IndexOf(' ');
                psi = new ProcessStartInfo(sp < 0 ? test : test.Substring(0, sp), sp < 0 ? "" : test.Substring(sp + 1));
            }
            else psi = new ProcessStartInfo("cmd.exe", "/c \"\"" + Path.Combine(SourceDir, "bauen.cmd") + "\" /still\"");
            psi.WorkingDirectory = SourceDir;
            psi.UseShellExecute = false;
            psi.CreateNoWindow = true;
            psi.RedirectStandardOutput = true;
            psi.RedirectStandardError = true;
            var sb = new StringBuilder();
            using (var p = new Process())
            {
                p.StartInfo = psi;
                p.OutputDataReceived += (s, e) => { if (e.Data != null) lock (sb) sb.AppendLine(e.Data); };
                p.ErrorDataReceived += (s, e) => { if (e.Data != null) lock (sb) sb.AppendLine(e.Data); };
                p.Start();
                p.BeginOutputReadLine();
                p.BeginErrorReadLine();
                if (!p.WaitForExit(240000)) { try { p.Kill(); } catch { } output = "Zeitüberschreitung beim Bauen."; return -1; }
                p.WaitForExit();
                lock (sb) output = sb.ToString();
                return p.ExitCode;
            }
        }

        static void CopyDir(string from, string to)
        {
            foreach (var f in Directory.GetFiles(from, "*", SearchOption.AllDirectories))
            {
                string rel = f.Substring(from.Length).TrimStart(Path.DirectorySeparatorChar);
                if (rel.StartsWith("build" + Path.DirectorySeparatorChar)) continue;
                string t = Path.Combine(to, rel);
                Directory.CreateDirectory(Path.GetDirectoryName(t));
                File.Copy(f, t, true);
            }
        }

        static void Prune(string root, int keep)
        {
            try
            {
                var dirs = new DirectoryInfo(root).GetDirectories().OrderByDescending(d => d.CreationTimeUtc).ToList();
                foreach (var d in dirs.Skip(keep)) { try { d.Delete(true); } catch { } }
            }
            catch { }
        }

        /// <summary>Beim Start: Reste einer früheren Aktualisierung entfernen</summary>
        public static void CleanupAfterStart()
        {
            try { string old = Path.Combine(Program.ExeDir, "APOLOGEA.alt.exe"); if (File.Exists(old)) File.Delete(old); } catch { }
        }
    }
}
