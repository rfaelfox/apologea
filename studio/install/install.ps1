# APOLOGEA Studio – Installation für Windows 10/11 (ohne Administratorrechte)
# - Programm nach %LOCALAPPDATA%\Programs\APOLOGEA Studio
# - Datenordner in deinen echten Dokumenten-Ordner (auch bei OneDrive-Umleitung)
# - Verknüpfung „APOLOGEA Studio“ auf deinem echten Desktop (auch bei OneDrive-Umleitung) und im Startmenü
# - Node.js-Laufzeit (offizielle Version von nodejs.org, Prüfsumme wird kontrolliert) nur für dieses Programm
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$NodeVersion = 'v22.23.3'
$NodeSha256  = '2b0ff57b049cda1bbcea2240eec20467018713c1efe1f7360c2681859b90ed71'
$NodeZipName = "node-$NodeVersion-win-x64.zip"
$NodeUrl     = "https://nodejs.org/dist/$NodeVersion/$NodeZipName"

$PackageDir = Split-Path -Parent $PSScriptRoot
$InstallDir = Join-Path $env:LOCALAPPDATA 'Programs\APOLOGEA Studio'
$AppDir     = Join-Path $InstallDir 'app'
$RuntimeDir = Join-Path $InstallDir 'runtime'
$UserHome   = if ($env:USERPROFILE) { $env:USERPROFILE } else { $HOME }
# GetFolderPath liefert die tatsächlichen Ordner – auch wenn OneDrive Dokumente/Desktop umleitet.
$Docs       = [Environment]::GetFolderPath('MyDocuments'); if (-not $Docs) { $Docs = Join-Path $UserHome 'Documents' }
$DataDir    = Join-Path $Docs 'APOLOGEA Studio'
$Desktop    = [Environment]::GetFolderPath('Desktop'); if (-not $Desktop) { $Desktop = Join-Path $UserHome 'Desktop' }
$Programs   = [Environment]::GetFolderPath('Programs'); if (-not $Programs) { $Programs = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs' }
$StartMenu  = Join-Path $Programs 'APOLOGEA Studio'

function Step($t) { Write-Host ''; Write-Host "  ◆ $t" -ForegroundColor Yellow }
function Ok($t)   { Write-Host "    ✓ $t" -ForegroundColor Green }

Write-Host ''
Write-Host '  A P O L O G E A   S T U D I O' -ForegroundColor DarkYellow
Write-Host '  Installation' -ForegroundColor DarkGray

Step 'Pfade ermitteln'
Ok "Programm:   $InstallDir"
Ok "Daten:      $DataDir"
Ok "Desktop:    $Desktop"

# Laufendes Studio beenden (falls Aktualisierung)
$rt = Join-Path $DataDir '.studio\laufzeit.json'
if (Test-Path $rt) {
  try {
    $info = Get-Content $rt -Raw | ConvertFrom-Json
    Stop-Process -Id $info.pid -Force -ErrorAction SilentlyContinue
    Start-Sleep -Milliseconds 800
    Ok 'Laufende Instanz beendet'
  } catch { }
}

# Alle Prozesse beenden, die noch Dateien im Programmordner benutzen: das mitgelieferte Node.js
# und Claude-Code-Aufrufe, die das Studio gestartet hatte (erkennbar an ihren Startparametern).
function Stop-StudioProcesses {
  try {
    Get-CimInstance Win32_Process -ErrorAction Stop | Where-Object {
      ($_.ExecutablePath -and $_.ExecutablePath.StartsWith($InstallDir, [StringComparison]::OrdinalIgnoreCase)) -or
      ($_.Name -like 'claude*' -and $_.CommandLine -like '*--no-session-persistence*' -and $_.CommandLine -like '*stream-json*')
    } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  } catch { }
}

Step 'Programmdateien kopieren'
New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
if (Test-Path $AppDir) {
  $removed = $false
  for ($i = 1; $i -le 6 -and -not $removed; $i++) {
    Stop-StudioProcesses
    Start-Sleep -Milliseconds (500 * $i)
    try { Remove-Item -Recurse -Force $AppDir -ErrorAction Stop; $removed = $true } catch { }
  }
  if (-not $removed) {
    Write-Host ''
    Write-Host '    Der alte Programmordner wird noch von einem anderen Programm benutzt.' -ForegroundColor Red
    Write-Host '    Bitte APOLOGEA Studio und alle Fenster von Claude Code schliessen' -ForegroundColor Red
    Write-Host '    (oder den Computer neu starten) und Installieren.cmd erneut ausfuehren.' -ForegroundColor Red
    Write-Host "    Ordner: $AppDir" -ForegroundColor DarkGray
    throw 'Programmordner ist noch in Benutzung.'
  }
  Ok 'Alte Programmversion entfernt (deine Daten bleiben erhalten)'
}
Copy-Item -Recurse -Force (Join-Path $PackageDir 'app') $AppDir
Copy-Item -Force (Join-Path $PackageDir 'app\APOLOGEA Studio.vbs') (Join-Path $InstallDir 'APOLOGEA Studio.vbs')
Copy-Item -Force (Join-Path $PSScriptRoot 'uninstall.ps1') (Join-Path $InstallDir 'uninstall.ps1')
@{ dataDir = $DataDir; installedAt = (Get-Date).ToString('o'); version = (Get-Content (Join-Path $AppDir 'package.json') -Raw | ConvertFrom-Json).version } |
  ConvertTo-Json | Set-Content -Encoding UTF8 (Join-Path $AppDir 'install.json')
Ok 'Kopiert'

Step 'Node.js-Laufzeit bereitstellen'
$NodeExe = Join-Path $RuntimeDir 'node.exe'
$haveNode = $false
if (Test-Path $NodeExe) {
  $v = & $NodeExe --version 2>$null
  if ($v -eq $NodeVersion) { $haveNode = $true; Ok "Vorhanden ($v)" }
}
if (-not $haveNode) {
  $bundled = Join-Path $PackageDir "runtime\node.exe"
  if (Test-Path $bundled) {
    New-Item -ItemType Directory -Force -Path $RuntimeDir | Out-Null
    Copy-Item -Force $bundled $NodeExe
    Ok 'Aus dem Paket übernommen'
  } else {
    $tmp = Join-Path $env:TEMP $NodeZipName
    Write-Host "    Lade $NodeUrl …"
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    Invoke-WebRequest -Uri $NodeUrl -OutFile $tmp -UseBasicParsing
    $hash = (Get-FileHash -Algorithm SHA256 $tmp).Hash.ToLower()
    if ($hash -ne $NodeSha256) { Remove-Item $tmp -Force; throw "Prüfsumme der Node.js-Datei stimmt nicht ($hash). Installation abgebrochen." }
    Ok 'Prüfsumme korrekt'
    $ex = Join-Path $env:TEMP "apologea-node-$([guid]::NewGuid())"
    Expand-Archive -Path $tmp -DestinationPath $ex -Force
    New-Item -ItemType Directory -Force -Path $RuntimeDir | Out-Null
    Copy-Item -Force (Join-Path $ex "node-$NodeVersion-win-x64\node.exe") $NodeExe
    Remove-Item -Recurse -Force $ex, $tmp
    Ok "Node.js $NodeVersion installiert"
  }
}

Step 'Datenordner anlegen'
foreach ($d in @('', 'Designs', 'Website-Uploads', 'Exporte', 'Sicherungen')) {
  New-Item -ItemType Directory -Force -Path (Join-Path $DataDir $d) | Out-Null
}
Ok $DataDir

Step 'Verknüpfungen erstellen'
$shell = New-Object -ComObject WScript.Shell
function New-Link($path, $target, $arguments, $icon, $desc, $workdir) {
  $l = $shell.CreateShortcut($path)
  $l.TargetPath = $target
  if ($arguments) { $l.Arguments = $arguments }
  if ($icon) { $l.IconLocation = $icon }
  if ($workdir) { $l.WorkingDirectory = $workdir }
  $l.Description = $desc
  $l.Save()
}
$wscript = Join-Path $env:WINDIR 'System32\wscript.exe'
$vbs = Join-Path $InstallDir 'APOLOGEA Studio.vbs'
$icon = Join-Path $AppDir 'public\icon.ico'
New-Link (Join-Path $Desktop 'APOLOGEA Studio.lnk') $wscript "`"$vbs`"" "$icon,0" 'APOLOGEA Studio starten' $InstallDir
Ok (Join-Path $Desktop 'APOLOGEA Studio.lnk')
New-Item -ItemType Directory -Force -Path $StartMenu | Out-Null
New-Link (Join-Path $StartMenu 'APOLOGEA Studio.lnk') $wscript "`"$vbs`"" "$icon,0" 'APOLOGEA Studio starten' $InstallDir
New-Link (Join-Path $StartMenu 'APOLOGEA Studio – Datenordner.lnk') $DataDir $null $null 'Designs, Exporte und Sicherungen' $null
$ps = Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe'
New-Link (Join-Path $StartMenu 'APOLOGEA Studio deinstallieren.lnk') $ps "-NoProfile -ExecutionPolicy Bypass -File `"$InstallDir\uninstall.ps1`"" $null 'APOLOGEA Studio entfernen (Daten bleiben erhalten)' $InstallDir
Ok 'Startmenü-Einträge angelegt'

Step 'Programm starten und Start prüfen'
$check = & $NodeExe (Join-Path $AppDir 'launcher.js') --check 2>&1 | Out-String
if ($check -match '"ok":true') {
  Ok 'APOLOGEA Studio läuft und das Fenster wurde geöffnet.'
} else {
  Write-Host "    ✗ Start konnte nicht bestätigt werden:" -ForegroundColor Red
  Write-Host $check
  Write-Host "    Protokoll: $(Join-Path $DataDir '.studio\logs\studio.log')"
  exit 2
}

Write-Host ''
Write-Host '  Fertig. Starte APOLOGEA Studio künftig per Doppelklick auf „APOLOGEA Studio“ auf deinem Desktop.' -ForegroundColor DarkYellow
Write-Host ''
