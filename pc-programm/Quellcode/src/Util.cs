// APOLOGEA Kollektionsverwaltung – allgemeine Hilfsfunktionen
using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Security.Cryptography;
using System.Text;
using System.Threading;

namespace Apologea
{
    /// <summary>Fehler mit einer verständlichen deutschen Meldung für die Oberfläche.</summary>
    public class UserError : Exception
    {
        public int Status;
        public UserError(string message) : base(message) { Status = 400; }
        public UserError(string message, int status) : base(message) { Status = status; }
    }

    public static class Util
    {
        public static readonly Encoding Utf8 = new UTF8Encoding(false);

        public static string Iso(DateTime d)
        {
            if (d.Kind == DateTimeKind.Unspecified) d = DateTime.SpecifyKind(d, DateTimeKind.Local);
            return d.ToLocalTime().ToString("yyyy-MM-dd'T'HH:mm:ssK", CultureInfo.InvariantCulture);
        }

        public static DateTime? ParseIso(string s)
        {
            if (string.IsNullOrEmpty(s)) return null;
            DateTime d;
            if (DateTime.TryParse(s, CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind, out d)) return d.ToLocalTime();
            return null;
        }

        public static long UnixMs(DateTime d)
        {
            return (long)(d.ToUniversalTime() - new DateTime(1970, 1, 1, 0, 0, 0, DateTimeKind.Utc)).TotalMilliseconds;
        }

        static readonly string[] Reserved = { "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9" };

        /// <summary>Wandelt Umlaute um (wie im Bestand: Guertel) und entfernt Akzente.</summary>
        public static string Transliterate(string s)
        {
            if (s == null) return "";
            var sb = new StringBuilder();
            foreach (char c in s)
            {
                switch (c)
                {
                    case 'ä': sb.Append("ae"); break;
                    case 'ö': sb.Append("oe"); break;
                    case 'ü': sb.Append("ue"); break;
                    case 'Ä': sb.Append("Ae"); break;
                    case 'Ö': sb.Append("Oe"); break;
                    case 'Ü': sb.Append("Ue"); break;
                    case 'ß': sb.Append("ss"); break;
                    default: sb.Append(c); break;
                }
            }
            string norm = sb.ToString().Normalize(NormalizationForm.FormD);
            var res = new StringBuilder();
            foreach (char c in norm)
            {
                if (CharUnicodeInfo.GetUnicodeCategory(c) != UnicodeCategory.NonSpacingMark) res.Append(c);
            }
            return res.ToString().Normalize(NormalizationForm.FormC);
        }

        /// <summary>Erzeugt einen Windows-kompatiblen Namensteil (für Ordner und Dateien).</summary>
        public static string SafeSegment(string s, int maxLen)
        {
            s = Transliterate((s ?? "").Trim());
            var sb = new StringBuilder();
            foreach (char c in s)
            {
                if (c < 32 || "<>:\"/\\|?*".IndexOf(c) >= 0) sb.Append('_');
                else if (char.IsWhiteSpace(c)) sb.Append('_');
                else if (c > 126) { if (char.IsLetterOrDigit(c)) sb.Append(c); else sb.Append('_'); }
                else sb.Append(c);
            }
            string r = sb.ToString();
            while (r.Contains("__")) r = r.Replace("__", "_");
            r = r.Trim('_', '.', ' ');
            if (r.Length > maxLen) r = r.Substring(0, maxLen).TrimEnd('_', '.', ' ');
            foreach (var res in Reserved)
                if (string.Equals(r, res, StringComparison.OrdinalIgnoreCase)) r = r + "_";
            return r;
        }

        public static string SafeFileName(string name)
        {
            string ext = Path.GetExtension(name ?? "");
            string stem = Path.GetFileNameWithoutExtension(name ?? "");
            var sb = new StringBuilder();
            foreach (char c in stem)
            {
                if (c < 32 || "<>:\"/\\|?*".IndexOf(c) >= 0) sb.Append('_');
                else sb.Append(c);
            }
            string s = sb.ToString().Trim().TrimEnd('.');
            if (s.Length == 0) s = "Datei";
            if (s.Length > 100) s = s.Substring(0, 100).Trim();
            foreach (var res in Reserved)
                if (string.Equals(s, res, StringComparison.OrdinalIgnoreCase)) s = s + "_";
            ext = SafeSegment(ext.TrimStart('.'), 12).ToLowerInvariant();
            return ext.Length > 0 ? s + "." + ext : s;
        }

