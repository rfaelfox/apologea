# APOLOGEA Studio entfernen. Deine Daten (Designs, Entwürfe, Sicherungen) bleiben erhalten.
$ErrorActionPreference = 'Continue'
$InstallDir = Join-Path $env:LOCALAPPDATA 'Programs\APOLOGEA Studio'
$Desktop    = [Environment]::GetFolderPath('Desktop')
$StartMenu  = Join-Path ([Environment]::GetFolderPath('Programs')) 'APOLOGEA Studio'
$DataDir    = Join-Path ([Environment]::GetFolderPath('MyDocuments')) 'APOLOGEA Studio'

Add-Type -AssemblyName PresentationFramework
$r = [System.Windows.MessageBox]::Show("APOLOGEA Studio deinstallieren?`n`nDeine Daten bleiben in:`n$DataDir", 'APOLOGEA Studio', 'YesNo', 'Question')
if ($r -ne 'Yes') { exit 0 }

$rt = Join-Path $DataDir '.studio\laufzeit.json'
if (Test-Path $rt) { try { Stop-Process -Id ((Get-Content $rt -Raw | ConvertFrom-Json).pid) -Force } catch { } }
Remove-Item -Force -ErrorAction SilentlyContinue (Join-Path $Desktop 'APOLOGEA Studio.lnk')
Remove-Item -Recurse -Force -ErrorAction SilentlyContinue $StartMenu
Set-Location $env:TEMP
Remove-Item -Recurse -Force -ErrorAction SilentlyContinue $InstallDir
[System.Windows.MessageBox]::Show("APOLOGEA Studio wurde entfernt.`nDeine Daten liegen weiterhin in:`n$DataDir", 'APOLOGEA Studio') | Out-Null
