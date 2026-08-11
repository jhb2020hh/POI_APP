@echo off
REM =====================================================================
REM  POI-APP - POI-App als Server fuer die Niederlassung
REM  Von einem Benutzer per Doppelklick startbar. Bindet an alle Netzwerk-
REM  Adressen (0.0.0.0), damit Kollegen im Browser zugreifen koennen.
REM  Fenster bitte offen lassen - es zeigt, dass der Server laeuft.
REM
REM  Ueberwachter Betrieb: nach einem Beenden startet der Server automatisch
REM  neu. Sauber stoppen = dieses Fenster schliessen (oder server_log\stop.flag
REM  anlegen).
REM =====================================================================
setlocal EnableExtensions
cd /d "%~dp0"
set "ROOT=%~dp0"
set "PORT=4000"

set "LOGDIR=%ROOT%server_log"
if not exist "%LOGDIR%" mkdir "%LOGDIR%"
if exist "%LOGDIR%\stop.flag" del /q "%LOGDIR%\stop.flag"

echo ================================================================
echo   POI-APP - POI-App (Server)
echo ----------------------------------------------------------------
echo   Erreichbar im Browser unter:
echo.
echo   (derselbe Rechnername/dieselbe IP wie die Doku-App, nur Port %PORT%
echo    statt 8000 - z. B. http://dokuapp:%PORT% falls dieser Name schon
echo    eingerichtet ist), oder direkt ueber die IP-Adresse:
for /f "tokens=2 delims=:" %%I in ('ipconfig ^| findstr /i "IPv4"') do for /f "tokens=*" %%J in ("%%I") do echo       http://%%J:%PORT%
echo.
echo   Dieses Fenster bitte OFFEN lassen (der Server laeuft hier).
echo   Beenden: dieses Fenster schliessen.
echo ================================================================
echo.

:loop
set "NODE_ENV=production"
node "%ROOT%packages\backend\dist\server.js"
if exist "%LOGDIR%\stop.flag" goto :ende
echo.
echo   Server beendet - Neustart in 3 Sekunden ... (Fenster schliessen zum Stoppen)
echo   Falls das wiederholt passiert: laeuft evtl. noch ein alter Server-Prozess
echo   auf Port %PORT%? Pruefen mit: netstat -ano ^| findstr :%PORT%
ping -n 4 127.0.0.1 >nul
goto loop

:ende
echo.
echo   Server gestoppt (stop.flag). Taste druecken zum Schliessen.
pause >nul
endlocal
