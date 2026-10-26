// APOLOGEA Kollektionsverwaltung – JSON-Hilfen (Lesen über JavaScriptSerializer, Schreiben formatiert)
using System;
using System.Collections;
using System.Collections.Generic;
using System.Globalization;
using System.Text;
using System.Web.Script.Serialization;

namespace Apologea
{
    public static class Json
    {
        public static object Parse(string text)
        {
            var s = new JavaScriptSerializer();
            s.MaxJsonLength = int.MaxValue;
            s.RecursionLimit = 200;
            return s.DeserializeObject(text);
        }

        public static Dictionary<string, object> ParseObject(string text)
        {
            var o = Parse(text) as Dictionary<string, object>;
            if (o == null) throw new FormatException("JSON-Objekt erwartet.");
            return o;
        }

        public static string Write(object value, bool pretty)
        {
            var sb = new StringBuilder();
            WriteValue(sb, value, pretty, 0);
            return sb.ToString();
        }

        static void Indent(StringBuilder sb, bool pretty, int level)
        {
            if (!pretty) return;
            sb.Append('\n');
            sb.Append(' ', level * 2);
        }

        static void WriteValue(StringBuilder sb, object v, bool pretty, int level)
        {
            if (v == null) { sb.Append("null"); return; }
            if (v is string) { WriteString(sb, (string)v); return; }
            if (v is bool) { sb.Append((bool)v ? "true" : "false"); return; }
            if (v is DateTime) { WriteString(sb, Util.Iso((DateTime)v)); return; }
            if (v is int || v is long || v is short || v is byte || v is uint || v is ulong)
            { sb.Append(Convert.ToString(v, CultureInfo.InvariantCulture)); return; }
            if (v is double || v is float || v is decimal)
            {
                double d = Convert.ToDouble(v, CultureInfo.InvariantCulture);
                if (double.IsNaN(d) || double.IsInfinity(d)) sb.Append("null");
                else sb.Append(d.ToString("R", CultureInfo.InvariantCulture));
                return;
            }
            var dict = v as IDictionary;
            if (dict != null)
            {
                if (dict.Count == 0) { sb.Append("{}"); return; }
                sb.Append('{');
                bool first = true;
                foreach (DictionaryEntry e in dict)
                {
                    if (!first) sb.Append(',');
                    first = false;
                    Indent(sb, pretty, level + 1);
                    WriteString(sb, Convert.ToString(e.Key, CultureInfo.InvariantCulture));
                    sb.Append(pretty ? ": " : ":");
                    WriteValue(sb, e.Value, pretty, level + 1);
                }
                Indent(sb, pretty, level);
                sb.Append('}');
                return;
            }
            var list = v as IEnumerable;
            if (list != null)
            {
                bool first = true;
                bool any = false;
                sb.Append('[');
                foreach (var item in list)
                {
                    any = true;
                    if (!first) sb.Append(',');
                    first = false;
                    Indent(sb, pretty, level + 1);
                    WriteValue(sb, item, pretty, level + 1);
                }
                if (any) Indent(sb, pretty, level);
                sb.Append(']');
                return;
            }
            WriteString(sb, v.ToString());
        }

        static void WriteString(StringBuilder sb, string s)
        {
            sb.Append('"');
            foreach (char c in s)
            {
                switch (c)
                {
                    case '"': sb.Append("\\\""); break;
                    case '\\': sb.Append("\\\\"); break;
                    case '\n': sb.Append("\\n"); break;
                    case '\r': sb.Append("\\r"); break;
                    case '\t': sb.Append("\\t"); break;
                    case '<': sb.Append("\\u003c"); break;
                    case '>': sb.Append("\\u003e"); break;
                    case '&': sb.Append("\\u0026"); break;
                    default:
                        if (c < 0x20 || c == (char)0x2028 || c == (char)0x2029) sb.AppendFormat("\\u{0:x4}", (int)c);
                        else sb.Append(c);
                        break;
                }
            }
            sb.Append('"');
        }

        // ---- Lesehilfen für Dictionary<string,object> ----
        public static string Str(IDictionary<string, object> d, string key)
        {
            object v;
            if (d == null || !d.TryGetValue(key, out v) || v == null) return null;
            return Convert.ToString(v, CultureInfo.InvariantCulture);
        }

        public static string StrOr(IDictionary<string, object> d, string key, string fallback)
        {
            var s = Str(d, key);
            return s ?? fallback;
        }

        public static int? Int(IDictionary<string, object> d, string key)
        {
            object v;
            if (d == null || !d.TryGetValue(key, out v) || v == null) return null;
            try
            {
                if (v is string)
                {
                    int r;
                    if (int.TryParse(((string)v).Trim(), NumberStyles.Integer, CultureInfo.InvariantCulture, out r)) return r;
                    return null;
                }
                return Convert.ToInt32(v, CultureInfo.InvariantCulture);
            }
            catch { return null; }
        }

        public static bool Bool(IDictionary<string, object> d, string key)
        {
            object v;
            if (d == null || !d.TryGetValue(key, out v) || v == null) return false;
            if (v is bool) return (bool)v;
            return string.Equals(Convert.ToString(v), "true", StringComparison.OrdinalIgnoreCase);
        }

        public static Dictionary<string, object> Obj(IDictionary<string, object> d, string key)
        {
            object v;
            if (d == null || !d.TryGetValue(key, out v)) return null;
            return v as Dictionary<string, object>;
        }

        public static List<object> Arr(IDictionary<string, object> d, string key)
        {
            object v;
            if (d == null || !d.TryGetValue(key, out v) || v == null) return new List<object>();
            var arr = v as IEnumerable;
            var res = new List<object>();
            if (arr == null || v is string) return res;
            foreach (var x in arr) res.Add(x);
            return res;
        }

        public static List<string> StrList(IDictionary<string, object> d, string key)
        {
            var res = new List<string>();
            foreach (var x in Arr(d, key))
            {
                if (x == null) continue;
                var s = Convert.ToString(x, CultureInfo.InvariantCulture).Trim();
                if (s.Length > 0) res.Add(s);
            }
            return res;
        }
    }
}
