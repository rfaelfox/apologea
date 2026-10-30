// APOLOGEA Kollektionsverwaltung – Programmstart, Fenster (Edge-App-Modus), Infobereich-Symbol
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Linq;
using System.Threading;
using System.Windows.Forms;

[assembly: System.Runtime.Versioning.TargetFramework(".NETFramework,Version=v4.8", FrameworkDisplayName = ".NET Framework 4.8")]
[assembly: System.Reflection.AssemblyTitle("APOLOGEA Kollektionsverwaltung")]
[assembly: System.Reflection.AssemblyProduct("APOLOGEA")]
[assembly: System.Reflection.AssemblyDescription("Kollektionsverwaltung für APOLOGEA")]
[assembly: System.Reflection.AssemblyVersion("1.3.0.0")]
[assembly: System.Reflection.AssemblyFileVersion("1.3.0.0")]

namespace Apologea
{
    public class Settings
    {
        public static string Dir { get { return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "APOLOGEA"); } }
        static string FilePath { get { return Path.Combine(Dir, "einstellungen.json"); } }

        public string Sammlung;

        public static Settings Load()
        {
            var s = new Settings();
            try
            {
                if (File.Exists(FilePath))
                {
                    var d = Json.ParseObject(File.ReadAllText(FilePath, Util.Utf8));
                    s.Sammlung = Json.Str(d, "sammlung");
                }
            }
            catch (Exception ex) { Util.Log("Einstellungen nicht lesbar: " + ex.Message); }
            return s;
        }

