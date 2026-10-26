@echo off
rem ================================================================
rem  APOLOGEA Kollektionsverwaltung - Programm aus dem Quellcode bauen
rem  Benoetigt nur Windows 10/11 mit .NET Framework 4.8 (vorinstalliert).
rem  Ergebnis: ..\APOLOGEA.exe  (die Sammlung wird dabei nicht beruehrt)
rem ================================================================
setlocal
cd /d "%~dp0"
set CSC=%WINDIR%\Microsoft.NET\Framework64\v4.0.30319\csc.exe
if not exist "%CSC%" set CSC=%WINDIR%\Microsoft.NET\Framework\v4.0.30319\csc.exe
if not exist "%CSC%" (
  echo Der C#-Compiler des .NET Framework 4 wurde nicht gefunden.
  if not "%1"=="/still" pause
  exit /b 1
)
if not exist apologea.ico powershell -NoProfile -ExecutionPolicy Bypass -File symbol_erzeugen.ps1
if not exist build mkdir build
"%CSC%" /nologo /target:winexe /platform:anycpu /optimize+ /codepage:65001 /out:build\APOLOGEA.exe /win32icon:apologea.ico /win32manifest:app.manifest /r:System.dll /r:System.Core.dll /r:System.Drawing.dll /r:System.Windows.Forms.dll /r:System.Web.Extensions.dll /r:System.IO.Compression.dll /r:System.IO.Compression.FileSystem.dll /resource:ui\index.html,ui.index.html /resource:ui\app.css,ui.app.css /resource:ui\app.js,ui.app.js /resource:ui\symbol.png,ui.symbol.png /resource:ui\import.js,ui.import.js /resource:ui\katalog.js,ui.katalog.js /resource:ui\katalog-emblem.svg,ui.katalog-emblem.svg /resource:ui\katalog-wordmark.svg,ui.katalog-wordmark.svg /resource:ui\font-cormorant-garamond-latin-500-normal.woff2,ui.font-cormorant-garamond-latin-500-normal.woff2 /resource:ui\font-cormorant-garamond-latin-600-normal.woff2,ui.font-cormorant-garamond-latin-600-normal.woff2 /resource:ui\font-inter-latin-400-normal.woff2,ui.font-inter-latin-400-normal.woff2 /resource:ui\font-inter-latin-500-normal.woff2,ui.font-inter-latin-500-normal.woff2 /resource:ui\font-jetbrains-mono-latin-400-normal.woff2,ui.font-jetbrains-mono-latin-400-normal.woff2 /resource:ui\font-jetbrains-mono-latin-500-normal.woff2,ui.font-jetbrains-mono-latin-500-normal.woff2 src\*.cs
if errorlevel 1 (
  echo.
  echo BAUEN FEHLGESCHLAGEN.
  if not "%1"=="/still" pause
  exit /b 1
)
copy /y build\APOLOGEA.exe ..\APOLOGEA.exe >nul
echo Fertig: %~dp0..\APOLOGEA.exe
endlocal
