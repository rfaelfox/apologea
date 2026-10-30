// APOLOGEA Kollektionsverwaltung – Datenmodell eines Pieces (Produktdaten.json)
using System;
using System.Collections.Generic;
using System.IO;

namespace Apologea
{
    public class Piece
    {
        public const string DataFile = "Produktdaten.json";
        public const string FormatId = "APOLOGEA-Piece/1";

        public static readonly string[] Roles = { "design", "kleidungsansicht", "mockup" };
        public static readonly string[] RoleBase = { "Design", "Kleidungsansicht", "Mockup" };
        public static readonly string[] RoleLabel = { "Designmotiv", "Kleidungsansicht", "Mockup" };

        public string Id;
        public int Nummer;
        public string Name = "";
        public string Motivtitel = "";
        public string Kategorie = "";
        public string Zielgruppe = ""; // "mann" | "frau" | "unisex" | "" (offen)
        public string Serie = "";
        public string Beschreibung = "";
        public string Herkunft = "";
        public string VorlageVon;
        public List<string> Schlagwoerter = new List<string>();
        public bool Entwurf;
        public DateTime Erstellt;
        public DateTime Geaendert;
        public Dictionary<string, string> Bilder = new Dictionary<string, string>();
        public List<string> Arbeitsdateien = new List<string>();
        public Dictionary<string, object> Extra = new Dictionary<string, object>();

        // Laufzeitdaten (nicht gespeichert)
        public string Dir;
        public List<string> Unzugeordnet = new List<string>();
        public List<string> Probleme = new List<string>();
        public string Signatur = "";
        public Dictionary<string, FileInfo> Dateien = new Dictionary<string, FileInfo>(StringComparer.OrdinalIgnoreCase);

        public static int RoleIndex(string role)
        {
            return Array.IndexOf(Roles, role);
        }

        public string NummerText
        {
            get { return Nummer.ToString("000"); }
        }

        public string Titel
        {
            get { return NummerText + " · " + Name; }
        }

        public static bool IsKnownKey(string k) { return Known.Contains(k); }
        static readonly HashSet<string> Known = new HashSet<string> {
            "format", "id", "nummer", "name", "motivtitel", "kategorie", "serie", "beschreibung", "schlagwoerter",
            "entwurf", "bilder", "arbeitsdateien", "erstellt", "geaendert", "herkunft", "vorlage_von", "zielgruppe" };

        /// <summary>Zielgruppe vereinheitlichen (gleiche Wörter wie zielgruppe.js der Handy-App); Unbekanntes → ""</summary>
        public static string NormZielgruppe(string v)
        {
            string s = (v ?? "").Trim().ToLowerInvariant();
            switch (s)
            {
                case "mann": case "männer": case "maenner": case "manner": case "herren": case "herr": case "men": case "mens": case "male": case "boys": return "mann";
                case "frau": case "frauen": case "damen": case "dame": case "women": case "womens": case "woman": case "ladies": case "lady": case "female": case "girls": case "wmns": return "frau";
                case "unisex": return "unisex";
                default: return "";
            }
        }

        public static string ZielgruppeLabel(string v)
        {
            return v == "mann" ? "Mann" : v == "frau" ? "Frau" : v == "unisex" ? "Unisex" : "";
        }