        public void Save()
        {
            Directory.CreateDirectory(Dir);
            var d = new Dictionary<string, object>();
            d["sammlung"] = Sammlung;
            Util.WriteAllTextAtomic(FilePath, Json.Write(d, true));
        }
    }

    public static class Program
    {
        public const string Version = "1.4.0";
        public static string ExeDir;
        public static string LocalDir;
        public static HostForm Host;
        public static HttpServer Server;
        public static Api ApiInstance;
        public static string Token;
        static Process edge;
        static DateTime edgeStarted;
        public static DateTime LastPing = DateTime.Now;
        static NotifyIcon tray;
        static bool headless;
        public static string InstanceDir;
        static volatile bool restartAfterExit;

        /// <summary>Nach einer Aktualisierung: Fenster schließen, beenden und die neue Version starten</summary>
        public static void RestartSoon()
        {
            restartAfterExit = true;
            var t = new System.Threading.Timer(delegate
            {
                try
                {
                    Host.BeginInvoke((MethodInvoker)delegate
                    {
                        try { if (edge != null && !edge.HasExited) edge.CloseMainWindow(); } catch { }
                        Application.ExitThread();
                    });
                }
                catch (Exception ex) { Util.Log("Neustart nicht möglich: " + ex.Message); }
            }, null, 1500, System.Threading.Timeout.Infinite);
            RestartTimer = t;
        }
        public static System.Threading.Timer RestartTimer; // hält den Zeitgeber bis zum Auslösen am Leben

        [STAThread]
        public static int Main(string[] args)
        {
            ExeDir = Path.GetDirectoryName(System.Reflection.Assembly.GetExecutingAssembly().Location);
            LocalDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "APOLOGEA");
            Directory.CreateDirectory(LocalDir);
            Util.LogPath = Path.Combine(LocalDir, "protokoll.txt");
            Thumbs.CacheDir = Path.Combine(LocalDir, "Vorschau");

            var opts = ParseArgs(args);
            if (opts.ContainsKey("import")) return CliImport(opts);
            headless = opts.ContainsKey("ohne-fenster");

            bool created;
            string instanceDir = opts.ContainsKey("instanz") ? Path.Combine(LocalDir, "instanz-" + opts["instanz"]) : LocalDir;
            Directory.CreateDirectory(instanceDir);
            InstanceDir = instanceDir;
            using (var mutex = new Mutex(true, "APOLOGEA_Kollektion_" + Util.Sha1(instanceDir).Substring(0, 12), out created))
            {
                string runFile = Path.Combine(instanceDir, "laufend.json");
                if (!created)
                {
                    // Programm läuft bereits: nur ein weiteres Fenster öffnen
                    try
                    {
                        var d = Json.ParseObject(File.ReadAllText(runFile, Util.Utf8));
                        OpenWindow((int)Json.Int(d, "port"), Json.Str(d, "token"), instanceDir);
                    }
                    catch
                    {
                        MessageBox.Show("APOLOGEA läuft bereits, das Fenster konnte aber nicht geöffnet werden. Bitte das Programm über das Symbol im Infobereich (unten rechts) beenden und neu starten.", "APOLOGEA", MessageBoxButtons.OK, MessageBoxIcon.Information);
                    }
                    return 0;
                }

                Application.EnableVisualStyles();
                Application.SetCompatibleTextRenderingDefault(false);
                Application.ThreadException += delegate (object s, ThreadExceptionEventArgs e) { Util.Log("UI-Fehler: " + e.Exception); };

                var settings = Settings.Load();
                string sammlung = opts.ContainsKey("sammlung") ? opts["sammlung"] : settings.Sammlung;
                if (string.IsNullOrEmpty(sammlung) || !Directory.Exists(sammlung))
                {
                    // Erster Start: Ordner "Sammlung" neben dem Programm verwenden, falls vorhanden
                    string neighbour = Path.Combine(ExeDir, "Sammlung");
                    if (Directory.Exists(neighbour)) sammlung = neighbour;
                    else if ((sammlung = FindCollection()) != null) { }
                    else if (!string.IsNullOrEmpty(settings.Sammlung)) Util.Log("Eingestellter Sammlungsordner fehlt: " + settings.Sammlung);
                    if (sammlung != null && Directory.Exists(sammlung) && !opts.ContainsKey("sammlung"))
                    {
                        settings.Sammlung = sammlung;
                        try { settings.Save(); } catch { }
                    }
                }

                Host = new HostForm();
                var unused = Host.Handle;
                Token = Util.RandomToken();
                ApiInstance = new Api(settings, opts.ContainsKey("sammlung"));
                if (sammlung != null && Directory.Exists(sammlung))
                {
                    try { ApiInstance.OpenCollection(sammlung, false); }
                    catch (Exception ex) { Util.Log("Sammlung konnte nicht geöffnet werden: " + ex); ApiInstance.StartupError = Util.IoMessage(ex); }
                }

                Server = new HttpServer();
                Server.Handler = ApiInstance.Handle;
                int port = 47821;
                if (opts.ContainsKey("port")) int.TryParse(opts["port"], out port);
                Server.Start(port);
                var run = new Dictionary<string, object>();
                run["port"] = Server.Port;
                run["token"] = Token;
                run["pid"] = Process.GetCurrentProcess().Id;
                Util.WriteAllTextAtomic(runFile, Json.Write(run, true));
                Updater.CleanupAfterStart();
                Util.Log("Gestartet (Version " + Version + ") auf Port " + Server.Port + ", Sammlung: " + (sammlung ?? "–"));

                if (!headless)
                {
                    SetupTray();
                    OpenWindow(Server.Port, Token, instanceDir);
                }
                var timer = new System.Windows.Forms.Timer();
                timer.Interval = 3000;
                timer.Tick += delegate { CheckAlive(); };
                timer.Start();
                Application.Run(new ApplicationContext());
                Server.Stop();
                if (tray != null) { tray.Visible = false; tray.Dispose(); }
                try { File.Delete(runFile); } catch { }
                Util.Log("Beendet.");
            }
            // Mutex ist freigegeben – jetzt darf die neue Version starten (gleiche Startparameter)
            if (restartAfterExit)
            {
                try
                {
                    var a = Environment.GetCommandLineArgs().Skip(1).Select(x => "\"" + x.Replace("\"", "") + "\"");
                    Process.Start(new ProcessStartInfo(System.Reflection.Assembly.GetExecutingAssembly().Location, string.Join(" ", a)) { UseShellExecute = false });
                }
                catch (Exception ex) { Util.Log("Neue Version konnte nicht gestartet werden: " + ex.Message); }
            }
            return 0;
        }

        /// <summary>Sucht eine APOLOGEA-Sammlung (Ordner mit .apologea\sammlung.json) auf Desktop und in Dokumente, z. B. wenn die EXE verschoben wurde.</summary>
        static string FindCollection()
        {
            var roots = new[] { ExeDir, Environment.GetFolderPath(Environment.SpecialFolder.Desktop), Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments) };
            foreach (var root in roots)
            {
                try
                {
                    string found = Search(root, 4);
                    if (found != null) { Util.Log("Sammlung automatisch gefunden: " + found); return found; }
                }
                catch { }
            }
            return null;
        }

        static string Search(string dir, int depth)
        {
            if (string.IsNullOrEmpty(dir) || !Directory.Exists(dir)) return null;
            if (File.Exists(Path.Combine(Path.Combine(dir, ".apologea"), "sammlung.json"))) return dir;
            if (depth == 0) return null;
            string[] subs;
            try { subs = Directory.GetDirectories(dir); } catch { return null; }
            foreach (var s in subs)
            {
                string name = Path.GetFileName(s);
                if (name.StartsWith(".") || name.StartsWith("_") || name.Equals("APOLOGEA_Pieces", StringComparison.OrdinalIgnoreCase)) continue;
                string r = Search(s, depth - 1);
                if (r != null) return r;
            }
            return null;
        }

        static Dictionary<string, string> ParseArgs(string[] args)
        {
            var d = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            for (int i = 0; i < args.Length; i++)
            {
                if (!args[i].StartsWith("--")) continue;
                string k = args[i].Substring(2);
                string v = (i + 1 < args.Length && !args[i + 1].StartsWith("--")) ? args[++i] : "";
                d[k] = v;
            }
            return d;
        }

        /// <summary>Befehlszeilen-Import: APOLOGEA.exe --import "Quellordner" --sammlung "Zielordner"</summary>
        static int CliImport(Dictionary<string, string> opts)
        {
            string log = Path.Combine(LocalDir, "import-ergebnis.txt");
            try
            {
                if (!opts.ContainsKey("sammlung")) throw new UserError("--sammlung fehlt.");
                Directory.CreateDirectory(opts["sammlung"]);
                var col = new Collection(opts["sammlung"]);
                col.Scan();
                var res = col.ImportLegacy(opts["import"], null);
                File.WriteAllText(log, "OK\n" + Json.Write(res, true), Util.Utf8);
                return 0;
            }
            catch (Exception ex)
            {
                File.WriteAllText(log, "FEHLER\n" + ex, Util.Utf8);
                return 1;
            }
        }

        public static string FindEdge()
        {
            var candidates = new List<string>();
            foreach (var root in new[] { Environment.GetEnvironmentVariable("ProgramFiles(x86)"), Environment.GetEnvironmentVariable("ProgramFiles"), Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData) })
                if (!string.IsNullOrEmpty(root)) candidates.Add(Path.Combine(root, "Microsoft", "Edge", "Application", "msedge.exe"));
            try
            {
                using (var k = Microsoft.Win32.Registry.LocalMachine.OpenSubKey(@"SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\msedge.exe"))
                    if (k != null && k.GetValue("") is string) candidates.Add((string)k.GetValue(""));
            }
            catch { }
            foreach (var c in candidates) if (File.Exists(c)) return c;
            return null;
        }

        public static void OpenWindow(int port, string token, string instanceDir)
        {
            string url = "http://127.0.0.1:" + port + "/?t=" + token;
            string edgePath = FindEdge();
            try
            {
                if (edgePath != null)
                {
                    string profile = Path.Combine(instanceDir, "Fenster");
                    var psi = new ProcessStartInfo(edgePath,
                        "--app=\"" + url + "\" --user-data-dir=\"" + profile + "\" --no-first-run --no-default-browser-check --disable-sync " +
                        "--disable-background-timer-throttling --disable-features=Translate --window-size=1480,940");
                    psi.UseShellExecute = false;
                    var p = Process.Start(psi);
                    if (edge == null || edge.HasExited) { edge = p; edgeStarted = DateTime.Now; }
                    return;
                }
            }
            catch (Exception ex) { Util.Log("Edge konnte nicht gestartet werden: " + ex.Message); }
            Process.Start(new ProcessStartInfo(url) { UseShellExecute = true });
        }

        static void CheckAlive()
        {
            if (headless) return;
            if (Backup.Current != null && Backup.Current.Running) return;
            if (ApiInstance != null && ApiInstance.Busy) return;
            double sincePing = (DateTime.Now - LastPing).TotalSeconds;
            bool edgeAlive = false;
            bool edgeTracked = false;
            try
            {
                if (edge != null)
                {
                    // Beendet sich der gestartete Prozess sofort, hat Edge an eine andere Instanz übergeben
                    if (!edge.HasExited) { edgeAlive = true; edgeTracked = true; }
                    else if ((edge.ExitTime - edgeStarted).TotalSeconds > 8) edgeTracked = true;
                }
            }
            catch { }
            if (edgeAlive) return;
            double limit = edgeTracked ? 6 : 150;
            if (sincePing > limit) Application.ExitThread();
        }

        static void SetupTray()
        {
            tray = new NotifyIcon();
            try { tray.Icon = Icon.ExtractAssociatedIcon(System.Reflection.Assembly.GetExecutingAssembly().Location); }
            catch { tray.Icon = SystemIcons.Application; }
            tray.Text = "APOLOGEA Kollektionsverwaltung";
            var menu = new ContextMenuStrip();
            menu.Items.Add("Fenster öffnen", null, delegate { OpenWindow(Server.Port, Token, InstanceDir); });
            menu.Items.Add("Sammlungsordner im Explorer öffnen", null, delegate
            {
                if (ApiInstance.Col != null) Process.Start("explorer.exe", "\"" + ApiInstance.Col.Root + "\"");
            });
            menu.Items.Add(new ToolStripSeparator());
            menu.Items.Add("APOLOGEA beenden", null, delegate
            {
                if (Backup.Current != null && Backup.Current.Running)
                {
                    MessageBox.Show("Es läuft gerade eine Sicherung. Bitte warten, bis sie abgeschlossen ist.", "APOLOGEA", MessageBoxButtons.OK, MessageBoxIcon.Information);
                    return;
                }
                try { if (edge != null && !edge.HasExited) edge.CloseMainWindow(); } catch { }
                Application.ExitThread();
            });
            tray.ContextMenuStrip = menu;
            tray.DoubleClick += delegate { OpenWindow(Server.Port, Token, InstanceDir); };
            tray.Visible = true;
        }
    }
}
