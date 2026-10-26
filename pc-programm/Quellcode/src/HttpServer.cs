// APOLOGEA Kollektionsverwaltung – kleiner lokaler HTTP-Server (nur 127.0.0.1, keine Administratorrechte nötig)
using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Threading;

namespace Apologea
{
    public class Request
    {
        public string Method;
        public string Path;
        public Dictionary<string, string> Query = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        public Dictionary<string, string> Headers = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        public long ContentLength;
        public Stream Body;

        public string Header(string name)
        {
            string v;
            return Headers.TryGetValue(name, out v) ? v : null;
        }

        public string Q(string name)
        {
            string v;
            return Query.TryGetValue(name, out v) ? v : null;
        }

        public string ReadBodyText()
        {
            if (ContentLength > 20 * 1024 * 1024) throw new UserError("Anfrage zu groß.");
            var buf = new byte[ContentLength];
            int read = 0;
            while (read < ContentLength)
            {
                int n = Body.Read(buf, read, (int)(ContentLength - read));
                if (n <= 0) break;
                read += n;
            }
            return Util.Utf8.GetString(buf, 0, read);
        }

        public string Cookie(string name)
        {
            string c = Header("Cookie");
            if (c == null) return null;
            foreach (var part in c.Split(';'))
            {
                int eq = part.IndexOf('=');
                if (eq < 0) continue;
                if (part.Substring(0, eq).Trim() == name) return part.Substring(eq + 1).Trim();
            }
            return null;
        }
    }

    public class Response
    {
        public int Status = 200;
        public string ContentType = "application/octet-stream";
        public Dictionary<string, string> Headers = new Dictionary<string, string>();
        public byte[] Bytes;
        public string FilePath;

        public static Response Json(object o)
        {
            return Json(o, 200);
        }

        public static Response Json(object o, int status)
        {
            var r = new Response();
            r.Status = status;
            r.ContentType = "application/json; charset=utf-8";
            r.Bytes = Util.Utf8.GetBytes(Apologea.Json.Write(o, false));
            r.Headers["Cache-Control"] = "no-store";
            return r;
        }

        public static Response Text(string s, int status, string type)
        {
            var r = new Response();
            r.Status = status;
            r.ContentType = type;
            r.Bytes = Util.Utf8.GetBytes(s);
            return r;
        }

        public static Response Error(string message, int status)
        {
            var d = new Dictionary<string, object>();
            d["fehler"] = message;
            return Json(d, status);
        }

        public static Response File(string path, string type)
        {
            var r = new Response();
            r.FilePath = path;
            r.ContentType = type;
            return r;
        }
    }

    public class HttpServer
    {
        TcpListener listener;
        public int Port;
        public Func<Request, Response> Handler;
        volatile bool running;

        public void Start(int preferredPort)
        {
            for (int p = preferredPort; p < preferredPort + 40; p++)
            {
                try
                {
                    listener = new TcpListener(IPAddress.Loopback, p);
                    listener.Start();
                    Port = p;
                    break;
                }
                catch (SocketException) { listener = null; }
            }
            if (listener == null)
            {
                listener = new TcpListener(IPAddress.Loopback, 0);
                listener.Start();
                Port = ((IPEndPoint)listener.LocalEndpoint).Port;
            }
            running = true;
            var t = new Thread(AcceptLoop);
            t.IsBackground = true;
            t.Name = "HTTP-Annahme";
            t.Start();
        }

        public void Stop()
        {
            running = false;
            try { listener.Stop(); } catch { }
        }

        void AcceptLoop()
        {
            while (running)
            {
                TcpClient c;
                try { c = listener.AcceptTcpClient(); }
                catch { if (!running) return; continue; }
                ThreadPool.QueueUserWorkItem(delegate { HandleClient(c); });
            }
        }

        static string ReadLine(Stream s)
        {
            var sb = new StringBuilder();
            while (true)
            {
                int b = s.ReadByte();
                if (b < 0) return sb.Length == 0 ? null : sb.ToString();
                if (b == '\n') break;
                if (b != '\r') sb.Append((char)b);
                if (sb.Length > 16384) throw new IOException("Kopfzeile zu lang");
            }
            return sb.ToString();
        }

