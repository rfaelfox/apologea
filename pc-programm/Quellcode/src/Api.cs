// APOLOGEA Kollektionsverwaltung – Schnittstelle zwischen Oberfläche und Dateisystem
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Reflection;

namespace Apologea
{
    public class Api
    {
        public Collection Col;
        public string StartupError;
        public volatile bool Busy;
        readonly Settings settings;
        readonly bool collectionFromArgs;

        public Api(Settings s, bool fromArgs)
        {
            settings = s;
            collectionFromArgs = fromArgs;
        }

        public void OpenCollection(string path, bool remember)
        {
            var c = new Collection(path);
            c.Scan();
            Col = c;
            StartupError = null;
            if (remember && !collectionFromArgs)
            {
                settings.Sammlung = c.Root;
                settings.Save();
            }
            Thumbs.PrewarmAsync(delegate
            {
                var files = new List<string>();
                foreach (var p in c.All())
                    foreach (var r in new[] { "mockup", "design", "kleidungsansicht" })
                    {
                        string rel;
                        if (p.Bilder.TryGetValue(r, out rel) && rel != null) files.Add(Path.Combine(p.Dir, rel));
                    }
                return files;
            });
        }

        Collection NeedCol()
        {
            if (Col == null) throw new UserError("Es ist noch kein Sammlungsordner ausgewählt. Bitte unter „Einstellungen“ einen Ordner wählen.");
            return Col;
        }

        static Dictionary<string, object> Body(Request r)
        {
            string t = r.ReadBodyText();
            if (string.IsNullOrWhiteSpace(t)) return new Dictionary<string, object>();
            return Json.ParseObject(t);
        }

        static Dictionary<string, object> Ok(string key, object val)
        {
            var d = new Dictionary<string, object>();
            d["ok"] = true;
            if (key != null) d[key] = val;
            return d;
        }

        // ------------------------------------------------------------ Routing

