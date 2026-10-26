// APOLOGEA Kollektionsverwaltung – Kollektionen (gemeinsame Datei mit der Handy-App)
// Datei: <Sammlung>\.apologea\kollektionen.json
//   { "format": "APOLOGEA-Kollektionen/1", "kollektionen": [ { "id", "name", "beschreibung", "status", "drop", "pieces": [Piece-IDs], ... } ] }
// Die Piece-Ordner und Produktdaten.json bleiben unverändert; Pieces werden über ihre id referenziert.
using System;
using System.Collections;
using System.Collections.Generic;
using System.IO;

namespace Apologea
{
    public static class Kollektionen
    {
        public const string FileName = "kollektionen.json";
        public const string FormatId = "APOLOGEA-Kollektionen/1";
        static readonly object Gate = new object();

        static string FilePath(Collection c) { return Path.Combine(c.MetaDir, FileName); }

        /// <summary>Kennung des gelesenen Stands – ändert sich, sobald die Datei (auch von der Handy-App über OneDrive) geändert wurde.</summary>
        static string Stand(string text) { return text == null ? "" : Util.Sha1(text); }

        static Dictionary<string, object> ReadFile(Collection c, out string text)
        {
            string path = FilePath(c);
            text = File.Exists(path) ? Util.ReadAllTextShared(path) : null;
            if (text == null)
            {
                var empty = new Dictionary<string, object>();
                empty["format"] = FormatId;
                empty["kollektionen"] = new List<object>();
                return empty;
            }
            Dictionary<string, object> d;
            // Nicht lesbar heißt NICHT leer – sonst würde beim Speichern alles überschrieben
            try { d = Json.ParseObject(text.TrimStart('﻿')); }
            catch (Exception)
            {
                throw new UserError("Die Datei „.apologea\\kollektionen.json“ ist beschädigt und wird deshalb nicht überschrieben. Bitte die Datei prüfen oder über die OneDrive-Versionsgeschichte wiederherstellen.", 422);
            }
            object list;
            if (!d.TryGetValue("kollektionen", out list) || !(list is IList)) d["kollektionen"] = new List<object>();
            return d;
        }

        public static Dictionary<string, object> Load(Collection c)
        {
            lock (Gate)
            {
                string text;
                var d = ReadFile(c, out text);
                var r = new Dictionary<string, object>();
                r["ok"] = true;
                r["kollektionen"] = d["kollektionen"];
                r["stand"] = Stand(text);
                return r;
            }
        }

        /// <summary>Speichert nur, wenn die Datei seit dem Lesen unverändert ist (Stand); sonst Status 409.</summary>
        public static Dictionary<string, object> Save(Collection c, Dictionary<string, object> body)
        {
            lock (Gate)
            {
                string text;
                var d = ReadFile(c, out text);
                string stand = Json.Str(body, "stand") ?? "";
                if (stand != Stand(text))
                    throw new UserError("Die Kollektionen wurden inzwischen geändert (z. B. in der Handy-App). Bitte erneut versuchen.", 409);
                object raw;
                var list = body.TryGetValue("kollektionen", out raw) ? raw as IList : null;
                if (list == null) throw new UserError("Ungültige Kollektionen.");
                foreach (var item in list)
                {
                    var k = item as IDictionary<string, object>;
                    if (k == null || string.IsNullOrEmpty(Json.Str(k, "id")) || string.IsNullOrWhiteSpace(Json.Str(k, "name")))
                        throw new UserError("Ungültige Kollektion (Kennung oder Name fehlt).");
                }
                d["format"] = FormatId;
                d["kollektionen"] = list;
                d["geaendert"] = Util.Iso(DateTime.Now);
                Directory.CreateDirectory(c.MetaDir);
                string neu = Json.Write(d, true) + "\n";
                Util.WriteAllTextAtomic(FilePath(c), neu);
                var r = new Dictionary<string, object>();
                r["ok"] = true;
                r["kollektionen"] = list;
                r["stand"] = Stand(Util.ReadAllTextShared(FilePath(c)));
                return r;
            }
        }
    }
}