        void HandleClient(TcpClient client)
        {
            try
            {
                client.NoDelay = true;
                client.ReceiveTimeout = 60000;
                client.SendTimeout = 120000;
                using (client)
                using (var ns = client.GetStream())
                {
                    var input = new BufferedStream(ns, 1 << 16);
                    while (running)
                    {
                        string line;
                        try { line = ReadLine(input); } catch { return; }
                        if (line == null) return;
                        if (line.Length == 0) continue;
                        var parts = line.Split(' ');
                        if (parts.Length < 3) return;
                        var req = new Request();
                        req.Method = parts[0].ToUpperInvariant();
                        string target = parts[1];
                        int q = target.IndexOf('?');
                        req.Path = Uri.UnescapeDataString(q >= 0 ? target.Substring(0, q) : target);
                        if (q >= 0)
                        {
                            foreach (var kv in target.Substring(q + 1).Split('&'))
                            {
                                if (kv.Length == 0) continue;
                                int eq = kv.IndexOf('=');
                                string k = Uri.UnescapeDataString((eq >= 0 ? kv.Substring(0, eq) : kv).Replace('+', ' '));
                                string v = eq >= 0 ? Uri.UnescapeDataString(kv.Substring(eq + 1).Replace('+', ' ')) : "";
                                req.Query[k] = v;
                            }
                        }
                        while (true)
                        {
                            string h = ReadLine(input);
                            if (h == null) return;
                            if (h.Length == 0) break;
                            int c = h.IndexOf(':');
                            if (c > 0) req.Headers[h.Substring(0, c).Trim()] = h.Substring(c + 1).Trim();
                        }
                        long len = 0;
                        string cl = req.Header("Content-Length");
                        if (cl != null) long.TryParse(cl, NumberStyles.Integer, CultureInfo.InvariantCulture, out len);
                        if (req.Header("Transfer-Encoding") != null) return; // nicht unterstützt
                        req.ContentLength = len;
                        var body = new LimitedStream(input, len);
                        req.Body = body;

                        Response resp;
                        try { resp = Handler(req); }
                        catch (UserError ue) { resp = Response.Error(ue.Message, ue.Status); }
                        catch (Exception ex)
                        {
                            Util.Log("Fehler bei " + req.Method + " " + req.Path + ": " + ex);
                            resp = Response.Error(Util.IoMessage(ex), 500);
                        }
                        // Rest des Körpers verwerfen, damit die Verbindung weiter nutzbar bleibt
                        try { body.Drain(); } catch { return; }
                        bool keepAlive = !string.Equals(req.Header("Connection"), "close", StringComparison.OrdinalIgnoreCase);
                        Write(ns, req, resp, keepAlive);
                        if (!keepAlive) return;
                    }
                }
            }
            catch (IOException) { }
            catch (ObjectDisposedException) { }
            catch (Exception ex) { Util.Log("Verbindungsfehler: " + ex.Message); }
        }

        static string Reason(int s)
        {
            switch (s)
            {
                case 200: return "OK";
                case 204: return "No Content";
                case 302: return "Found";
                case 304: return "Not Modified";
                case 400: return "Bad Request";
                case 403: return "Forbidden";
                case 404: return "Not Found";
                case 409: return "Conflict";
                case 422: return "Unprocessable Entity";
                default: return s >= 500 ? "Internal Server Error" : "Status";
            }
        }

        static void Write(Stream ns, Request req, Response resp, bool keepAlive)
        {
            Stream file = null;
            long length = 0;
            try
            {
                if (resp.FilePath != null)
                {
                    try
                    {
                        file = new FileStream(resp.FilePath, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete, 1 << 16);
                        length = file.Length;
                    }
                    catch (Exception ex)
                    {
                        resp = Response.Error(Util.IoMessage(ex), 404);
                    }
                }
                if (file == null) length = resp.Bytes == null ? 0 : resp.Bytes.Length;
                var sb = new StringBuilder();
                sb.Append("HTTP/1.1 ").Append(resp.Status).Append(' ').Append(Reason(resp.Status)).Append("\r\n");
                sb.Append("Content-Type: ").Append(resp.ContentType).Append("\r\n");
                sb.Append("Content-Length: ").Append(length).Append("\r\n");
                sb.Append("X-Content-Type-Options: nosniff\r\n");
                sb.Append("Connection: ").Append(keepAlive ? "keep-alive" : "close").Append("\r\n");
                foreach (var kv in resp.Headers) sb.Append(kv.Key).Append(": ").Append(kv.Value).Append("\r\n");
                sb.Append("\r\n");
                var head = Encoding.UTF8.GetBytes(sb.ToString());
                ns.Write(head, 0, head.Length);
                if (req.Method == "HEAD") return;
                if (file != null) file.CopyTo(ns, 1 << 16);
                else if (resp.Bytes != null) ns.Write(resp.Bytes, 0, resp.Bytes.Length);
                ns.Flush();
            }
            finally
            {
                if (file != null) file.Dispose();
            }
        }
    }

    /// <summary>Lesestrom, der genau Content-Length Bytes liefert.</summary>
    public class LimitedStream : Stream
    {
        readonly Stream inner;
        long remaining;
        public LimitedStream(Stream inner, long length) { this.inner = inner; remaining = length; }
        public override int Read(byte[] buffer, int offset, int count)
        {
            if (remaining <= 0) return 0;
            int n = inner.Read(buffer, offset, (int)Math.Min(count, remaining));
            if (n <= 0) { remaining = 0; return 0; }
            remaining -= n;
            return n;
        }
        public void Drain()
        {
            var buf = new byte[8192];
            while (remaining > 0 && Read(buf, 0, buf.Length) > 0) { }
        }
        public override bool CanRead { get { return true; } }
        public override bool CanSeek { get { return false; } }
        public override bool CanWrite { get { return false; } }
        public override long Length { get { throw new NotSupportedException(); } }
        public override long Position { get { throw new NotSupportedException(); } set { throw new NotSupportedException(); } }
        public override void Flush() { }
        public override long Seek(long o, SeekOrigin s) { throw new NotSupportedException(); }
        public override void SetLength(long v) { throw new NotSupportedException(); }
        public override void Write(byte[] b, int o, int c) { throw new NotSupportedException(); }
    }
}