        public Response Handle(Request r)
        {
            string host = r.Header("Host") ?? "";
            if (host != "127.0.0.1:" + Program.Server.Port && host != "localhost:" + Program.Server.Port)
                return Response.Text("Ungültiger Zugriff.", 403, "text/plain; charset=utf-8");

            if (r.Path == "/" && r.Q("t") != null)
            {
                if (r.Q("t") != Program.Token) return Forbidden();
                var resp = Response.Text("", 302, "text/plain");
                resp.Headers["Set-Cookie"] = "apologea=" + Program.Token + "; Path=/; HttpOnly; SameSite=Strict";
                resp.Headers["Location"] = "/";
                return resp;
            }
            if (r.Cookie("apologea") != Program.Token) return Forbidden();

            if (r.Method == "GET" && !r.Path.StartsWith("/api/") && r.Path != "/datei" && r.Path != "/vorschau" && r.Path != "/logo")
                return Static(r.Path);

            // Schutz gegen fremde Webseiten: nur Anfragen der eigenen Oberfläche (eigener Kopf erzwingt CORS-Prüfung)
            if (r.Path.StartsWith("/api/") && r.Header("X-Apologea") != "1") return Forbidden();

            switch (r.Path)
            {
                case "/datei": return FileResponse(r, false);
                case "/vorschau": return FileResponse(r, true);
                case "/logo": return LogoResponse();
                case "/api/ping": Program.LastPing = DateTime.Now; return Response.Json(Ok(null, null));
                case "/api/status": return Response.Json(Status());
                case "/api/sammlung": return Response.Json(NeedCol().OverviewApi());
                case "/api/aktualisieren":
                    {
                        var ch = NeedCol().Scan();
                        var d = Ok("aenderungen", ch);
                        d["sammlung"] = Col.OverviewApi();
                        return Response.Json(d);
                    }
                case "/api/piece": return Response.Json(PieceDetail(NeedCol().Get(r.Q("id"))));
                case "/api/ordner-vorschau": return Response.Json(NeedCol().PreviewFolder(Body(r)));
                case "/api/upload":
                    {
                        string name = Uri.UnescapeDataString(r.Header("X-Dateiname") ?? "Datei");
                        return Response.Json(NeedCol().SaveUpload(r.Body, r.ContentLength, name));
                    }
                case "/api/speichern":
                    {
                        var p = NeedCol().Save(Body(r));
                        return Response.Json(Ok("piece", PieceDetail(p)));
                    }
                case "/api/zuordnen":
                    {
                        var b = Body(r);
                        var p = NeedCol().AssignFile(Json.Str(b, "id"), Json.Str(b, "datei"), Json.Str(b, "rolle"));
                        return Response.Json(Ok("piece", PieceDetail(p)));
                    }
                case "/api/zielgruppe":
                    {
                        var b = Body(r);
                        int n = NeedCol().SetZielgruppe(Json.StrList(b, "ids"), Json.Str(b, "zielgruppe"));
                        return Response.Json(Ok("anzahl", n));
                    }
                case "/api/ordner-uebernehmen":
                    {
                        var p = NeedCol().AdoptFolder(Json.Str(Body(r), "ordner"));
                        return Response.Json(Ok("piece", PieceDetail(p)));
                    }
                case "/api/pdf-speichern": return Response.Json(SavePdf(r));
                case "/api/update/pruefen": return Response.Json(Updater.Check());
                case "/api/update/installieren": return Response.Json(Updater.Install(Json.Str(Body(r), "commit")));
                case "/api/kollektionen": return Response.Json(Kollektionen.Load(NeedCol()));
                case "/api/kollektionen/speichern": return Response.Json(Kollektionen.Save(NeedCol(), Body(r)));
                case "/api/kategorie/neu": return Response.Json(Ok("name", NeedCol().CreateCategory(Json.Str(Body(r), "name"))));
                case "/api/kategorie/entfernen": NeedCol().DeleteCategory(Json.Str(Body(r), "name")); return Response.Json(Ok(null, null));
                case "/api/papierkorb": return Response.Json(Ok("eintraege", NeedCol().ListTrash()));
                case "/api/papierkorb/verschieben": NeedCol().TrashPiece(Json.Str(Body(r), "id")); return Response.Json(Ok(null, null));
                case "/api/papierkorb/wiederherstellen":
                    {
                        var p = NeedCol().RestorePiece(Json.Str(Body(r), "eintrag"));
                        var d = Ok("piece", PieceDetail(p));
                        object note;
                        d["hinweis"] = p.Extra.TryGetValue("_hinweis", out note) ? note : "";
                        p.Extra.Remove("_hinweis");
                        return Response.Json(d);
                    }
                case "/api/papierkorb/loeschen":
                    {
                        var b = Body(r);
                        NeedCol().DeleteTrashForever(Json.Str(b, "art"), Json.Str(b, "eintrag"));
                        return Response.Json(Ok(null, null));
                    }
                case "/api/os/ordner": return Response.Json(OsOpenFolder(Body(r)));
                case "/api/os/oeffnen": return Response.Json(OsOpen(Body(r)));
                case "/api/os/anzeigen": return Response.Json(OsReveal(Body(r)));
                case "/api/os/pfad-kopieren": return Response.Json(OsCopyPath(Body(r)));
                case "/api/os/exportieren": return Response.Json(OsExport(Body(r)));
                case "/api/os/ordner-exportieren": return Response.Json(OsExportFolder(Body(r)));
                case "/api/sicherung/start": return Response.Json(BackupStart(Body(r)));
                case "/api/sicherung/anzeigen":
                    if (Backup.Current == null || Backup.Current.Result == null || !File.Exists(Backup.Current.Result))
                        throw new UserError("Die Sicherungsdatei wurde nicht gefunden.");
                    Process.Start("explorer.exe", "/select,\"" + Backup.Current.Result + "\"");
                    return Response.Json(Ok(null, null));
                case "/api/sicherung/status": return Response.Json(Backup.Current == null ? Ok("job", null) : Ok("job", Backup.Current.ToApi()));
                case "/api/html-export":
                    {
                        string path = HtmlExport.WriteToCollection(NeedCol());
                        return Response.Json(Ok("pfad", Util.RelPath(Col.Root, path)));
                    }
                case "/api/einstellungen/sammlung-waehlen": return Response.Json(ChooseCollection());
                case "/api/einstellungen/neue-sammlung": return Response.Json(NewCollection());
                case "/api/einstellungen/import": return Response.Json(ImportLegacy());
                case "/api/einstellungen/logo": return Response.Json(ChooseLogo());
                case "/api/einstellungen/logo-entfernen": RemoveLogo(); return Response.Json(Ok(null, null));
                case "/api/einstellungen/cache-leeren": Thumbs.ClearCache(); return Response.Json(Ok(null, null));
                case "/api/protokoll-oeffnen":
                    if (File.Exists(Util.LogPath)) Process.Start(new ProcessStartInfo(Util.LogPath) { UseShellExecute = true });
                    return Response.Json(Ok(null, null));
            }
            return Response.Error("Unbekannte Anfrage: " + r.Path, 404);
        }

