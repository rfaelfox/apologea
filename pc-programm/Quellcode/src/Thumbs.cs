// APOLOGEA Kollektionsverwaltung – Vorschaubilder (Zwischenspeicher, Originale bleiben unverändert)
using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.IO;
using System.Linq;
using System.Threading;

namespace Apologea
{
    public static class Thumbs
    {
        public static string CacheDir;
        static readonly Dictionary<string, object> keyLocks = new Dictionary<string, object>();
        static readonly SemaphoreSlim gate = new SemaphoreSlim(Math.Max(2, Environment.ProcessorCount - 1));

        static object LockFor(string key)
        {
            lock (keyLocks)
            {
                object o;
                if (!keyLocks.TryGetValue(key, out o)) { o = new object(); keyLocks[key] = o; }
                return o;
            }
        }

        /// <summary>Liefert den Pfad eines Vorschaubilds; erzeugt es bei Bedarf. Ändert sich das Original, entsteht automatisch ein neues.</summary>
        public static string Get(string source, int width)
        {
            var fi = new FileInfo(source);
            if (!fi.Exists) return null;
            string key = Util.Sha1(fi.FullName.ToLowerInvariant() + "|" + fi.Length + "|" + fi.LastWriteTimeUtc.Ticks + "|" + width);
            string sub = Path.Combine(CacheDir, key.Substring(0, 2));
            string png = Path.Combine(sub, key + ".png");
            string jpg = Path.Combine(sub, key + ".jpg");
            if (File.Exists(png)) return png;
            if (File.Exists(jpg)) return jpg;
            lock (LockFor(key))
            {
                if (File.Exists(png)) return png;
                if (File.Exists(jpg)) return jpg;
                gate.Wait();
                try
                {
                    Directory.CreateDirectory(sub);
                    using (var fs = new FileStream(source, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete))
                    using (var img = Image.FromStream(fs, true, false))
                    {
                        ApplyOrientation(img);
                        bool alpha = Image.IsAlphaPixelFormat(img.PixelFormat) || (img.Flags & (int)ImageFlags.HasAlpha) != 0;
                        int w = img.Width, h = img.Height;
                        if (w > width) { h = Math.Max(1, (int)Math.Round(h * (double)width / w)); w = width; }
                        using (var bmp = new Bitmap(w, h, alpha ? PixelFormat.Format32bppArgb : PixelFormat.Format24bppRgb))
                        {
                            bmp.SetResolution(96, 96);
                            using (var g = Graphics.FromImage(bmp))
                            {
                                if (!alpha) g.Clear(Color.White);
                                g.CompositingMode = CompositingMode.SourceOver;
                                g.CompositingQuality = CompositingQuality.HighQuality;
                                g.InterpolationMode = InterpolationMode.HighQualityBicubic;
                                g.SmoothingMode = SmoothingMode.HighQuality;
                                g.PixelOffsetMode = PixelOffsetMode.HighQuality;
                                using (var attr = new ImageAttributes())
                                {
                                    attr.SetWrapMode(WrapMode.TileFlipXY);
                                    g.DrawImage(img, new Rectangle(0, 0, w, h), 0, 0, img.Width, img.Height, GraphicsUnit.Pixel, attr);
                                }
                            }
                            string target = alpha ? png : jpg;
                            string tmp = target + ".tmp";
                            if (alpha) bmp.Save(tmp, ImageFormat.Png);
                            else
                            {
                                var enc = ImageCodecInfo.GetImageEncoders().First(c => c.FormatID == ImageFormat.Jpeg.Guid);
                                var ep = new EncoderParameters(1);
                                ep.Param[0] = new EncoderParameter(System.Drawing.Imaging.Encoder.Quality, 86L);
                                bmp.Save(tmp, enc, ep);
                            }
                            if (File.Exists(target)) File.Delete(target);
                            File.Move(tmp, target);
                            return target;
                        }
                    }
                }
                finally { gate.Release(); }
            }
        }

        static void ApplyOrientation(Image img)
        {
            try
            {
                if (!img.PropertyIdList.Contains(0x0112)) return;
                var prop = img.GetPropertyItem(0x0112);
                int o = BitConverter.ToUInt16(prop.Value, 0);
                RotateFlipType t = RotateFlipType.RotateNoneFlipNone;
                switch (o)
                {
                    case 2: t = RotateFlipType.RotateNoneFlipX; break;
                    case 3: t = RotateFlipType.Rotate180FlipNone; break;
                    case 4: t = RotateFlipType.Rotate180FlipX; break;
                    case 5: t = RotateFlipType.Rotate90FlipX; break;
                    case 6: t = RotateFlipType.Rotate90FlipNone; break;
                    case 7: t = RotateFlipType.Rotate270FlipX; break;
                    case 8: t = RotateFlipType.Rotate270FlipNone; break;
                }
                if (t != RotateFlipType.RotateNoneFlipNone) img.RotateFlip(t);
            }
            catch { }
        }

        public static int[] Dimensions(string path)
        {
            try
            {
                using (var fs = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite))
                using (var img = Image.FromStream(fs, false, false))
                    return new[] { img.Width, img.Height };
            }
            catch { return null; }
        }

        public static void ClearCache()
        {
            if (Directory.Exists(CacheDir))
            {
                foreach (var d in Directory.GetDirectories(CacheDir))
                    try { Directory.Delete(d, true); } catch { }
            }
        }

        /// <summary>Erzeugt Vorschaubilder im Hintergrund vorab, damit der Katalog zügig lädt.</summary>
        public static void PrewarmAsync(Func<List<string>> files)
        {
            var t = new Thread(delegate ()
            {
                try
                {
                    Thread.Sleep(1500);
                    foreach (var f in files())
                    {
                        try { if (Util.CanThumb(Path.GetExtension(f))) Get(f, 480); } catch { }
                    }
                }
                catch { }
            });
            t.IsBackground = true;
            t.Priority = ThreadPriority.BelowNormal;
            t.Start();
        }
    }
}
