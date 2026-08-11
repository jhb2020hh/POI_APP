@echo off
REM =====================================================================
REM  POI-APP - ueberwachter, fensterloser Server-Start (Autostart-Ziel)
REM  ---------------------------------------------------------------------
REM  Wird vom geplanten Task "POI-APP Server" beim Hochfahren gestartet
REM  (versteckt, ohne Anmeldung). Startet den Server, schreibt ein Log und
REM  startet nach einem Absturz automatisch neu - bis die Datei
REM  server_log\stop.flag existiert.
REM
REM  Manuell zum Testen (anderer Port, damit Port 4000 frei bleibt):
REM      poiapp_autostart_launcher.cmd 4013
REM  Beenden des Test-/Dauerlaufs: server_log\stop.flag anlegen
REM  (z. B. Rechtsklick > Neu > Textdokument, in "stop.flag" umbenennen)
REM  ODER den Task ueber "POI-APP - Autostart entfernen (Admin).cmd" stoppen.
REM =====================================================================
setlocal EnableExtensions
cd /d "%~dp0"
set "ROOT=%~dp0"
set "PORT=%~1"
if "%PORT%"=="" set "PORT=4000"
set "NODE_ENV=production"

set "LOGDIR=%ROOT%server_log"
if not exist "%LOGDIR%" mkdir "%LOGDIR%"
if exist "%LOGDIR%\stop.flag" del /q "%LOGDIR%\stop.flag"

:loop
REM Tagesgenaues Logfile + Zeitstempel sprachunabhaengig via PowerShell holen.
for /f "usebackq delims=" %%T in (`powershell -NoProfile -Command "Get-Date -Format yyyyMMdd"`) do set "TAG=%%T"
for /f "usebackq delims=" %%S in (`powershell -NoProfile -Command "Get-Date -Format 'yyyy-MM-dd HH:mm:ss'"`) do set "STAMP=%%S"
set "LOG=%LOGDIR%\server-%TAG%.log"

>>"%LOG%" echo(
>>"%LOG%" echo ==== Start %STAMP%  (Port %PORT%) ====

node "%ROOT%packages\backend\dist\server.js" >>"%LOG%" 2>&1

REM node hat sich beendet (Absturz, Fehler oder gewollter Stopp)
if exist "%LOGDIR%\stop.flag" (
  >>"%LOG%" echo ==== Gestoppt (stop.flag gefunden) ====
  goto :ende
)
>>"%LOG%" echo ==== Beendet - Neustart in 5 Sekunden ====
ping -n 6 127.0.0.1 >nul
goto loop

:ende
endlocal