        static Response Forbidden()
        {
            return Response.Text("<!doctype html><meta charset=utf-8><title>APOLOGEA</title><body style=\"background:#0e0d0c;color:#ece4d3;font:16px Segoe UI;padding:40px\"><h2 style=\"color:#b8955a;font-family:Palatino Linotype,Georgia,serif;letter-spacing:.2em\">APOLOGEA</h2><p>Diese Sitzung ist abgelaufen oder ungültig. Bitte das Programm über <b>APOLOGEA.exe</b> bzw. das Symbol im Infobereich öffnen.</p></body>", 403, "text/html; charset=utf-8");
        }

        // ------------------------------------------------------------ Oberflächen-Dateien

        Response Static(string path)
        {
            if (path == "/") path = "/index.html";
            string name = path.TrimStart('/');
            if (name.Contains("..") || name.Contains("/") || name.Contains("\\")) return Response.Error("Nicht gefunden", 404);
            string devDir = Environment.GetEnvironmentVariable("APOLOGEA_UI_DIR");
            byte[] data = null;
            if (!string.IsNullOrEmpty(devDir) && File.Exists(Path.Combine(devDir, name))) data = File.ReadAllBytes(Path.Combine(devDir, name));
            else
            {
                using (var s = Assembly.GetExecutingAssembly().GetManifestResourceStream("ui." + name))
                {
                    if (s == null) return Response.Error("Nicht gefunden", 404);
                    var ms = new MemoryStream();
                    s.CopyTo(ms);
                    data = ms.ToArray();
                }
            }
            var r = new Response();
            r.Bytes = data;
            r.ContentType = Util.MimeFor(name);
            r.Headers["Cache-Control"] = "no-cache";
            if (name == "index.html")
                r.Headers["Content-Security-Policy"] = "default-src 'self'; img-src 'self' blob: data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; object-src 'none'; frame-ancestors 'none'";
            return r;
        }

        Response FileResponse(Request r, bool thumb)
        {
            var col = NeedCol();
            string rel = r.Q("p");
            string full = Util.SafeCombine(col.Root, rel);
            if (!File.Exists(full)) return Response.Error("Datei nicht gefunden: " + rel, 404);
            string ext = Path.GetExtension(full).TrimStart('.').ToLowerInvariant();
            Response resp;
            if (thumb)
            {
                int w;
                if (!int.TryParse(r.Q("w") ?? "480", out w)) w = 480;
                w = Math.Max(64, Math.Min(2400, w));
                string fmt = Util.DetectFormat(full) ?? ext;
                if (Util.CanThumb(fmt))
                {
                    string t = null;
                    try { t = Thumbs.Get(full, w); }
                    catch (Exception ex) { Util.Log("Vorschau nicht möglich für " + rel + ": " + ex.Message); }
                    if (t != null) resp = Response.File(t, Util.MimeFor(t));
                    else return Response.Error("Für diese Datei kann keine Vorschau erzeugt werden (Datei beschädigt?).", 415);
                }
                else if (Util.BrowserCanShow(fmt)) resp = Response.File(full, Util.MimeFor("x." + fmt));
                else return Response.Error("Keine Vorschau für dieses Format.", 415);
            }
            else
            {
                string fmt = Util.DetectFormat(full);
                resp = Response.File(full, fmt != null ? Util.MimeFor("x." + fmt) : Util.MimeFor(full));
                if (r.Q("download") == "1")
                    resp.Headers["Content-Disposition"] = "attachment; filename*=UTF-8''" + Uri.EscapeDataString(Path.GetFileName(full));
            }
            if (r.Q("v") != null) resp.Headers["Cache-Control"] = "private, max-age=31536000, immutable";
            else resp.Headers["Cache-Control"] = "no-cache";
            return resp;
        }

        string LogoPath()
        {
            if (Col == null) return null;
            foreach (var f in Directory.GetFiles(Col.MetaDir, "logo.*")) return f;
            return null;
        }

        Response LogoResponse()
        {
            string l = LogoPath();
            if (l == null) return Response.Error("Kein Logo", 404);
            var resp = Response.File(l, Util.MimeFor(l));
            resp.Headers["Cache-Control"] = "no-cache";
            return resp;
        }