        /// <summary>Liefert einen noch nicht vorhandenen Pfad (Name, Name (2), Name (3) …).</summary>
        public static string UniqueFilePath(string dir, string fileName, ICollection<string> alsoTaken)
        {
            string stem = Path.GetFileNameWithoutExtension(fileName);
            string ext = Path.GetExtension(fileName);
            string candidate = Path.Combine(dir, fileName);
            int i = 2;
            while (File.Exists(candidate) || Directory.Exists(candidate) || (alsoTaken != null && Contains(alsoTaken, candidate)))
            {
                candidate = Path.Combine(dir, stem + " (" + i + ")" + ext);
                i++;
            }
            return candidate;
        }

        static bool Contains(ICollection<string> set, string path)
        {
            foreach (var s in set) if (string.Equals(s, path, StringComparison.OrdinalIgnoreCase)) return true;
            return false;
        }

        public static string UniqueDirPath(string parent, string name)
        {
            string candidate = Path.Combine(parent, name);
            int i = 2;
            while (Directory.Exists(candidate) || File.Exists(candidate))
            {
                candidate = Path.Combine(parent, name + "_" + i);
                i++;
            }
            return candidate;
        }

        /// <summary>Schreibt eine Datei sicher: erst temporär, dann atomar ersetzen.</summary>
        public static void WriteAllTextAtomic(string path, string content)
        {
            string tmp = path + ".schreiben-" + Guid.NewGuid().ToString("N").Substring(0, 8);
            File.WriteAllText(tmp, content, Utf8);
            try
            {
                if (File.Exists(path))
                {
                    RetryIo(delegate { File.Replace(tmp, path, null, true); });
                }
                else
                {
                    RetryIo(delegate { File.Move(tmp, path); });
                }
            }
            catch
            {
                try { if (File.Exists(tmp)) File.Delete(tmp); } catch { }
                throw;
            }
        }

        /// <summary>Wiederholt kurze Dateioperationen, z. B. wenn OneDrive oder ein Virenscanner kurz sperrt.</summary>
        public static void RetryIo(Action a)
        {
            int attempts = 0;
            while (true)
            {
                try { a(); return; }
                catch (IOException)
                {
                    attempts++;
                    if (attempts >= 5) throw;
                    Thread.Sleep(120 * attempts);
                }
                catch (UnauthorizedAccessException)
                {
                    attempts++;
                    if (attempts >= 5) throw;
                    Thread.Sleep(120 * attempts);
                }
            }
        }

        /// <summary>Löscht einen Ordner samt Inhalt. Setzt Schreibschutz zurück (OneDrive markiert Ordner oft als schreibgeschützt) und wiederholt bei kurzen Sperren.</summary>
        public static void DeleteDirectory(string dir)
        {
            if (!Directory.Exists(dir)) return;
            foreach (var f in Directory.GetFiles(dir))
            {
                string file = f;
                RetryIo(delegate { File.SetAttributes(file, FileAttributes.Normal); File.Delete(file); });
            }
            foreach (var sub in Directory.GetDirectories(dir)) DeleteDirectory(sub);
            RetryIo(delegate
            {
                var di = new DirectoryInfo(dir);
                if ((di.Attributes & FileAttributes.ReadOnly) != 0) di.Attributes &= ~FileAttributes.ReadOnly;
                di.Delete(false);
            });
        }

        public static string ReadAllTextShared(string path)
        {
            using (var fs = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete))
            using (var sr = new StreamReader(fs, Utf8, true))
                return sr.ReadToEnd();
        }

