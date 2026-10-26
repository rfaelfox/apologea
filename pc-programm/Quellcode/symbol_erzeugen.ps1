# Erzeugt apologea.ico (Programmsymbol): goldenes „A“ in feinem Rahmen auf Schwarz.
param([string]$Ziel = (Join-Path $PSScriptRoot 'apologea.ico'))
Add-Type -AssemblyName System.Drawing
$sizes = 256, 64, 48, 32, 24, 16
$pngs = @()
foreach ($s in $sizes) {
  $bmp = New-Object Drawing.Bitmap $s, $s, ([Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = 'AntiAlias'; $g.TextRenderingHint = 'AntiAliasGridFit'; $g.InterpolationMode = 'HighQualityBicubic'
  $g.Clear([Drawing.Color]::Transparent)
  $r = [Math]::Max(2, [int]($s * 0.16))
  $path = New-Object Drawing.Drawing2D.GraphicsPath
  $path.AddArc(0, 0, 2*$r, 2*$r, 180, 90); $path.AddArc($s-2*$r-1, 0, 2*$r, 2*$r, 270, 90)
  $path.AddArc($s-2*$r-1, $s-2*$r-1, 2*$r, 2*$r, 0, 90); $path.AddArc(0, $s-2*$r-1, 2*$r, 2*$r, 90, 90); $path.CloseFigure()
  $g.FillPath((New-Object Drawing.SolidBrush ([Drawing.Color]::FromArgb(255, 16, 15, 13))), $path)
  $gold = [Drawing.Color]::FromArgb(255, 190, 154, 94)
  if ($s -ge 32) {
    $m = [Math]::Max(2, [int]($s * 0.09)); $pw = [Math]::Max(1, $s / 96)
    $pen = New-Object Drawing.Pen $gold, $pw
    $g.DrawRectangle($pen, $m, $m, $s - 2*$m - 1, $s - 2*$m - 1)
    # kleine Rauten an den Rahmenmitten (byzantinisches Rahmendetail)
    $d = [Math]::Max(2, $s * 0.035)
    foreach ($pt in @(@(($s/2), $m), @(($s/2), ($s-$m-1)), @($m, ($s/2)), @(($s-$m-1), ($s/2)))) {
      $x = $pt[0]; $y = $pt[1]
      $poly = [Drawing.PointF[]]@((New-Object Drawing.PointF $x, ($y-$d)), (New-Object Drawing.PointF ($x+$d), $y), (New-Object Drawing.PointF $x, ($y+$d)), (New-Object Drawing.PointF ($x-$d), $y))
      $g.FillPolygon((New-Object Drawing.SolidBrush $gold), $poly)
    }
  }
  $fontName = 'Palatino Linotype'
  $font = New-Object Drawing.Font $fontName, ([single]($s * 0.56)), ([Drawing.FontStyle]::Regular), ([Drawing.GraphicsUnit]::Pixel)
  $sf = New-Object Drawing.StringFormat; $sf.Alignment = 'Center'; $sf.LineAlignment = 'Center'
  $g.DrawString('A', $font, (New-Object Drawing.SolidBrush $gold), (New-Object Drawing.RectangleF 0, ($s*0.04), $s, $s), $sf)
  $g.Dispose()
  $ms = New-Object IO.MemoryStream; $bmp.Save($ms, [Drawing.Imaging.ImageFormat]::Png); $pngs += ,$ms.ToArray(); $bmp.Dispose()
}
$out = New-Object IO.MemoryStream; $w = New-Object IO.BinaryWriter $out
$w.Write([UInt16]0); $w.Write([UInt16]1); $w.Write([UInt16]$sizes.Count)
$offset = 6 + 16 * $sizes.Count
for ($i = 0; $i -lt $sizes.Count; $i++) {
  $s = $sizes[$i]; $b = if ($s -ge 256) { 0 } else { $s }
  $w.Write([byte]$b); $w.Write([byte]$b); $w.Write([byte]0); $w.Write([byte]0)
  $w.Write([UInt16]1); $w.Write([UInt16]32); $w.Write([UInt32]$pngs[$i].Length); $w.Write([UInt32]$offset)
  $offset += $pngs[$i].Length
}
foreach ($p in $pngs) { $w.Write($p) }
[IO.File]::WriteAllBytes($Ziel, $out.ToArray())
# zusätzlich PNG für die Oberfläche (Favicon)
[IO.File]::WriteAllBytes((Join-Path $PSScriptRoot 'ui\symbol.png'), $pngs[1])
Write-Output "Symbol erstellt: $Ziel"