        // ------------------------------------------------------------ Status & Details

        Dictionary<string, object> Status()
        {
            var d = new Dictionary<string, object>();
            d["version"] = Program.Version;
            d["sammlung"] = Col == null ? null : Col.Root;
            d["startfehler"] = StartupError;
            d["eingestellteSammlung"] = settings.Sammlung;
            d["programmOrdner"] = Program.ExeDir;
            d["datenOrdner"] = Program.LocalDir;
            d["logo"] = LogoPath() != null;
            d["sicherungLaeuft"] = Backup.Current != null && Backup.Current.Running;
            d["edge"] = Program.FindEdge() != null;
            return d;
        }

        Dictionary<string, object> PieceDetail(Piece p)
        {
            var d = Col.PieceApi(p);
            var b = (Dictionary<string, object>)d["bilder"];
            foreach (var kv in b)
            {
                var f = kv.Value as Dictionary<string, object>;
                if (f == null || !(bool)f["vorhanden"]) continue;
                var dim = Thumbs.Dimensions(Path.Combine(p.Dir, ((string)f["datei"]).Replace('/', '\\')));
                if (dim != null) { f["breite"] = dim[0]; f["hoehe"] = dim[1]; }
                f["format"] = Util.DetectFormat(Path.Combine(p.Dir, ((string)f["datei"]).Replace('/', '\\')));
            }
            if (!string.IsNullOrEmpty(p.VorlageVon))
            {
                var tpl = Col.All().FirstOrDefault(x => x.Id == p.VorlageVon);
                d["vorlageTitel"] = tpl == null ? "(nicht mehr vorhanden)" : tpl.Titel;
            }
            return d;
        }

        // ------------------------------------------------------------ Explorer & Dateien

        string PathFromBody(Dictionary<string, object> b)
        {
            var col = NeedCol();
            string id = Json.Str(b, "id");
            string pfad = Json.Str(b, "pfad");
            if (!string.IsNullOrEmpty(id) && string.IsNullOrEmpty(pfad)) return col.Get(id).Dir;
            if (string.IsNullOrEmpty(pfad)) throw new UserError("Kein Pfad angegeben.");
            if (Path.IsPathRooted(pfad))
            {
                string full = Path.GetFullPath(pfad);
                if (!full.StartsWith(col.Root + "\\", StringComparison.OrdinalIgnoreCase) && !string.Equals(full, col.Root, StringComparison.OrdinalIgnoreCase))
                    throw new UserError("Der Pfad liegt außerhalb des Sammlungsordners.");
                return full;
            }
            return Util.SafeCombine(col.Root, pfad);
        }

        static void EnsureExists(string full)
        {
            if (!File.Exists(full) && !Directory.Exists(full))
                throw new UserError("„" + Path.GetFileName(full) + "“ wurde nicht gefunden. Möglicherweise wurde die Datei verschoben oder gelöscht. Bitte „Aktualisieren“ wählen.", 404);
        }

        Dictionary<string, object> OsOpenFolder(Dictionary<string, object> b)
        {
            string full = PathFromBody(b);
            if (File.Exists(full)) full = Path.GetDirectoryName(full);
            EnsureExists(full);
            Process.Start("explorer.exe", "\"" + full + "\"");
            return Ok("pfad", full);
        }

        Dictionary<string, object> OsOpen(Dictionary<string, object> b)
        {
            string full = PathFromBody(b);
            EnsureExists(full);
            try { Process.Start(new ProcessStartInfo(full) { UseShellExecute = true }); }
            catch (System.ComponentModel.Win32Exception)
            {
                // Kein Programm zugeordnet: Windows-Dialog „Öffnen mit“ anzeigen
                Process.Start("rundll32.exe", "shell32.dll,OpenAs_RunDLL " + full);
            }
            return Ok("pfad", full);
        }

        Dictionary<string, object> OsReveal(Dictionary<string, object> b)
        {
            string full = PathFromBody(b);
            EnsureExists(full);
            Process.Start("explorer.exe", "/select,\"" + full + "\"");
            return Ok("pfad", full);
        }

        Dictionary<string, object> OsCopyPath(Dictionary<string, object> b)
        {
            string full = PathFromBody(b);
            if (!Program.Host.SetClipboard(full)) throw new UserError("Die Zwischenablage ist gerade belegt. Bitte erneut versuchen.");
            return Ok("pfad", full);
        }

        string lastExportDir;