        public static string Sha256File(string path)
        {
            using (var fs = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite, 1 << 16))
            using (var sha = SHA256.Create())
                return Hex(sha.ComputeHash(fs));
        }

        public static string Hex(byte[] b)
        {
            var sb = new StringBuilder(b.Length * 2);
            foreach (var x in b) sb.Append(x.ToString("x2"));
            return sb.ToString();
        }

        public static string Sha1(string s)
        {
            using (var sha = SHA1.Create()) return Hex(sha.ComputeHash(Utf8.GetBytes(s)));
        }

        public static string RandomToken()
        {
            var b = new byte[24];
            using (var rng = RandomNumberGenerator.Create()) rng.GetBytes(b);
            return Hex(b);
        }

        /// <summary>Erkennt das tatsächliche Dateiformat anhand der ersten Bytes.</summary>
        public static string DetectFormat(string path)
        {
            try
            {
                var head = new byte[16];
                int n;
                using (var fs = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite))
                    n = fs.Read(head, 0, head.Length);
                return DetectFormat(head, n);
            }
            catch { return null; }
        }

        public static string DetectFormat(byte[] h, int n)
        {
            if (n >= 8 && h[0] == 0x89 && h[1] == 0x50 && h[2] == 0x4E && h[3] == 0x47) return "png";
            if (n >= 3 && h[0] == 0xFF && h[1] == 0xD8 && h[2] == 0xFF) return "jpg";
            if (n >= 6 && h[0] == 'G' && h[1] == 'I' && h[2] == 'F') return "gif";
            if (n >= 12 && h[0] == 'R' && h[1] == 'I' && h[2] == 'F' && h[3] == 'F' && h[8] == 'W' && h[9] == 'E' && h[10] == 'B' && h[11] == 'P') return "webp";
            if (n >= 2 && h[0] == 'B' && h[1] == 'M') return "bmp";
            if (n >= 4 && ((h[0] == 'I' && h[1] == 'I' && h[2] == 42 && h[3] == 0) || (h[0] == 'M' && h[1] == 'M' && h[2] == 0 && h[3] == 42))) return "tif";
            if (n >= 4 && h[0] == '8' && h[1] == 'B' && h[2] == 'P' && h[3] == 'S') return "psd";
            if (n >= 4 && h[0] == '%' && h[1] == 'P' && h[2] == 'D' && h[3] == 'F') return "pdf";
            if (n >= 12 && h[4] == 'f' && h[5] == 't' && h[6] == 'y' && h[7] == 'p' && h[8] == 'a' && h[9] == 'v' && h[10] == 'i' && h[11] == 'f') return "avif";
            return null;
        }

        static readonly HashSet<string> ImageExts = new HashSet<string>(StringComparer.OrdinalIgnoreCase) { "png", "jpg", "jpeg", "gif", "webp", "bmp", "tif", "tiff", "svg", "avif", "psd" };

        public static bool IsImageExt(string ext)
        {
            return ImageExts.Contains((ext ?? "").TrimStart('.'));
        }

        /// <summary>Formate, aus denen das Programm selbst Vorschaubilder erzeugen kann.</summary>
        public static bool CanThumb(string ext)
        {
            ext = (ext ?? "").TrimStart('.').ToLowerInvariant();
            return ext == "png" || ext == "jpg" || ext == "jpeg" || ext == "gif" || ext == "bmp" || ext == "tif" || ext == "tiff";
        }

        /// <summary>Formate, die der Browser direkt anzeigen kann.</summary>
        public static bool BrowserCanShow(string ext)
        {
            ext = (ext ?? "").TrimStart('.').ToLowerInvariant();
            return ext == "png" || ext == "jpg" || ext == "jpeg" || ext == "gif" || ext == "webp" || ext == "bmp" || ext == "svg" || ext == "avif";
        }

        public static string MimeFor(string path)
        {
            string ext = Path.GetExtension(path).TrimStart('.').ToLowerInvariant();
            switch (ext)
            {
                case "html": case "htm": return "text/html; charset=utf-8";
                case "css": return "text/css; charset=utf-8";
                case "js": return "application/javascript; charset=utf-8";
                case "json": return "application/json; charset=utf-8";
                case "txt": return "text/plain; charset=utf-8";
                case "png": return "image/png";
                case "jpg": case "jpeg": return "image/jpeg";
                case "gif": return "image/gif";
                case "webp": return "image/webp";
                case "bmp": return "image/bmp";
                case "svg": return "image/svg+xml";
                case "avif": return "image/avif";
                case "ico": return "image/x-icon";
                case "pdf": return "application/pdf";
                case "woff2": return "font/woff2";
                default: return "application/octet-stream";
            }
        }

        public static string FormatBytes(long b)
        {
            if (b < 1024) return b + " Byte";
            if (b < 1024 * 1024) return (b / 1024.0).ToString("0.#", CultureInfo.GetCultureInfo("de-DE")) + " KB";
            if (b < 1024L * 1024 * 1024) return (b / 1024.0 / 1024.0).ToString("0.#", CultureInfo.GetCultureInfo("de-DE")) + " MB";
            return (b / 1024.0 / 1024.0 / 1024.0).ToString("0.##", CultureInfo.GetCultureInfo("de-DE")) + " GB";
        }

        public static string RelPath(string root, string full)
        {
            root = Path.GetFullPath(root).TrimEnd('\\') + "\\";
            full = Path.GetFullPath(full);
            if (full.StartsWith(root, StringComparison.OrdinalIgnoreCase)) return full.Substring(root.Length);
            return full;
        }

        /// <summary>Prüft, dass ein relativer Pfad innerhalb des Basisordners bleibt.</summary>
        public static string SafeCombine(string baseDir, string rel)
        {
            if (string.IsNullOrEmpty(rel)) throw new UserError("Ungültiger Dateipfad.");
            rel = rel.Replace('/', '\\');
            if (Path.IsPathRooted(rel) || rel.Contains("..")) throw new UserError("Ungültiger Dateipfad.");
            string full = Path.GetFullPath(Path.Combine(baseDir, rel));
            string b = Path.GetFullPath(baseDir).TrimEnd('\\') + "\\";
            if (!full.StartsWith(b, StringComparison.OrdinalIgnoreCase)) throw new UserError("Ungültiger Dateipfad.");
            return full;
        }

        public static string IoMessage(Exception ex)
        {
            if (ex is UserError) return ex.Message;
            if (ex is UnauthorizedAccessException)
                return "Zugriff verweigert. Wahrscheinlich ist eine Datei aus diesem Ordner gerade in einem anderen Programm geöffnet (z. B. Bildbearbeitung, Explorer-Vorschau oder OneDrive-Synchronisierung) oder schreibgeschützt. Bitte dort schließen und erneut versuchen.";
            if (ex is PathTooLongException)
                return "Der Dateipfad ist für Windows zu lang. Bitte einen kürzeren Namen oder einen kürzeren Sammlungsordner verwenden.";
            if (ex is DirectoryNotFoundException)
                return "Ein Ordner wurde nicht gefunden. Wurde er außerhalb des Programms verschoben? Bitte „Aktualisieren“ wählen.";
            if (ex is FileNotFoundException)
                return "Eine Datei wurde nicht gefunden. Wurde sie außerhalb des Programms verschoben? Bitte „Aktualisieren“ wählen.";
            if (ex is IOException)
            {
                long hr = System.Runtime.InteropServices.Marshal.GetHRForException(ex) & 0xFFFF;
                if (hr == 112 || hr == 39) return "Auf dem Datenträger ist nicht genügend Speicherplatz frei.";
                if (hr == 32 || hr == 33) return "Eine Datei oder ein Ordner wird gerade von einem anderen Programm verwendet (z. B. Explorer, Bildbearbeitung oder OneDrive-Synchronisierung). Bitte dort schließen und erneut versuchen.";
                if (hr == 5) return "Zugriff verweigert. Wahrscheinlich ist eine Datei aus diesem Ordner gerade in einem anderen Programm geöffnet (z. B. Bildbearbeitung, Explorer-Vorschau oder OneDrive-Synchronisierung). Bitte dort schließen und erneut versuchen.";
                return "Dateifehler: " + ex.Message;
            }
            return "Unerwarteter Fehler: " + ex.Message;
        }

        // ---- Protokoll ----
        static readonly object LogLock = new object();
        public static string LogPath;

        public static void Log(string msg)
        {
            try
            {
                if (LogPath == null) return;
                lock (LogLock)
                {
                    var fi = new FileInfo(LogPath);
                    if (fi.Exists && fi.Length > 2 * 1024 * 1024)
                    {
                        string old = LogPath + ".alt";
                        if (File.Exists(old)) File.Delete(old);
                        File.Move(LogPath, old);
                    }
                    File.AppendAllText(LogPath, DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss") + "  " + msg + Environment.NewLine, Utf8);
                }
            }
            catch { }
        }
    }
}