        public static Piece FromDict(Dictionary<string, object> d)
        {
            var p = new Piece();
            p.Id = Json.Str(d, "id");
            p.Nummer = Json.Int(d, "nummer") ?? 0;
            p.Name = Json.StrOr(d, "name", "").Trim();
            p.Motivtitel = Json.StrOr(d, "motivtitel", "").Trim();
            p.Kategorie = Json.StrOr(d, "kategorie", "");
            p.Zielgruppe = NormZielgruppe(Json.Str(d, "zielgruppe"));
            p.Serie = Json.StrOr(d, "serie", "");
            p.Beschreibung = Json.StrOr(d, "beschreibung", "");
            p.Herkunft = Json.StrOr(d, "herkunft", "");
            p.VorlageVon = Json.Str(d, "vorlage_von");
            p.Schlagwoerter = Json.StrList(d, "schlagwoerter");
            p.Entwurf = Json.Bool(d, "entwurf");
            p.Erstellt = Util.ParseIso(Json.Str(d, "erstellt")) ?? DateTime.Now;
            p.Geaendert = Util.ParseIso(Json.Str(d, "geaendert")) ?? p.Erstellt;
            var b = Json.Obj(d, "bilder");
            foreach (var r in Roles)
            {
                string v = b == null ? null : Json.Str(b, r);
                p.Bilder[r] = string.IsNullOrEmpty(v) ? null : v.Replace('/', '\\');
            }
            foreach (var a in Json.StrList(d, "arbeitsdateien")) p.Arbeitsdateien.Add(a.Replace('/', '\\'));
            foreach (var kv in d) if (!Known.Contains(kv.Key)) p.Extra[kv.Key] = kv.Value;
            return p;
        }

        public Dictionary<string, object> ToDict()
        {
            var d = new Dictionary<string, object>();
            d["format"] = FormatId;
            d["id"] = Id;
            d["nummer"] = Nummer;
            d["name"] = Name;
            d["motivtitel"] = Motivtitel;
            d["kategorie"] = Kategorie;
            d["zielgruppe"] = Zielgruppe ?? "";
            d["serie"] = Serie;
            d["beschreibung"] = Beschreibung;
            d["schlagwoerter"] = Schlagwoerter;
            d["entwurf"] = Entwurf;
            var b = new Dictionary<string, object>();
            foreach (var r in Roles)
            {
                string v;
                Bilder.TryGetValue(r, out v);
                b[r] = v == null ? null : v.Replace('\\', '/');
            }
            d["bilder"] = b;
            var a = new List<object>();
            foreach (var x in Arbeitsdateien) a.Add(x.Replace('\\', '/'));
            d["arbeitsdateien"] = a;
            d["erstellt"] = Util.Iso(Erstellt);
            d["geaendert"] = Util.Iso(Geaendert);
            d["herkunft"] = Herkunft;
            d["vorlage_von"] = VorlageVon;
            foreach (var kv in Extra) d[kv.Key] = kv.Value;
            return d;
        }

        public string ToJson()
        {
            return Json.Write(ToDict(), true) + "\n";
        }

        public Piece Clone()
        {
            var c = FromDict(ToDict());
            c.Dir = Dir;
            return c;
        }

        /// <summary>Ordnername nach dem Muster 171_SERAPHIM bzw. 001_SIGNUM_Goldenes_Kreuzzeichen.</summary>
        public static string FolderNameFor(int nummer, string name, string motivtitel)
        {
            string n = Util.SafeSegment(name, 40);
            if (n.Length == 0) n = "Ohne_Namen";
            string m = Util.SafeSegment(motivtitel, 40);
            string res = nummer.ToString("000") + "_" + n;
            if (m.Length > 0) res += "_" + m;
            if (res.Length > 80) res = res.Substring(0, 80).TrimEnd('_', '.');
            return res;
        }

        /// <summary>Errät die Bildrolle aus einem Dateinamen.</summary>
        public static string GuessRole(string fileName)
        {
            string n = Path.GetFileNameWithoutExtension(fileName ?? "").ToLowerInvariant();
            if (n.Contains("kleidungsansicht") || n.Contains("motivdarstellung") || n.Contains("kleidung") || n.Contains("ansicht") || n.Contains("flat") || n.Contains("front") || n.Contains("garment"))
                return "kleidungsansicht";
            if (n.Contains("mockup") || n.Contains("mock-up") || n.Contains("mock") || n.Contains("model") || n.Contains("lifestyle"))
                return "mockup";
            if (n.Contains("design") || n.Contains("motiv") || n.Contains("druck") || n.Contains("print") || n.Contains("artwork") || n.Contains("grafik"))
                return "design";
            return null;
        }
    }
}