        Dictionary<string, object> OsExport(Dictionary<string, object> b)
        {
            string full = PathFromBody(b);
            EnsureExists(full);
            string suggested = Path.GetFileName(full);
            string id = Json.Str(b, "id");
            if (!string.IsNullOrEmpty(id))
            {
                var p = Col.Get(id);
                suggested = Piece.FolderNameFor(p.Nummer, p.Name, "") + "_" + Path.GetFileName(full);
            }
            string ext = Path.GetExtension(full);
            string target = Program.Host.SaveFile("Datei exportieren – Speicherort wählen", lastExportDir ?? Environment.GetFolderPath(Environment.SpecialFolder.Desktop), suggested,
                (ext.Length > 0 ? ext.TrimStart('.').ToUpperInvariant() + "-Datei (*" + ext + ")|*" + ext + "|" : "") + "Alle Dateien (*.*)|*.*");
            if (target == null) return Ok("abgebrochen", true);
            if (string.Equals(Path.GetFullPath(target), full, StringComparison.OrdinalIgnoreCase)) throw new UserError("Ziel und Original sind identisch.");
            string tmp = target + ".kopie-" + Guid.NewGuid().ToString("N").Substring(0, 6);
            File.Copy(full, tmp, false);
            if (File.Exists(target)) File.Delete(target);
            File.Move(tmp, target);
            lastExportDir = Path.GetDirectoryName(target);
            return Ok("ziel", target);
        }

        /// <summary>Katalog-PDF aus der Oberfläche über „Speichern unter“ ablegen (optional danach öffnen).</summary>
        Dictionary<string, object> SavePdf(Request r)
        {
            if (r.ContentLength <= 0 || r.ContentLength > 200L * 1024 * 1024) throw new UserError("Die PDF-Datei ist leer oder zu groß.");
            var ms = new MemoryStream();
            var buf = new byte[1 << 16];
            long total = 0;
            while (total < r.ContentLength)
            {
                int n = r.Body.Read(buf, 0, (int)Math.Min(buf.Length, r.ContentLength - total));
                if (n <= 0) break;
                ms.Write(buf, 0, n);
                total += n;
            }
            if (total != r.ContentLength) throw new UserError("Die PDF-Datei wurde nicht vollständig übertragen. Bitte erneut versuchen.");
            byte[] data = ms.ToArray();
            if (data.Length < 5 || data[0] != '%' || data[1] != 'P' || data[2] != 'D' || data[3] != 'F') throw new UserError("Das ist keine PDF-Datei.");
            string name = Uri.UnescapeDataString(r.Header("X-Dateiname") ?? "APOLOGEA_Katalog.pdf");
            foreach (char c in Path.GetInvalidFileNameChars()) name = name.Replace(c, '_');
            if (!name.EndsWith(".pdf", StringComparison.OrdinalIgnoreCase)) name += ".pdf";
            string target = Program.Host.SaveFile("Katalog speichern – Speicherort wählen", lastExportDir ?? Environment.GetFolderPath(Environment.SpecialFolder.Desktop), name, "PDF-Datei (*.pdf)|*.pdf");
            if (target == null) return Ok("abgebrochen", true);
            string tmp = target + ".schreiben-" + Guid.NewGuid().ToString("N").Substring(0, 6);
            File.WriteAllBytes(tmp, data);
            if (File.Exists(target)) File.Delete(target);
            File.Move(tmp, target);
            lastExportDir = Path.GetDirectoryName(target);
            if (r.Q("oeffnen") == "1")
            {
                try { Process.Start(new ProcessStartInfo(target) { UseShellExecute = true }); }
                catch (Exception ex) { Util.Log("PDF konnte nicht geöffnet werden: " + ex.Message); }
            }
            return Ok("ziel", target);
        }

        Dictionary<string, object> OsExportFolder(Dictionary<string, object> b)
        {
            var p = NeedCol().Get(Json.Str(b, "id"));
            string dest = Program.Host.PickFolder("Produktordner exportieren – Zielordner wählen", lastExportDir ?? Environment.GetFolderPath(Environment.SpecialFolder.Desktop));
            if (dest == null) return Ok("abgebrochen", true);
            string full = Path.GetFullPath(dest);
            if (full.StartsWith(Col.Root + "\\", StringComparison.OrdinalIgnoreCase) || string.Equals(full, Col.Root, StringComparison.OrdinalIgnoreCase))
                throw new UserError("Bitte einen Ordner außerhalb der Sammlung wählen.");
            string target = Util.UniqueDirPath(full, Path.GetFileName(p.Dir));
            foreach (var f in Directory.GetFiles(p.Dir, "*", SearchOption.AllDirectories))
            {
                string rel = Util.RelPath(p.Dir, f);
                string t = Path.Combine(target, rel);
                Directory.CreateDirectory(Path.GetDirectoryName(t));
                File.Copy(f, t, false);
            }
            lastExportDir = full;
            return Ok("ziel", target);
        }

        // ------------------------------------------------------------ Sicherung

        Dictionary<string, object> BackupStart(Dictionary<string, object> b)
        {
            var col = NeedCol();
            if (Backup.Current != null && Backup.Current.Running) throw new UserError("Es läuft bereits eine Sicherung.");
            string name = "APOLOGEA_Sicherung_" + DateTime.Now.ToString("yyyy-MM-dd_HHmm") + ".zip";
            string initial = Path.GetDirectoryName(col.Root);
            string target = Program.Host.SaveFile("Vollständige ZIP-Sicherung – Speicherort wählen", initial, name, "ZIP-Archiv (*.zip)|*.zip");
            if (target == null) return Ok("abgebrochen", true);
            if (!target.EndsWith(".zip", StringComparison.OrdinalIgnoreCase)) target += ".zip";
            var job = Backup.Start(col, target, Json.Bool(b, "papierkorb"), !b.ContainsKey("pruefen") || Json.Bool(b, "pruefen"), Program.ExeDir);
            return Ok("job", job.ToApi());
        }

        // ------------------------------------------------------------ Einstellungen

        Dictionary<string, object> ChooseCollection()
        {
            string dir = Program.Host.PickFolder("Sammlungsordner auswählen", Col != null ? Path.GetDirectoryName(Col.Root) : Program.ExeDir);
            if (dir == null) return Ok("abgebrochen", true);
            if (string.Equals(Path.GetFullPath(dir).TrimEnd('\\'), Path.GetFullPath(Program.ExeDir).TrimEnd('\\'), StringComparison.OrdinalIgnoreCase))
                throw new UserError("Bitte nicht den Programmordner selbst, sondern den Ordner „Sammlung“ darin auswählen.");
            OpenCollection(dir, true);
            return Ok("status", Status());
        }

        static readonly string[] DefaultCategories = { "Hoodies", "T-Shirts", "Polos", "Sweatshirts", "Hosen", "Jacken" };

        Dictionary<string, object> NewCollection()
        {
            string dir = Program.Host.PickFolder("Ort für die neue Sammlung wählen (ein Ordner „APOLOGEA_Sammlung“ wird darin angelegt)", Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments));
            if (dir == null) return Ok("abgebrochen", true);
            string target = Util.UniqueDirPath(dir, "APOLOGEA_Sammlung");
            Directory.CreateDirectory(target);
            foreach (var c in DefaultCategories) Directory.CreateDirectory(Path.Combine(target, c));
            OpenCollection(target, true);
            return Ok("status", Status());
        }

        Dictionary<string, object> ImportLegacy()
        {
            var col = NeedCol();
            string src = Program.Host.PickFolder("Altbestand importieren – Ordner mit den bisherigen Pieces wählen (z. B. „APOLOGEA_Pieces“)", null);
            if (src == null) return Ok("abgebrochen", true);
            Busy = true;
            try { return Ok("ergebnis", col.ImportLegacy(src, null)); }
            finally { Busy = false; }
        }

        Dictionary<string, object> ChooseLogo()
        {
            var col = NeedCol();
            string f = Program.Host.OpenFile("APOLOGEA-Logo auswählen", "Bilder (*.png;*.svg;*.jpg;*.webp)|*.png;*.svg;*.jpg;*.jpeg;*.webp");
            if (f == null) return Ok("abgebrochen", true);
            string ext = Path.GetExtension(f).ToLowerInvariant();
            if (ext == ".jpeg") ext = ".jpg";
            string tmp = Path.Combine(col.MetaDir, "logo-neu" + ext);
            File.Copy(f, tmp, true);
            RemoveLogo();
            File.Move(tmp, Path.Combine(col.MetaDir, "logo" + ext));
            return Ok(null, null);
        }

        void RemoveLogo()
        {
            var col = NeedCol();
            foreach (var l in Directory.GetFiles(col.MetaDir, "logo.*")) File.Delete(l);
        }
    }
}
